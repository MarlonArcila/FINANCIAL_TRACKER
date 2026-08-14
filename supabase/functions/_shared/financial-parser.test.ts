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
    provider: "outlook",
    externalId: "outlook-1",
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
