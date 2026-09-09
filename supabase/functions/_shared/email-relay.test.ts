import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  detectForwardingVerification,
  extractAliasToken,
  extractAuthenticatedForwardingAction,
  extractMailContent,
  extractTextFromMime,
  type ForwardingVerificationInput,
  isDifferentRelaySource,
  providerEvidence,
  verifyRelaySignature,
} from "./email-relay.ts";
import { parseMailMessage } from "./financial-parser.ts";
import {
  authDomainMatches,
  authIdentityDomain,
  normalizeAuthDomain,
  originalSenderAuth,
  parseAuthenticationResults,
} from "./email-auth.ts";

// Existing action/content fixtures are synthetic, not live trusted transport proof.
// Preserve their extraction assertions AND verify runtime refuses their raw headers.
function extractFixtureAction(input: ForwardingVerificationInput) {
  assertEquals(detectForwardingVerification(input), null);
  if (!input.authenticationResults) return null;
  return extractAuthenticatedForwardingAction(
    input,
    input.providerHint ?? "other",
  );
}

Deno.test("email relay extracts high entropy plus alias", () => {
  assertEquals(
    extractAliasToken(
      `cf+${"a".repeat(43)}@ingest.example.com`,
      "ingest.example.com",
    ),
    "a".repeat(43),
  );
});
Deno.test("email relay rejects wrong domain", () => {
  let ok = false;
  try {
    extractAliasToken(
      `cf+${"a".repeat(43)}@other.example.com`,
      "ingest.example.com",
    );
  } catch {
    ok = true;
  }
  assertEquals(ok, true);
});
Deno.test("MIME extraction ignores html execution and yields text", () => {
  const raw =
    "Subject: x\r\nContent-Type: text/html\r\n\r\n<p>Compra por COP 12.500</p><script>alert(1)</script>";
  assertEquals(
    extractTextFromMime(raw).includes("Compra por COP 12.500"),
    true,
  );
  assertEquals(extractTextFromMime(raw).includes("alert(1)"), false);
});
Deno.test("Gmail confirmation requires authenticated Google transport and accepts a narrow HTTPS action", () => {
  const hit = extractFixtureAction({
    providerHint: "gmail",
    authenticationResults: "dkim=pass header.d=google.com",
    subject: "Gmail Forwarding Confirmation",
    text: "Confirm https://mail-settings.google.com/mail/vf-test code 12345678",
  });
  assertEquals(hit?.url?.startsWith("https://mail-settings.google.com/"), true);
});
Deno.test("quoted-printable UTF-8 remains parseable", () => {
  const raw =
    "Subject: x\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nTransacci=C3=B3n aprobada por COP 12.500";
  assertEquals(extractTextFromMime(raw).includes("Transacción aprobada"), true);
});
Deno.test("invalid HMAC is rejected", async () => {
  const now = 1700000000000;
  const ts = String(Math.floor(now / 1000));
  await assertRejects(() =>
    verifyRelaySignature({
      secret: "secret",
      timestamp: ts,
      nonce: "123e4567-e89b-12d3-a456-426614174000",
      signature: "0".repeat(64),
      body: "{}",
      nowMs: now,
    })
  );
});
Deno.test(
  "expired signed timestamp is rejected before replay storage",
  async () => {
    await assertRejects(() =>
      verifyRelaySignature({
        secret: "secret",
        timestamp: "1700000000",
        nonce: "123e4567-e89b-12d3-a456-426614174000",
        signature: "0".repeat(64),
        body: "{}",
        nowMs: 1700001000000,
      })
    );
  },
);
Deno.test("email_relay reuses multilingual financial parser", async () => {
  const candidate = await parseMailMessage({
    provider: "email_relay",
    externalId: "relay-es-1",
    occurredAt: "2026-09-04T17:00:00.000Z",
    sender: "Banco",
    title: "Compra aprobada",
    text: "Pagaste COP 45.900 en Mercado Uno",
    defaultCurrency: "COP",
  });
  assertEquals(candidate?.provider, "email_relay");
  assertEquals(candidate?.proposedKind, "expense");
  assertEquals(candidate?.amountMinor, 45900);
});
Deno.test(
  "non-financial relay mail is ignored by the existing parser",
  async () => {
    const candidate = await parseMailMessage({
      provider: "email_relay",
      externalId: "relay-noise-1",
      occurredAt: "2026-09-04T17:00:00.000Z",
      sender: "Boletin",
      title: "Novedades",
      text: "Conoce nuestros nuevos beneficios para clientes.",
      defaultCurrency: "COP",
    });
    assertEquals(candidate, null);
  },
);
Deno.test(
  "lower-confidence financial relay remains eligible for review instead of forced auto-post",
  async () => {
    const candidate = await parseMailMessage({
      provider: "email_relay",
      externalId: "relay-review-1",
      occurredAt: "2026-09-04T17:00:00.000Z",
      sender: "Banco",
      title: "Compra",
      text: "Compra COP 42.000",
      defaultCurrency: "COP",
    });
    assertEquals(
      Boolean(
        candidate && candidate.confidence >= 0.7 && candidate.confidence < 0.94,
      ),
      true,
    );
  },
);

Deno.test(
  "relay semantic dedup distinguishes Gmail and Outlook on one alias",
  () => {
    assertEquals(
      isDifferentRelaySource(
        { aliasId: "a", sourceId: "gmail-1", providerHint: "gmail" },
        { aliasId: "a", sourceId: "outlook-1", providerHint: "outlook" },
      ),
      true,
    );
  },
);
Deno.test(
  "relay semantic dedup does not classify the same relay source as cross-source",
  () => {
    assertEquals(
      isDifferentRelaySource(
        { aliasId: "a", sourceId: "gmail-1", providerHint: "gmail" },
        { aliasId: "a", sourceId: "gmail-1", providerHint: "outlook" },
      ),
      false,
    );
  },
);
Deno.test(
  "relay semantic dedup falls back to provider hint when source id is unavailable",
  () => {
    assertEquals(
      isDifferentRelaySource(
        { aliasId: "a", sourceId: null, providerHint: "gmail" },
        { aliasId: "a", sourceId: null, providerHint: "outlook" },
      ),
      true,
    );
  },
);
Deno.test("relay semantic dedup never crosses alias boundaries", () => {
  assertEquals(
    isDifferentRelaySource(
      { aliasId: "a", sourceId: "gmail-1", providerHint: "gmail" },
      { aliasId: "b", sourceId: "outlook-1", providerHint: "outlook" },
    ),
    false,
  );
});

Deno.test(
  "generic forwarding detector accepts English and Spanish Gmail confirmations",
  () => {
    const english = extractFixtureAction({
      providerHint: "gmail",
      authenticationResults: "dkim=pass header.d=google.com",
      subject: "Gmail forwarding confirmation",
      text:
        "Confirm forwarding: https://mail-settings.google.com/mail/vf-test code 12345678",
    });
    const spanish = extractFixtureAction({
      providerHint: "gmail",
      authenticationResults: "spf=pass smtp.mailfrom=google.com",
      subject: "Confirmación de reenvío de Gmail",
      text:
        "Completa la confirmación en https://accounts.google.com/forwarding/test Código 87654321",
    });
    assertEquals(english?.provider, "gmail");
    assertEquals(
      english?.url?.startsWith("https://mail-settings.google.com/"),
      true,
    );
    assertEquals(spanish?.code, "87654321");
  },
);
Deno.test(
  "forwarding detector rejects unsafe URLs and accepts a bounded code-only confirmation",
  () => {
    assertEquals(
      extractFixtureAction({
        providerHint: "gmail",
        authenticationResults: "dkim=pass header.d=google.com",
        subject: "Gmail forwarding confirmation",
        text: "Confirm at http://evil.example/verify",
      })?.action.kind,
      "instructions_only",
    );
    assertEquals(
      extractFixtureAction({
        providerHint: "gmail",
        authenticationResults: "dkim=pass header.d=google.com",
        subject: "Gmail forwarding confirmation",
        text: "Confirm at javascript:alert(1)",
      })?.url,
      null,
    );
    assertEquals(
      extractFixtureAction({
        providerHint: "gmail",
        authenticationResults: "dkim=pass header.d=google.com",
        subject: "Gmail forwarding confirmation",
        text: "Confirm at data:text/plain,no",
      })?.url,
      null,
    );
    const codeOnly = extractFixtureAction({
      providerHint: "gmail",
      authenticationResults: "dkim=pass header.d=google.com",
      subject: "Confirmación de reenvío Gmail",
      text: "Código de verificación: ABCD-1234",
    });
    assertEquals(codeOnly?.url, null);
    assertEquals(codeOnly?.code, "ABCD-1234");
  },
);
Deno.test(
  "ordinary bank email is never classified as forwarding verification",
  () => {
    assertEquals(
      detectForwardingVerification(
        "Compra aprobada",
        "Tu compra por COP 42.000 fue aprobada.",
      ),
      null,
    );
  },
);

Deno.test(
  "MIME extraction keeps HTML-only Gmail confirmation anchors without rendering HTML",
  () => {
    const raw =
      'Subject: Gmail forwarding confirmation\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n<p>Confirm forwarding</p><a href="https://mail-settings.google.com/mail/confirm?x=1&amp;y=2">Confirm forwarding</a>';
    const content = extractMailContent(raw);
    const hit = extractFixtureAction({
      providerHint: "gmail",
      authenticationResults: "dkim=pass header.d=google.com",
      subject: content.subject,
      text: content.text,
      links: content.htmlLinks,
    });
    assertEquals(content.htmlLinks[0]?.href.includes("x=1&y=2"), true);
    assertEquals(hit?.action.kind, "safe_url");
  },
);
Deno.test(
  "nested multipart and quoted-printable Proton accept action are extracted while attachments are ignored",
  () => {
    const raw =
      'Subject: Proton forwarding invitation\r\nContent-Type: multipart/mixed; boundary=outer\r\n\r\n--outer\r\nContent-Type: multipart/alternative; boundary=inner\r\n\r\n--inner\r\nContent-Type: text/html\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<p>Accept forwarding</p><a href=3D"https://account.proton.me/forward?ok=3D1">Accept forwarding</a>\r\n--inner--\r\n--outer\r\nContent-Type: text/plain; name=bad.txt\r\nContent-Disposition: attachment\r\n\r\nhttps://evil.example/confirm\r\n--outer--';
    const content = extractMailContent(raw);
    const hit = extractFixtureAction({
      providerHint: "proton",
      authenticationResults: "dkim=pass header.d=proton.me",
      subject: content.subject,
      text: content.text,
      links: content.htmlLinks,
    });
    assertEquals(hit?.provider, "proton");
    assertEquals(hit?.url?.startsWith("https://account.proton.me/"), true);
  },
);
Deno.test(
  "base64 HTML and decline links never select a destructive action",
  () => {
    const html =
      '<a href="https://account.proton.me/decline">Decline forwarding</a>';
    const raw =
      "Subject: Proton forwarding invitation\r\nContent-Type: text/html\r\nContent-Transfer-Encoding: base64\r\n\r\n" +
      btoa(html);
    const content = extractMailContent(raw);
    const hit = extractFixtureAction({
      providerHint: "proton",
      authenticationResults: "dkim=pass header.d=proton.me",
      subject: content.subject,
      text: content.text,
      links: content.htmlLinks,
    });
    assertEquals(hit?.action.kind, "instructions_only");
  },
);
Deno.test("lookalike, javascript and data URLs never become actions", () => {
  for (
    const url of [
      "https://google.com.evil.example/confirm",
      "javascript:alert(1)",
      "data:text/plain,test",
    ]
  ) {
    const hit = extractFixtureAction({
      providerHint: "gmail",
      authenticationResults: "dkim=pass header.d=google.com",
      subject: "Gmail forwarding confirmation",
      text: "Confirm forwarding",
      links: [
        { href: url, visibleText: "Confirm forwarding", surroundingText: "" },
      ],
    });
    assertEquals(hit?.url, null);
  }
});

Deno.test("provider words and spoofable hints do not authenticate an approval action", () => {
  for (
    const input of [
      {
        providerHint: "gmail" as const,
        subject: "Gmail forwarding confirmation",
        text:
          "Confirm forwarding https://mail-settings.google.com/mail/vf-test",
      },
      {
        from: "x-google-smtp-source@example.test",
        subject: "Gmail forwarding confirmation",
        text:
          "Confirm forwarding https://mail-settings.google.com/mail/vf-test",
      },
      {
        subject: "Notice",
        text:
          "Proton says confirm forwarding https://account.proton.me/forward",
      },
    ]
  ) assertEquals(detectForwardingVerification(input), null);
});
Deno.test("Gmail source mailbox is extracted only from a confirmation context", async () => {
  const { extractGmailForwardingMailbox } = await import("./email-relay.ts");
  assertEquals(
    extractGmailForwardingMailbox(
      "Gmail will receive mail from owner@example.com",
      "ingest.example.com",
    ),
    "owner@example.com",
  );
  assertEquals(
    extractGmailForwardingMailbox(
      "contact owner@example.com",
      "ingest.example.com",
    ),
    null,
  );
  assertEquals(
    extractGmailForwardingMailbox(
      "receive mail from cf+abcdefghijklmnopqrstuvwxabcdefghijklmnop@ingest.example.com",
      "ingest.example.com",
    ),
    null,
  );
});

Deno.test("relay HMAC accepts a configured previous key during bounded overlap", async () => {
  const now = 1_700_000_000_000;
  const timestamp = String(Math.floor(now / 1000));
  const nonce = "123e4567-e89b-12d3-a456-426614174000";
  const body = "{}";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("previous"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${nonce}.${body}`),
    ),
  );
  const signature = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  await verifyRelaySignature({
    secrets: ["current", "previous"],
    timestamp,
    nonce,
    signature,
    body,
    nowMs: now,
  });
  await assertRejects(() =>
    verifyRelaySignature({
      secrets: ["current"],
      timestamp,
      nonce,
      signature,
      body,
      nowMs: now,
    })
  );
});

Deno.test("permanent reproduced provider-auth cross-field exploit and adversarial variants", () => {
  const attacks = [
    "mx.cloudflare.net; spf=pass smtp.mailfrom=attacker.example",
    "mx.cloudflare.net; dkim=pass header.d=attacker.example",
    "mx.cloudflare.net; dkim=pass header.d=google.com.attacker.example",
    "mx.cloudflare.net; dkim=pass header.d=evilgoogle.com",
    "mx.cloudflare.net; spf=pass smtp.mailfrom=attacker.example; dkim=pass header.d=attacker.example",
    "attacker.example; dkim=pass header.d=google.com",
    "mx.cloudflare.net; dkim=fail header.d=google.com; spf=pass smtp.mailfrom=attacker.example",
    "mx.cloudflare.net; dkim=pass header.d=google.com; spf=fail smtp.mailfrom=attacker.example",
    "dkim=pass header.d=google.com",
    "",
  ];
  for (const authenticationResults of attacks) {
    const input = {
      providerHint: "gmail" as const,
      from: '"google.com support" <attacker@attacker.example>',
      envelopeSender: "attacker@attacker.example",
      authenticationResults,
      receivedSpf: "pass google.com",
      arcAuthenticationResults:
        "i=1; mx.google.com; dkim=pass header.d=google.com",
      subject: "Gmail forwarding confirmation",
      text:
        "Confirm https://mail-settings.google.com/mail/vf-test code 123456789 CapitalFlow prueba CF-TEST123456",
    };
    assertEquals(providerEvidence(input).level === "strong", false);
    assertEquals(detectForwardingVerification(input), null);
    // Same providerEvidence gate is used before completing a link challenge.
    assertEquals(
      providerEvidence(input).level === "strong" &&
        /CF-TEST123456/u.test(input.text),
      false,
    );
    assertEquals(originalSenderAuth().level, "unknown");
  }
});

Deno.test("authentication parser binds each PASS to its own identity", () => {
  const verdicts = parseAuthenticationResults(
    "mx.cloudflare.net; dkim=fail header.d=google.com; spf=pass smtp.mailfrom=attacker.example; dkim=pass header.d=attacker.example; spf=fail smtp.mailfrom=google.com; dmarc=pass header.from=attacker.example",
  );
  assertEquals(
    verdicts.map((v) => [v.method, v.result, v.authenticatedDomain]),
    [
      ["dkim", "fail", "google.com"],
      ["spf", "pass", "attacker.example"],
      ["dkim", "pass", "attacker.example"],
      ["spf", "fail", "google.com"],
      ["dmarc", "pass", "attacker.example"],
    ],
  );
  assertEquals(
    verdicts.some((v) =>
      v.result === "pass" && v.authenticatedDomain === "google.com"
    ),
    false,
  );
});

Deno.test("structured positive synthetic identities do not establish runtime provenance", () => {
  for (const domain of ["google.com", "proton.me"]) {
    const raw =
      `mx.cloudflare.net; DKIM=PASS (comment) header.d=${domain.toUpperCase()}.;\r\n DMARC=PASS header.from=${domain}; SPF=PASS smtp.mailfrom=<sender@${domain}>`;
    const verdicts = parseAuthenticationResults(raw);
    assertEquals(verdicts.length, 3);
    assertEquals(
      verdicts.every((v) =>
        v.result === "pass" && v.authenticatedDomain === domain
      ),
      true,
    );
    assertEquals(
      providerEvidence({ subject: null, text: "", authenticationResults: raw })
        .level,
      "unknown",
    );
  }
});

Deno.test("domain identities fail closed for confusion and malformed syntax", () => {
  assertEquals(normalizeAuthDomain("GOOGLE.COM."), "google.com");
  for (
    const domain of [
      "google.com.attacker.example",
      "evilgoogle.com",
      "gооgle.com",
      "",
      "google..com",
      "google.com/path",
      "google.com@attacker.example",
    ]
  ) assertEquals(authDomainMatches(domain, "google.com"), false);
  assertEquals(authIdentityDomain("<sender@GOOGLE.COM.>"), "google.com");
  for (
    const identity of [
      "a@@google.com",
      "a..b@google.com",
      "Display <a@google.com>",
      "@google.com",
    ]
  ) assertEquals(authIdentityDomain(identity), null);
  for (
    const raw of [
      "mx.cloudflare.net; dkim=pass header.d=google.com header.d=attacker.example",
      "mx.cloudflare.net; dkim=pass (unclosed header.d=google.com",
      'mx.cloudflare.net; dkim=pass header.d="google.com',
      "mx.cloudflare.net; dkim=pass header.d=google.com\nspf=pass",
      "x".repeat(4001),
    ]
  ) assertEquals(parseAuthenticationResults(raw), []);
});
