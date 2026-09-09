import { HttpError } from "./http.ts";

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export const EMAIL_RELAY_SIGNATURE_TOLERANCE_SECONDS = 300;
export const EMAIL_RELAY_MAX_RAW_BYTES = 524_288;

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    toOwnedArrayBuffer(bytes),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function constantTimeEqualHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/iu.test(left) || !/^[0-9a-f]{64}$/iu.test(right)) {
    return false;
  }
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  let diff = 0;
  for (let i = 0; i < 64; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyRelaySignature(input: {
  secret?: string;
  secrets?: readonly string[];
  timestamp: string;
  nonce: string;
  signature: string;
  body: string;
  nowMs?: number;
}): Promise<void> {
  if (!/^\d{10}$/u.test(input.timestamp)) {
    throw new HttpError(401, "invalid_relay_timestamp");
  }
  if (!/^[0-9a-f-]{36}$/iu.test(input.nonce)) {
    throw new HttpError(401, "invalid_relay_nonce");
  }
  const seconds = Number(input.timestamp);
  const now = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - seconds) > EMAIL_RELAY_SIGNATURE_TOLERANCE_SECONDS) {
    throw new HttpError(401, "relay_timestamp_out_of_window");
  }
  const secrets = [
    ...new Set(
      [input.secret, ...(input.secrets ?? [])].filter((
        value,
      ): value is string => Boolean(value)),
    ),
  ];
  if (!secrets.length) {
    throw new HttpError(500, "relay_signature_secret_missing");
  }
  const signed = `${input.timestamp}.${input.nonce}.${input.body}`;
  const expected = await Promise.all(
    secrets.map((secret) => hmacHex(secret, signed)),
  );
  if (!expected.some((value) => constantTimeEqualHex(value, input.signature))) {
    throw new HttpError(401, "invalid_relay_signature");
  }
}

export function extractAliasToken(recipient: string, domain: string): string {
  const [local, host, ...extra] = recipient.trim().split("@");
  if (
    extra.length ||
    !local ||
    !host ||
    host.toLowerCase() !== domain.toLowerCase()
  ) {
    throw new HttpError(404, "relay_alias_not_found");
  }
  const match = /^cf\+([A-Za-z0-9_-]{40,80})$/u.exec(local);
  if (!match) throw new HttpError(404, "relay_alias_not_found");
  return match[1];
}

export function sanitizeRelayHeader(value: unknown, max = 998): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function decodeQuotedPrintable(value: string): string {
  const source = value.replace(/=\r?\n/gu, "");
  const bytes: number[] = [];
  const enc = new TextEncoder();
  for (let i = 0; i < source.length; i += 1) {
    if (
      source[i] === "=" &&
      /^[0-9A-F]{2}$/iu.test(source.slice(i + 1, i + 3))
    ) {
      bytes.push(Number.parseInt(source.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(...enc.encode(source[i]));
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(
    new Uint8Array(bytes),
  );
}
function header(headers: string, name: string): string | null {
  const m = new RegExp(
    "^" + name + "\\s*:\\s*([^\\r\\n]*(?:\\r?\\n[ \\t][^\\r\\n]*)*)",
    "imu",
  ).exec(headers);
  return m ? m[1].replace(/\r?\n[ \t]+/gu, " ").trim() : null;
}
function param(value: string | null, name: string): string | null {
  if (!value) return null;
  const m = new RegExp(
    "(?:^|;)\\s*" + name + '=(?:"([^"]+)"|([^;\\s]+))',
    "iu",
  ).exec(value);
  return m?.[1] ?? m?.[2] ?? null;
}
function decodePart(
  body: string,
  encoding: string | null,
  charset: string | null,
): string {
  try {
    if ((encoding ?? "").toLowerCase().includes("quoted-printable")) {
      return decodeQuotedPrintable(body);
    }
    let bytes: Uint8Array;
    if ((encoding ?? "").toLowerCase().includes("base64")) {
      const v = atob(body.replace(/\s+/gu, ""));
      bytes = Uint8Array.from(v, (x) => x.charCodeAt(0));
    } else bytes = new TextEncoder().encode(body);
    const c = (charset ?? "utf-8").toLowerCase();
    return new TextDecoder(
      c.includes("8859")
        ? "iso-8859-1"
        : c.includes("1252")
        ? "windows-1252"
        : "utf-8",
      { fatal: false },
    ).decode(bytes);
  } catch {
    return "";
  }
}
function entity(value: string): string {
  return value.replace(
    /&(amp|lt|gt|quot|#39);/giu,
    (_x, n) =>
      ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[
        String(n).toLowerCase()
      ] ?? " ",
  );
}
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/p>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
export type ExtractedMailLink = {
  href: string;
  visibleText: string | null;
  surroundingText: string | null;
};
export type ExtractedMailContent = {
  subject: string | null;
  text: string;
  htmlLinks: ExtractedMailLink[];
};
function anchors(html: string): ExtractedMailLink[] {
  const out: ExtractedMailLink[] = [];
  const re =
    /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/giu;
  for (const m of html.matchAll(re)) {
    if (out.length >= 24) break;
    const href = entity(m[1] ?? m[2] ?? m[3] ?? "")
      .trim()
      .slice(0, 2048);
    if (!href) continue;
    out.push({
      href,
      visibleText: sanitizeRelayHeader(htmlToText(m[4] ?? ""), 240),
      surroundingText: sanitizeRelayHeader(
        htmlToText(html.slice(Math.max(0, (m.index ?? 0) - 160), m.index ?? 0)),
        240,
      ),
    });
  }
  return out;
}
function subjectDecode(value: string | null): string | null {
  if (!value) return null;
  return (
    value
      .replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/giu, (_a, c, m, v) => {
        try {
          const bytes = m.toLowerCase() === "b"
            ? Uint8Array.from(atob(v), (x) => x.charCodeAt(0))
            : new TextEncoder().encode(
              decodeQuotedPrintable(v.replace(/_/gu, " ")),
            );
          return new TextDecoder(
            String(c).toLowerCase().includes("8859") ? "iso-8859-1" : "utf-8",
            { fatal: false },
          ).decode(bytes);
        } catch {
          return "";
        }
      })
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 998) || null
  );
}
export function extractMailContent(raw: string): ExtractedMailContent {
  const texts: string[] = [];
  const links: ExtractedMailLink[] = [];
  let subject: string | null = null;
  const visit = (part: string, depth: number) => {
    if (depth > 5 || part.length > 180000) return;
    const cut = /\r?\n\r?\n/u.exec(part);
    if (!cut || cut.index === undefined) return;
    const h = part.slice(0, cut.index),
      body = part.slice(cut.index + cut[0].length);
    if (depth === 0) subject = subjectDecode(header(h, "subject"));
    const type = header(h, "content-type") ?? "text/plain",
      disp = header(h, "content-disposition") ?? "";
    if (/attachment/iu.test(disp) || /\bname\s*=/iu.test(type)) return;
    const boundary = param(type, "boundary");
    if (/^multipart\//iu.test(type) && boundary) {
      for (
        const child of body
          .split("--" + boundary)
          .slice(1)
          .map((x) =>
            x
              .replace(/^\r?\n/u, "")
              .replace(/\r?\n--\s*$/u, "")
              .trim()
          )
          .filter(Boolean)
          .slice(0, 24)
      ) {
        visit(child, depth + 1);
      }
      return;
    }
    const decoded = decodePart(
      body,
      header(h, "content-transfer-encoding"),
      param(type, "charset"),
    );
    if (/^text\/html/iu.test(type)) {
      links.push(...anchors(decoded).slice(0, 24 - links.length));
      texts.push(htmlToText(decoded));
    } else if (/^text\/plain/iu.test(type)) texts.push(decoded);
  };
  visit(raw.slice(0, 524288), 0);
  return {
    subject,
    text: texts
      .join("\n\n")
      .replace(/\u0000/gu, "")
      .slice(0, 100000)
      .trim(),
    htmlLinks: links.slice(0, 24),
  };
}
export function extractTextFromMime(raw: string): string {
  return extractMailContent(raw).text;
}
export type SourceProvider = "gmail" | "outlook" | "proton" | "other";
export type VerificationAction = {
  kind: "safe_url" | "code" | "safe_url_and_code" | "instructions_only";
  url?: string;
  code?: string;
};
export type ForwardingVerificationDetection = {
  provider: SourceProvider;
  action: VerificationAction;
  url: string | null;
  code: string | null;
  excerpt: string | null;
  confidence: number;
};
export type ForwardingVerificationInput = {
  providerHint?: SourceProvider;
  subject: string | null;
  text: string;
  links?: ExtractedMailLink[];
  envelopeSender?: string | null;
  from?: string | null;
  authenticationResults?: string | null;
  receivedSpf?: string | null;
};
export type ProviderEvidence = "strong" | "moderate" | "weak" | "unknown";
export function providerEvidence(input: ForwardingVerificationInput): {
  provider: SourceProvider;
  level: ProviderEvidence;
  reason: string;
} {
  // Cloudflare's ForwardableEmailMessage exposes no typed authentication verdict.
  // Header provenance/removal is not guaranteed by its documented Worker API.
  // Even an authserv-id spelling mx.cloudflare.net is therefore untrusted here.
  // Never authorize from these strings, including structurally valid PASS results.
  // Worker hints are useful for routing diagnostics only; they cannot authorize an action.
  if (input.providerHint && input.providerHint !== "other") {
    return {
      provider: input.providerHint,
      level: "weak",
      reason: "transport_hint_only",
    };
  }
  return {
    provider: "other",
    level: "unknown",
    reason: "provider_authentication_unavailable",
  };
}
function allowed(provider: SourceProvider, host: string): boolean {
  const h = host.toLowerCase();
  return provider === "gmail"
    ? h === "google.com" || h.endsWith(".google.com")
    : provider === "proton"
    ? h === "proton.me" ||
      h.endsWith(".proton.me") ||
      h === "protonmail.com" ||
      h.endsWith(".protonmail.com") ||
      h === "protonmail.ch" ||
      h.endsWith(".protonmail.ch")
    : false;
}
export function safeProviderVerificationUrl(
  provider: SourceProvider,
  raw: unknown,
): string | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    const path = u.pathname.toLowerCase();
    if (u.protocol !== "https:" || !allowed(provider, u.hostname)) return null;
    if (
      !/(confirm|verify|forward|mail\/vf-|mail\/u\/|mail\/ca\/)/u.test(path)
    ) return null;
    if (
      /(decline|reject|cancel|unsubscribe|privacy|help|preferences)/u.test(path)
    ) return null;
    return u.toString();
  } catch {
    return null;
  }
}
function positive(v: string): boolean {
  return (
    /(confirm|verify|accept\s+forward|approve\s+forward|confirm\s+forward|confirm\s+request|confirmar|verificar|aceptar\s+reenv)/iu
      .test(
        v,
      ) &&
    !/(decline|reject|cancel|unsubscribe|privacy|help|manage\s+preferences|rechazar|cancelar|privacidad|ayuda)/iu
      .test(
        v,
      )
  );
}
function semantics(p: SourceProvider, v: string): boolean {
  return p === "gmail"
    ? /(gmail.{0,50}(forward|reenv)|forward.{0,50}(confirm|verify)|confirmaci[oó]n.{0,50}reenv)/iu
      .test(
        v,
      )
    : p === "proton"
    ? /(proton.{0,50}(forward|reenv|invitation)|accept\s+forwarding|aceptar\s+reenv)/iu
      .test(
        v,
      )
    : false;
}
export function detectForwardingVerification(
  input: ForwardingVerificationInput | string | null,
  legacyText?: string,
): ForwardingVerificationDetection | null {
  const i = typeof input === "object" && input !== null
    ? input
    : { subject: input, text: legacyText ?? "" };
  const evidence = providerEvidence(i);
  if (evidence.level !== "strong") return null;
  return extractAuthenticatedForwardingAction(i, evidence.provider);
}

/** Content extraction only. Caller must establish authentication separately. */
export function extractAuthenticatedForwardingAction(
  i: ForwardingVerificationInput,
  provider: SourceProvider,
): ForwardingVerificationDetection | null {
  const combined = String(i.subject ?? "") + "\n" + i.text;
  if (!semantics(provider, combined)) {
    return null;
  }
  const candidates = [
    ...(i.links ?? []),
    ...(combined.match(/https:\/\/[^\s<>"']+/giu) ?? []).map((href) => ({
      href,
      visibleText: null,
      surroundingText: combined,
    })),
  ];
  let url: string | null = null;
  for (const link of candidates) {
    const u = safeProviderVerificationUrl(
      provider,
      link.href.replace(/[),.;]+$/u, ""),
    );
    if (
      u &&
      positive(
        String(link.visibleText ?? "") +
          " " +
          String(link.surroundingText ?? "") +
          " " +
          combined,
      )
    ) {
      url = u;
      break;
    }
  }
  const code =
    /(?:confirmation\s+code|confirmaci[oó]n\s+de\s+c[oó]digo|verification\s+code|verificaci[oó]n\s+de\s+c[oó]digo|c[oó]digo(?:\s+de\s+verificaci[oó]n)?|code(?:\s+de\s+verification)?)[^A-Za-z0-9]{0,20}([A-Za-z0-9-]{6,32})/iu
      .exec(
        combined,
      )?.[1] ?? null;
  const action: VerificationAction = url && code
    ? { kind: "safe_url_and_code", url, code }
    : url
    ? { kind: "safe_url", url }
    : code
    ? { kind: "code", code }
    : { kind: "instructions_only" };
  return {
    provider,
    action,
    url,
    code,
    excerpt: sanitizeRelayHeader(i.subject ?? i.text, 240),
    confidence: url || code?.length ? 0.95 : 0.75,
  };
}
export function normalizeVerificationAction(
  provider: SourceProvider,
  rawUrl: unknown,
  rawCode: unknown,
): {
  kind: "safe_url" | "code" | "safe_url_and_code" | "instructions_only";
  label: string;
  url?: string;
  code?: string;
} {
  const url = safeProviderVerificationUrl(provider, rawUrl);
  const code =
    typeof rawCode === "string" && /^[A-Za-z0-9-]{6,32}$/u.test(rawCode)
      ? rawCode
      : undefined;
  if (url && code) {
    return {
      kind: "safe_url_and_code",
      label: "Aprobar vinculación",
      url,
      code,
    };
  }
  if (url) return { kind: "safe_url", label: "Aprobar vinculación", url };
  if (code) return { kind: "code", label: "Copiar código", code };
  return { kind: "instructions_only", label: "Ver cómo completarlo" };
}

export function detectGmailForwardingConfirmation(
  subject: string | null,
  text: string,
): { url: string | null; code: string | null } | null {
  const d = detectForwardingVerification({
    providerHint: "gmail",
    subject,
    text,
  });
  return d ? { url: d.url, code: d.code } : null;
}

export type RelaySourceIdentity = {
  aliasId: string | null;
  sourceId: string | null;
  providerHint: string | null;
};

export function isDifferentRelaySource(
  left: RelaySourceIdentity,
  right: RelaySourceIdentity,
): boolean {
  if (!left.aliasId || !right.aliasId || left.aliasId !== right.aliasId) {
    return false;
  }
  if (left.sourceId && right.sourceId) return left.sourceId !== right.sourceId;
  const a = (left.providerHint ?? "").trim().toLowerCase();
  const b = (right.providerHint ?? "").trim().toLowerCase();
  if (!a || !b || a === "other" || b === "other") return false;
  return a !== b;
}

export function decodeBase64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function extractGmailForwardingMailbox(
  text: string,
  aliasDomain: string,
): string | null {
  const contexts = [
    /(?:receive|receiving|forward)\s+(?:mail|messages)\s+from\s*[<\[]?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/iu,
    /(?:recibir|reenv[ií]o)\s+(?:correos?|mensajes?)\s+(?:de|desde)\s*[<\[]?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/iu,
  ];
  for (const expression of contexts) {
    const candidate = expression.exec(text)?.[1]?.toLowerCase();
    if (
      !candidate || candidate.length > 320 ||
      candidate.endsWith("@" + aliasDomain.toLowerCase())
    ) continue;
    const [local, host] = candidate.split("@");
    if (
      !local || !host || /^(no-?reply|mailer-daemon|postmaster)$/iu.test(local)
    ) continue;
    return candidate;
  }
  return null;
}
