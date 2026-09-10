import { Buffer } from "node:buffer";
import arcModuleDefault from "npm:mailauth@4.13.3/lib/arc/index.js";
import dkimModuleDefault from "npm:mailauth@4.13.3/lib/dkim/verify.js";
import type { SourceProvider } from "./email-relay.ts";

export type ProviderAuthLevel = "strong" | "unknown";
export type ProviderAuthMechanism = "dkim" | "arc" | null;
export type ForwardingProviderCryptoEvidence = {
  provider: SourceProvider;
  level: ProviderAuthLevel;
  reason: string;
  mechanism: ProviderAuthMechanism;
  signingDomain: string | null;
  forwardingPath: boolean;
  recipientBound: boolean;
  providerSenderBound: boolean;
};

export type DnsResolver = (
  domain: string,
  rrtype: string,
) => Promise<string[][] | string[]>;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type DkimRow = {
  signingDomain?: unknown;
  algo?: unknown;
  signatureTimeValid?: unknown;
  status?: { result?: unknown; underSized?: unknown };
  signingHeaders?: { keys?: unknown; headers?: unknown };
};
type DkimResult = {
  results?: DkimRow[];
  arc?: unknown;
};
type ArcResult = {
  status?: { result?: unknown };
  signature?: DkimRow | false;
  chain?: unknown;
};
type MailauthApi = {
  dkimVerify: (
    raw: string | Uint8Array,
    options: { resolver: DnsResolver; minBitLength: number },
  ) => Promise<DkimResult>;
  arc: (
    data: unknown,
    options: { resolver: DnsResolver; minBitLength: number },
  ) => Promise<ArcResult>;
};

const mailauth: MailauthApi = {
  dkimVerify: (dkimModuleDefault as unknown as {
    dkimVerify: MailauthApi["dkimVerify"];
  }).dkimVerify,
  arc: (arcModuleDefault as unknown as { arc: MailauthApi["arc"] }).arc,
};
const MAX_RAW_BYTES = 524_288;
const MAX_DNS_BODY_BYTES = 65_536;
const DNS_TIMEOUT_MS = 3_000;
const MIN_RSA_BITS = 2_048;
const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";

// This gate enables only the exact Google system identity used by Gmail
// forwarding verification. Consumer gmail.com DKIM is intentionally NOT enough:
// any Gmail user can produce mail signed by gmail.com.
const GMAIL_SIGNING_ROOTS = ["google.com"] as const;
const GMAIL_FORWARDING_SYSTEM_SENDERS = new Set([
  "forwarding-noreply@google.com",
  "mail-noreply@google.com",
]);

function unknown(reason: string): ForwardingProviderCryptoEvidence {
  return {
    provider: "other",
    level: "unknown",
    reason,
    mechanism: null,
    signingDomain: null,
    forwardingPath: false,
    recipientBound: false,
    providerSenderBound: false,
  };
}

function normalizeSigningDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const domain = value.trim().toLowerCase().replace(/\.$/u, "");
  if (!domain || domain.length > 253) return null;
  const labels = domain.split(".");
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (
      !label || label.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)
    ) return null;
  }
  return domain;
}

function providerForSigningDomain(value: unknown): SourceProvider {
  const domain = normalizeSigningDomain(value);
  if (!domain) return "other";
  for (const root of GMAIL_SIGNING_ROOTS) {
    if (domain === root) return "gmail";
  }
  return "other";
}

function validDnsQueryName(value: string): string | null {
  const name = value.trim().toLowerCase().replace(/\.$/u, "");
  if (!name || name.length > 253) return null;
  const labels = name.split(".");
  if (labels.length < 3) return null;
  for (const label of labels) {
    if (
      !label || label.length > 63 ||
      !/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/u.test(label)
    ) return null;
  }
  if (!labels.includes("_domainkey")) return null;
  return name;
}

function dnsError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function decodeDnsJsonTxt(data: string): string[] {
  if (!data || data.length > 16_384) return [];
  const quoted: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/gu;
  for (const match of data.matchAll(re)) {
    try {
      quoted.push(JSON.parse(`"${match[1]}"`));
    } catch {
      return [];
    }
  }
  if (quoted.length) return quoted;
  return [data];
}

export function createBoundedDohTxtResolver(
  fetchImpl: FetchLike = fetch,
): DnsResolver {
  let uniqueLookups = 0;
  const cache = new Map<string, Promise<string[][] | string[]>>();
  return async (domain: string, rrtype: string) => {
    if (rrtype.toUpperCase() !== "TXT") {
      throw dnsError("ENODATA", "provider_auth_dns_txt_only");
    }
    const name = validDnsQueryName(domain);
    if (!name) throw dnsError("ENODATA", "provider_auth_dns_name_rejected");
    const cacheKey = `TXT:${name}`;
    const cached = cache.get(cacheKey);
    if (cached) return await cached;
    uniqueLookups += 1;
    if (uniqueLookups > 8) {
      throw dnsError("ENODATA", "provider_auth_dns_lookup_limit");
    }

    const lookup = (async (): Promise<string[][] | string[]> => {
      const url = new URL(DOH_ENDPOINT);
      url.searchParams.set("name", name);
      url.searchParams.set("type", "TXT");
      url.searchParams.set("cd", "false");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DNS_TIMEOUT_MS);
      try {
        const response = await fetchImpl(url, {
          method: "GET",
          headers: { accept: "application/dns-json" },
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw dnsError("ENODATA", "provider_auth_dns_http_error");
        }
        const contentLength = Number(
          response.headers.get("content-length") ?? "0",
        );
        if (contentLength > MAX_DNS_BODY_BYTES) {
          throw dnsError("ENODATA", "provider_auth_dns_response_too_large");
        }
        const body = await response.text();
        if (body.length > MAX_DNS_BODY_BYTES) {
          throw dnsError("ENODATA", "provider_auth_dns_response_too_large");
        }
        const payload = JSON.parse(body) as {
          Status?: unknown;
          Question?: Array<{ name?: unknown; type?: unknown }>;
          Answer?: Array<{ name?: unknown; type?: unknown; data?: unknown }>;
        };
        const questionMatches = Array.isArray(payload.Question) &&
          payload.Question.some((question) =>
            question.type === 16 && typeof question.name === "string" &&
            question.name.toLowerCase().replace(/\.$/u, "") === name
          );
        if (
          payload.Status !== 0 || !questionMatches ||
          !Array.isArray(payload.Answer)
        ) {
          throw dnsError("ENODATA", "provider_auth_dns_no_answer");
        }
        const rows: string[][] = [];
        for (const answer of payload.Answer.slice(0, 8)) {
          if (
            answer.type !== 16 || typeof answer.name !== "string" ||
            typeof answer.data !== "string"
          ) continue;
          const answerName = answer.name.toLowerCase().replace(/\.$/u, "");
          if (answerName !== name) continue;
          const segments = decodeDnsJsonTxt(answer.data);
          if (segments.length && segments.join("").length <= 16_384) {
            rows.push(segments);
          }
        }
        if (!rows.length) {
          throw dnsError("ENODATA", "provider_auth_dns_no_txt");
        }
        return rows;
      } catch (error) {
        if ((error as Error & { code?: string })?.code) throw error;
        throw dnsError("ENODATA", "provider_auth_dns_unavailable");
      } finally {
        clearTimeout(timer);
      }
    })();
    cache.set(cacheKey, lookup);
    try {
      return await lookup;
    } catch (error) {
      cache.delete(cacheKey);
      throw error;
    }
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strongSignatureAlgorithm(value: unknown): boolean {
  return typeof value === "string" &&
    ["rsa-sha256", "ed25519-sha256"].includes(value.trim().toLowerCase());
}

function signedHeaders(row: DkimRow): string[] {
  const headers = row.signingHeaders?.headers;
  return Array.isArray(headers)
    ? headers.filter((value): value is string => typeof value === "string")
    : [];
}

function normalizedHeaderBody(value: string, name: string): string | null {
  const re = new RegExp(`^${name}\\s*:`, "iu");
  if (!re.test(value)) return null;
  return value
    .replace(/\r?\n[ \t]+/gu, " ")
    .replace(re, "")
    .trim()
    .toLowerCase();
}

function addressTokens(value: string): string[] {
  return value
    .split(/[<>,\s]+/u)
    .map((token) => token.trim().replace(/^mailto:/u, ""))
    .filter((token) => /^[^\s@<>]+@[^\s@<>]+$/u.test(token));
}

function signedHeaderBindsRecipient(
  row: DkimRow,
  expectedRecipient: string | undefined,
): boolean {
  const target = expectedRecipient?.trim().toLowerCase() ?? "";
  if (
    !target || target.length > 320 ||
    !/^[^\s@<>]+@[^\s@<>]+$/u.test(target)
  ) return false;
  return signedHeaders(row).some((value) => {
    const body = normalizedHeaderBody(value, "to");
    return body !== null && addressTokens(body).includes(target);
  });
}

function signedHeaderBindsGoogleSystemSender(row: DkimRow): boolean {
  return signedHeaders(row).some((value) => {
    const body = normalizedHeaderBody(value, "from");
    if (body === null) return false;
    return addressTokens(body).some((address) =>
      GMAIL_FORWARDING_SYSTEM_SENDERS.has(address)
    );
  });
}

function lastArcSealIdentity(
  result: ArcResult,
): { domain: string | null; algorithm: unknown } {
  const chain = Array.isArray(result.chain) ? result.chain : [];
  if (!chain.length) return { domain: null, algorithm: null };
  const last = record(chain[chain.length - 1]);
  const seal = record(last["arc-seal"]);
  const parsed = record(seal.parsed);
  const d = record(parsed.d);
  const a = record(parsed.a);
  return {
    domain: normalizeSigningDomain(d.value),
    algorithm: a.value,
  };
}

function directDkimEvidence(
  result: DkimResult,
  expectedRecipient: string | undefined,
): ForwardingProviderCryptoEvidence | null {
  for (const row of result.results ?? []) {
    if (
      row.status?.result !== "pass" || row.status?.underSized ||
      row.signatureTimeValid === false || !strongSignatureAlgorithm(row.algo)
    ) continue;
    const signingDomain = normalizeSigningDomain(row.signingDomain);
    if (!signingDomain) continue;
    const provider = providerForSigningDomain(signingDomain);
    if (provider !== "gmail") continue;
    if (!signedHeaderBindsGoogleSystemSender(row)) continue;
    if (!signedHeaderBindsRecipient(row, expectedRecipient)) continue;
    return {
      provider,
      level: "strong",
      reason: "raw_mime_dkim_cryptographic_pass",
      mechanism: "dkim",
      signingDomain,
      forwardingPath: false,
      recipientBound: true,
      providerSenderBound: true,
    };
  }
  return null;
}

async function arcEvidence(
  result: DkimResult,
  resolver: DnsResolver,
): Promise<ForwardingProviderCryptoEvidence | null> {
  if (!result.arc) return null;
  let verified: ArcResult;
  try {
    verified = await mailauth.arc(result.arc, {
      resolver,
      minBitLength: MIN_RSA_BITS,
    });
  } catch {
    return null;
  }
  if (verified.status?.result !== "pass" || !verified.signature) return null;
  if (
    verified.signature.status?.result !== "pass" ||
    verified.signature.status?.underSized ||
    verified.signature.signatureTimeValid === false ||
    !strongSignatureAlgorithm(verified.signature.algo)
  ) return null;
  const messageSigningDomain = normalizeSigningDomain(
    verified.signature.signingDomain,
  );
  const sealIdentity = lastArcSealIdentity(verified);
  if (!messageSigningDomain || !sealIdentity.domain) return null;
  if (!strongSignatureAlgorithm(sealIdentity.algorithm)) return null;
  const messageProvider = providerForSigningDomain(messageSigningDomain);
  const sealProvider = providerForSigningDomain(sealIdentity.domain);
  if (messageProvider !== "gmail" || sealProvider !== "gmail") return null;
  return {
    provider: "gmail",
    level: "strong",
    reason: "raw_mime_arc_chain_cryptographic_pass",
    mechanism: "arc",
    signingDomain: sealIdentity.domain,
    forwardingPath: true,
    recipientBound: false,
    providerSenderBound: false,
  };
}

export async function verifyForwardingProviderAuth(
  rawMime: string | Uint8Array,
  options: {
    resolver?: DnsResolver;
    expectedRecipient?: string;
  } = {},
): Promise<ForwardingProviderCryptoEvidence> {
  const byteLength = typeof rawMime === "string"
    ? new TextEncoder().encode(rawMime).byteLength
    : rawMime.byteLength;
  if (!rawMime || byteLength > MAX_RAW_BYTES) {
    return unknown("provider_auth_raw_mime_invalid");
  }
  const resolver = options.resolver ?? createBoundedDohTxtResolver();
  const exactInput = typeof rawMime === "string"
    ? rawMime
    : Buffer.from(rawMime);
  let dkim: DkimResult;
  try {
    dkim = await mailauth.dkimVerify(exactInput, {
      resolver,
      minBitLength: MIN_RSA_BITS,
    });
  } catch {
    return unknown("provider_auth_cryptographic_verification_unavailable");
  }

  // A valid ARC chain proves the forwarding path and is stronger for source attribution.
  const arc = await arcEvidence(dkim, resolver);
  if (arc) return arc;

  // Direct Google DKIM is sufficient only for the signed Gmail system
  // forwarding-verification message addressed to this exact relay recipient.
  // It must never be interpreted as forwarding-path proof.
  const direct = directDkimEvidence(dkim, options.expectedRecipient);
  if (direct) return direct;

  return unknown("provider_auth_no_allowed_cryptographic_signer");
}
