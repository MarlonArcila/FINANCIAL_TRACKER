import assert from "node:assert/strict";
import test from "node:test";

import { parseMailMessage, sanitize, validateDeviceCandidate } from "./financial-parser.ts";

test("mail parser extracts a COP expense and sanitizes account digits", async () => {
  const candidate = await parseMailMessage({
    provider: "gmail",
    externalId: "gmail-1",
    occurredAt: "2026-08-12T14:00:00.000Z",
    sender: "Pagos <noreply@example.test>",
    title: "Compra aprobada",
    text: "Pagaste COP 45.900 en Mercado Uno con tarjeta **1234",
    defaultCurrency: "COP",
  });

  assert.ok(candidate);
  assert.equal(candidate.proposedKind, "expense");
  assert.equal(candidate.amountMinor, 45_900);
  assert.equal(candidate.currency, "COP");
  assert.doesNotMatch(candidate.description ?? "", /1234/u);
});

test("mail parser handles decimal currencies in minor units", async () => {
  const candidate = await parseMailMessage({
    provider: "gmail",
    externalId: "gmail-1",
    occurredAt: "2026-08-12T14:00:00.000Z",
    sender: "Example Client",
    title: "Payment received",
    text: "You received USD 1,234.56 from Example Client",
    defaultCurrency: "USD",
  });

  assert.ok(candidate);
  assert.equal(candidate.proposedKind, "income");
  assert.equal(candidate.amountMinor, 123_456);
});

test("mail parser recognizes multilingual directional transactions and PRUEBA CAPITALFLOW B", async () => {
  const cases = [
    { label: "capitalflow-b", title: "PRUEBA CAPITALFLOW B", text: "Transferencia recibida por COP 26491", currency: "COP", kind: "income", amount: 26_491 },
    { label: "english-merchant", title: "SUCCESS TRANSACTION B", text: "Your transaction was successful at NUCES for USD 20.00", currency: "USD", kind: "expense", amount: 2_000 },
    { label: "portuguese-income", title: "Transferencia recebida", text: "Pagamento recebido BRL 125,50", currency: "BRL", kind: "income", amount: 12_550 },
    { label: "french-expense", title: "Paiement effectue", text: "Paiement effectue EUR 42,50 chez Boulangerie", currency: "EUR", kind: "expense", amount: 4_250 },
    { label: "german-income", title: "Zahlung erhalten", text: "Zahlung erhalten EUR 88,40", currency: "EUR", kind: "income", amount: 8_840 },
    { label: "chinese-expense", title: "\u8d2d\u4e70", text: "\u8d2d\u4e70 CNY 120.50", currency: "CNY", kind: "expense", amount: 12_050 },
    { label: "japanese-income", title: "\u5165\u91d1", text: "\u5165\u91d1 JPY 5000", currency: "JPY", kind: "income", amount: 5_000 },
  ] as const;

  for (const item of cases) {
    const candidate = await parseMailMessage({
      provider: "gmail",
      externalId: item.label,
      occurredAt: "2026-09-03T17:00:00.000Z",
      sender: "Bank <bank@example.test>",
      title: item.title,
      text: item.text,
      defaultCurrency: item.currency,
    });
    assert.ok(candidate, item.label);
    assert.equal(candidate.proposedKind, item.kind, item.label);
    assert.equal(candidate.amountMinor, item.amount, item.label);
    assert.equal(candidate.currency, item.currency, item.label);
  }
});

test("generic successful transaction remains unclassified when direction is absent", async () => {
  const candidate = await parseMailMessage({
    provider: "gmail",
    externalId: "ambiguous-success",
    occurredAt: "2026-09-03T17:00:00.000Z",
    sender: "Bank <bank@example.test>",
    title: "SUCCESS TRANSACTION",
    text: "Your transaction was successful for USD 42.00",
    defaultCurrency: "USD",
  });
  assert.equal(candidate, null);
});

test("device candidates are canonicalized by the server", async () => {
  const raw = {
    localId: "local-notification-1",
    provider: "android_notification",
    externalId: null,
    appPackage: "com.example.wallet",
    occurredAt: "2026-08-12T14:00:00.000Z",
    proposedKind: "expense",
    amountMinor: 45_900,
    currency: "COP",
    merchant: "Mercado Uno",
    description: "Pagaste COP 45.900 en Mercado Uno",
    confidence: 0.91,
    fingerprint: "untrusted-client-fingerprint",
    dedupeKey: "untrusted-client-dedupe",
    reasons: ["Amount detected"],
    parserVersion: "android-test",
  };

  const candidate = await validateDeviceCandidate(raw);
  assert.ok(candidate);
  assert.notEqual(candidate.fingerprint, raw.fingerprint);
  assert.notEqual(candidate.dedupeKey, raw.dedupeKey);
  assert.equal(candidate.amountMinor, 45_900);
});

test("OTP and failed payment messages are rejected", async () => {
  const otp = await parseMailMessage({
    provider: "gmail",
    externalId: "otp-1",
    occurredAt: "2026-08-12T14:00:00.000Z",
    sender: "Bank",
    title: "Código de verificación",
    text: "Tu código OTP es 123456",
    defaultCurrency: "COP",
  });
  const failed = await parseMailMessage({
    provider: "gmail",
    externalId: "failed-1",
    occurredAt: "2026-08-12T14:00:00.000Z",
    sender: "Bank",
    title: "Pago rechazado",
    text: "Compra fallida por COP 20.000",
    defaultCurrency: "COP",
  });

  assert.equal(otp, null);
  assert.equal(failed, null);
});

test("sanitizer redacts emails, codes, and long account-like digit runs", () => {
  const value = sanitize("ana@example.com código 123456 cuenta 1234 5678 9012 3456");
  assert.doesNotMatch(value, /ana@example\.com/u);
  assert.doesNotMatch(value, /123456/u);
  assert.doesNotMatch(value, /1234 5678 9012 3456/u);
});
