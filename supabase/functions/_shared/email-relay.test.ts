import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { detectGmailForwardingConfirmation, extractAliasToken, extractTextFromMime, verifyRelaySignature } from "./email-relay.ts";
import { parseMailMessage } from "./financial-parser.ts";

Deno.test("email relay extracts high entropy plus alias", () => {
  assertEquals(extractAliasToken(`cf+${"a".repeat(43)}@ingest.example.com`,"ingest.example.com"),"a".repeat(43));
});
Deno.test("email relay rejects wrong domain", () => {
  let ok=false; try { extractAliasToken(`cf+${"a".repeat(43)}@other.example.com`,"ingest.example.com"); } catch { ok=true; }
  assertEquals(ok,true);
});
Deno.test("MIME extraction ignores html execution and yields text", () => {
  const raw="Subject: x\r\nContent-Type: text/html\r\n\r\n<p>Compra por COP 12.500</p><script>alert(1)</script>";
  assertEquals(extractTextFromMime(raw).includes("Compra por COP 12.500"),true);
  assertEquals(extractTextFromMime(raw).includes("alert(1)"),false);
});
Deno.test("Gmail confirmation accepts only google https links", () => {
  const hit=detectGmailForwardingConfirmation("Gmail Forwarding Confirmation","Confirm https://mail-settings.google.com/mail/vf-test code 12345678");
  assertEquals(hit?.url?.startsWith("https://mail-settings.google.com/"),true);
});
Deno.test("quoted-printable UTF-8 remains parseable", () => {
  const raw="Subject: x\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nTransacci=C3=B3n aprobada por COP 12.500";
  assertEquals(extractTextFromMime(raw).includes("Transacción aprobada"),true);
});
Deno.test("invalid HMAC is rejected", async () => {
  const now=1700000000000; const ts=String(Math.floor(now/1000));
  await assertRejects(()=>verifyRelaySignature({secret:"secret",timestamp:ts,nonce:"123e4567-e89b-12d3-a456-426614174000",signature:"0".repeat(64),body:"{}",nowMs:now}));
});
Deno.test("expired signed timestamp is rejected before replay storage", async () => {
  await assertRejects(()=>verifyRelaySignature({secret:"secret",timestamp:"1700000000",nonce:"123e4567-e89b-12d3-a456-426614174000",signature:"0".repeat(64),body:"{}",nowMs:1700001000000}));
});
Deno.test("email_relay reuses multilingual financial parser", async () => {
  const candidate=await parseMailMessage({provider:"email_relay",externalId:"relay-es-1",occurredAt:"2026-09-04T17:00:00.000Z",sender:"Banco",title:"Compra aprobada",text:"Pagaste COP 45.900 en Mercado Uno",defaultCurrency:"COP"});
  assertEquals(candidate?.provider,"email_relay"); assertEquals(candidate?.proposedKind,"expense"); assertEquals(candidate?.amountMinor,45900);
});
Deno.test("non-financial relay mail is ignored by the existing parser", async () => {
  const candidate=await parseMailMessage({provider:"email_relay",externalId:"relay-noise-1",occurredAt:"2026-09-04T17:00:00.000Z",sender:"Boletin",title:"Novedades",text:"Conoce nuestros nuevos beneficios para clientes.",defaultCurrency:"COP"});
  assertEquals(candidate,null);
});
Deno.test("lower-confidence financial relay remains eligible for review instead of forced auto-post", async () => {
  const candidate=await parseMailMessage({provider:"email_relay",externalId:"relay-review-1",occurredAt:"2026-09-04T17:00:00.000Z",sender:"Banco",title:"Compra",text:"Compra COP 42.000",defaultCurrency:"COP"});
  assertEquals(Boolean(candidate && candidate.confidence >= 0.70 && candidate.confidence < 0.94),true);
});
