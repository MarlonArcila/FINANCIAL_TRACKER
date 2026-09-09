import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  detectForwardingVerification,
  extractAliasToken,
  extractMailContent,
  extractTextFromMime,
  isDifferentRelaySource,
  verifyRelaySignature,
} from "./email-relay.ts";
import { parseMailMessage } from "./financial-parser.ts";

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
  const hit = detectForwardingVerification({
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
    const english = detectForwardingVerification({
      providerHint: "gmail",
      authenticationResults: "dkim=pass header.d=google.com",
      subject: "Gmail forwarding confirmation",
      text:
        "Confirm forwarding: https://mail-settings.google.com/mail/vf-test code 12345678",
    });
    const spanish = detectForwardingVerification({
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
      detectForwardingVerification({
        providerHint: "gmail",
        authenticationResults: "dkim=pass header.d=google.com",
        subject: "Gmail forwarding confirmation",
        text: "Confirm at http://evil.example/verify",
      })?.action.kind,
      "instructions_only",
    );
    assertEquals(
      detectForwardingVerification({
        providerHint: "gmail",
        authenticationResults: "dkim=pass header.d=google.com",
        subject: "Gmail forwarding confirmation",
        text: "Confirm at javascript:alert(1)",
      })?.url,
      null,
    );
    assertEquals(
      detectForwardingVerification({
        providerHint: "gmail",
        authenticationResults: "dkim=pass header.d=google.com",
        subject: "Gmail forwarding confirmation",
        text: "Confirm at data:text/plain,no",
      })?.url,
      null,
    );
    const codeOnly = detectForwardingVerification({
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
    const hit = detectForwardingVerification({
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
    const hit = detectForwardingVerification({
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
    const hit = detectForwardingVerification({
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
    const hit = detectForwardingVerification({
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
