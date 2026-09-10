import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { generateKeyPairSync } from "node:crypto";
import mailauthDefault from "npm:mailauth@4.13.3";
import {
  createBoundedDohTxtResolver,
  type DnsResolver,
  verifyForwardingProviderAuth,
} from "./email-provider-auth.ts";

const { privateKey: PRIVATE_KEY, publicKey: PUBLIC_KEY } = generateKeyPairSync(
  "rsa",
  {
    modulusLength: 2_048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  },
);

const PUBLIC_KEY_DNS = PUBLIC_KEY
  .replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----/gu, "")
  .replace(/\s+/gu, "");

type MailauthTestApi = {
  dkimSign: (
    raw: string,
    options: Record<string, unknown>,
  ) => Promise<{ signatures: string; errors?: unknown }>;
  sealMessage: (
    raw: string,
    options: Record<string, unknown>,
  ) => Promise<Uint8Array>;
};
const mailauth = mailauthDefault as unknown as MailauthTestApi;

const RELAY_RECIPIENT = "cf+fixture@ingest.example.test";
const BASE_MESSAGE = [
  "From: Gmail Team <forwarding-noreply@google.com>",
  `To: ${RELAY_RECIPIENT}`,
  "Subject: Gmail forwarding confirmation",
  "Date: Wed, 09 Sep 2026 20:00:00 +0000",
  "Message-ID: <fixture-1@google.com>",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Confirm forwarding https://mail-settings.google.com/mail/vf-fixture",
  "",
].join("\r\n");

const FORWARDED_MESSAGE = [
  "From: Banco Fixture <alertas@bank.example>",
  `To: ${RELAY_RECIPIENT}`,
  "Subject: Compra aprobada",
  "Date: Wed, 09 Sep 2026 20:00:00 +0000",
  "Message-ID: <fixture-bank-1@bank.example>",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Compra aprobada COP 42.000",
  "",
].join("\r\n");

function resolverFor(domain: string, selector: string): DnsResolver {
  const expected = `${selector}._domainkey.${domain}`.toLowerCase();
  return async (name, rrtype) => {
    assertEquals(rrtype.toUpperCase(), "TXT");
    if (name.toLowerCase() !== expected) return [];
    return [[`v=DKIM1; k=rsa; p=${PUBLIC_KEY_DNS}`]];
  };
}

async function dkimMessage(
  domain: string,
  selector: string,
  overrides: Record<string, unknown> = {},
  message = BASE_MESSAGE,
): Promise<string> {
  const result = await mailauth.dkimSign(message, {
    signTime: new Date("2026-09-09T20:00:00.000Z"),
    signatureData: [{
      signingDomain: domain,
      selector,
      privateKey: PRIVATE_KEY,
      algorithm: "rsa-sha256",
      canonicalization: "relaxed/relaxed",
      ...overrides,
    }],
  });
  assertEquals(Array.isArray(result.errors) ? result.errors.length : 0, 0);
  assertEquals(result.signatures.startsWith("DKIM-Signature:"), true);
  return result.signatures + message;
}

Deno.test("cryptographic Google DKIM binds signed system sender and relay recipient", async () => {
  const selector = "cfv5dkim";
  const raw = await dkimMessage("google.com", selector);
  const evidence = await verifyForwardingProviderAuth(raw, {
    resolver: resolverFor("google.com", selector),
    expectedRecipient: RELAY_RECIPIENT,
  });
  assertEquals(evidence.provider, "gmail");
  assertEquals(evidence.level, "strong");
  assertEquals(evidence.mechanism, "dkim");
  assertEquals(evidence.forwardingPath, false);
  assertEquals(evidence.recipientBound, true);
  assertEquals(evidence.providerSenderBound, true);
});

Deno.test("valid DKIM from an unallowlisted signer cannot become Gmail evidence", async () => {
  const selector = "cfv5evil";
  const raw = await dkimMessage("evil.example", selector);
  const evidence = await verifyForwardingProviderAuth(raw, {
    resolver: resolverFor("evil.example", selector),
    expectedRecipient: RELAY_RECIPIENT,
  });
  assertEquals(evidence.level, "unknown");
  assertEquals(evidence.provider, "other");
});

Deno.test("consumer gmail.com DKIM cannot become Google system evidence", async () => {
  const selector = "cfv5consumer";
  const message = BASE_MESSAGE.replace(
    "From: Gmail Team <forwarding-noreply@google.com>",
    "From: Consumer <consumer@gmail.com>",
  );
  const raw = await dkimMessage("gmail.com", selector, {}, message);
  const evidence = await verifyForwardingProviderAuth(raw, {
    resolver: resolverFor("gmail.com", selector),
    expectedRecipient: RELAY_RECIPIENT,
  });
  assertEquals(evidence.level, "unknown");
  assertEquals(evidence.provider, "other");
});

Deno.test("Google DKIM with an untrusted signed From is not provider-system evidence", async () => {
  const selector = "cfv5sender";
  const message = BASE_MESSAGE.replace(
    "From: Gmail Team <forwarding-noreply@google.com>",
    "From: Attacker <attacker@gmail.com>",
  );
  const raw = await dkimMessage("google.com", selector, {}, message);
  const evidence = await verifyForwardingProviderAuth(raw, {
    resolver: resolverFor("google.com", selector),
    expectedRecipient: RELAY_RECIPIENT,
  });
  assertEquals(evidence.level, "unknown");
  assertEquals(evidence.providerSenderBound, false);
});

Deno.test("spoofed Authentication-Results text without a signature stays unknown", async () => {
  const raw =
    "Authentication-Results: mx.cloudflare.net; dkim=pass header.d=google.com\r\n" +
    BASE_MESSAGE;
  const evidence = await verifyForwardingProviderAuth(raw, {
    resolver: async () => [],
    expectedRecipient: RELAY_RECIPIENT,
  });
  assertEquals(evidence.level, "unknown");
  assertEquals(evidence.provider, "other");
});

Deno.test("tampering a cryptographically signed Google message fails closed", async () => {
  const selector = "cfv5tamper";
  const raw = await dkimMessage("google.com", selector);
  const tampered = raw.replace("Confirm forwarding", "Forged forwarding");
  const evidence = await verifyForwardingProviderAuth(tampered, {
    resolver: resolverFor("google.com", selector),
    expectedRecipient: RELAY_RECIPIENT,
  });
  assertEquals(evidence.level, "unknown");
});

Deno.test("Google DKIM using SHA1 is not strong provider evidence", async () => {
  const selector = "cfv5sha1";
  const raw = await dkimMessage("google.com", selector, {
    algorithm: "rsa-sha1",
  });
  const evidence = await verifyForwardingProviderAuth(raw, {
    resolver: resolverFor("google.com", selector),
    expectedRecipient: RELAY_RECIPIENT,
  });
  assertEquals(evidence.level, "unknown");
});

Deno.test("valid Google DKIM cannot be replayed across relay recipients", async () => {
  const selector = "cfv5alias";
  const raw = await dkimMessage("google.com", selector);
  const evidence = await verifyForwardingProviderAuth(raw, {
    resolver: resolverFor("google.com", selector),
    expectedRecipient: "cf+different@ingest.example.test",
  });
  assertEquals(evidence.level, "unknown");
  assertEquals(evidence.recipientBound, false);
});

Deno.test("validated Google ARC chain proves the forwarding path", async () => {
  const selector = "cfv5arc";
  const seal = await mailauth.sealMessage(FORWARDED_MESSAGE, {
    signingDomain: "google.com",
    selector,
    privateKey: PRIVATE_KEY,
    algorithm: "rsa-sha256",
    canonicalization: "relaxed/relaxed",
    authResults: "mx.fixture; dkim=pass header.d=bank.example",
    cv: "none",
    signTime: new Date("2026-09-09T20:00:00.000Z"),
  });
  const raw = new TextDecoder().decode(seal) + FORWARDED_MESSAGE;
  const evidence = await verifyForwardingProviderAuth(raw, {
    resolver: resolverFor("google.com", selector),
    expectedRecipient: RELAY_RECIPIENT,
  });
  assertEquals(evidence.provider, "gmail");
  assertEquals(evidence.level, "strong");
  assertEquals(evidence.mechanism, "arc");
  assertEquals(evidence.forwardingPath, true);
  assertEquals(evidence.recipientBound, false);
});

Deno.test("forged ARC labels without a valid chain never prove forwarding", async () => {
  const raw = [
    "ARC-Seal: i=1; a=rsa-sha256; d=google.com; s=fake; cv=none; b=AAAA",
    "ARC-Message-Signature: i=1; a=rsa-sha256; d=google.com; s=fake; c=relaxed/relaxed; h=from:subject; bh=AAAA; b=AAAA",
    "ARC-Authentication-Results: i=1; mx.fixture; dkim=pass header.d=google.com",
    FORWARDED_MESSAGE,
  ].join("\r\n");
  const evidence = await verifyForwardingProviderAuth(raw, {
    resolver: async () => [],
    expectedRecipient: RELAY_RECIPIENT,
  });
  assertEquals(evidence.level, "unknown");
  assertEquals(evidence.forwardingPath, false);
});

Deno.test("bounded DoH resolver caps unique TXT lookups", async () => {
  let calls = 0;
  const resolver = createBoundedDohTxtResolver(async (input) => {
    calls += 1;
    const url = new URL(String(input));
    const name = url.searchParams.get("name") ?? "";
    return new Response(
      JSON.stringify({
        Status: 0,
        Question: [{ name: `${name}.`, type: 16 }],
        Answer: [{ name: `${name}.`, type: 16, data: '"v=DKIM1; p=abc"' }],
      }),
      { status: 200 },
    );
  });
  for (let index = 0; index < 8; index += 1) {
    await resolver(`s${index}._domainkey.google.com`, "TXT");
  }
  await assertRejects(() => resolver("s8._domainkey.google.com", "TXT"));
  assertEquals(calls, 8);
});

Deno.test("bounded DoH resolver is TXT-only, fixed-endpoint, and parses segmented TXT", async () => {
  let observed = "";
  const resolver = createBoundedDohTxtResolver(async (input, init) => {
    observed = String(input);
    assertEquals(init?.method, "GET");
    assertEquals(
      new Headers(init?.headers).get("accept"),
      "application/dns-json",
    );
    return new Response(
      JSON.stringify({
        Status: 0,
        Question: [{ name: "cf._domainkey.google.com.", type: 16 }],
        Answer: [{
          name: "cf._domainkey.google.com.",
          type: 16,
          data: '"v=DKIM1; k=rsa; " "p=abc"',
        }],
      }),
      {
        status: 200,
        headers: { "content-type": "application/dns-json" },
      },
    );
  });
  assertEquals(
    await resolver("cf._domainkey.google.com", "TXT"),
    [["v=DKIM1; k=rsa; ", "p=abc"]],
  );
  assertEquals(
    observed.startsWith("https://cloudflare-dns.com/dns-query?"),
    true,
  );
  await assertRejects(() => resolver("cf._domainkey.google.com", "A"));
  await assertRejects(() => resolver("https://evil.example", "TXT"));
  await assertRejects(() => resolver("example.com", "TXT"));
});
