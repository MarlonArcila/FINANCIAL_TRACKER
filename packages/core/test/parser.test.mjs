import assert from "node:assert/strict";
import test from "node:test";

import {
  createCrossSourceDedupeKey,
  isLikelyDuplicate,
  parseFinancialEvent,
  parseLocalizedMoney,
} from "../dist/src/index.js";

test("parses a Colombian peso expense notification", () => {
  const candidate = parseFinancialEvent({
    provider: "android_notification",
    occurredAt: "2026-08-12T14:00:00.000Z",
    appPackage: "com.example.wallet",
    title: "Compra aprobada",
    text: "Compra por $45.900 en MERCADO CENTRAL con tarjeta **1234",
    defaultCurrency: "COP",
  });

  assert.ok(candidate);
  assert.equal(candidate.proposedKind, "expense");
  assert.equal(candidate.amountMinor, 45_900);
  assert.equal(candidate.currency, "COP");
  assert.match(candidate.merchant ?? "", /MERCADO CENTRAL/i);
  assert.doesNotMatch(candidate.description ?? "", /1234/);
});

test("parses a US dollar amount with thousands and decimals", () => {
  const money = parseLocalizedMoney(
    "Payment received: USD 1,234.56 from Example Client",
    "USD",
  );

  assert.ok(money);
  assert.equal(money.amountMinor, 123_456);
  assert.equal(money.currency, "USD");
});

test("parses an incoming transfer", () => {
  const candidate = parseFinancialEvent({
    provider: "gmail",
    externalId: "gmail-message-42",
    occurredAt: "2026-08-12T14:10:00.000Z",
    sender: "Pagos Example <no-reply@example.test>",
    title: "Transferencia recibida",
    text: "Recibiste un abono de COP 250.000 desde Cliente Uno.",
    defaultCurrency: "COP",
  });

  assert.ok(candidate);
  assert.equal(candidate.proposedKind, "income");
  assert.equal(candidate.amountMinor, 250_000);
  assert.equal(candidate.externalId, "gmail-message-42");
});

test("rejects verification-code notifications", () => {
  const candidate = parseFinancialEvent({
    provider: "android_notification",
    occurredAt: "2026-08-12T14:20:00.000Z",
    title: "Código de verificación",
    text: "Tu código de verificación es 684221. No lo compartas.",
  });

  assert.equal(candidate, null);
});

test("rejects failed payment notifications", () => {
  const candidate = parseFinancialEvent({
    provider: "android_notification",
    occurredAt: "2026-08-12T14:25:00.000Z",
    title: "Pago rechazado",
    text: "Tu pago de $90.000 fue rechazado.",
    defaultCurrency: "COP",
  });

  assert.equal(candidate, null);
});

test("creates a stable dedupe key across notification and email candidates", () => {
  const first = createCrossSourceDedupeKey({
    kind: "expense",
    amountMinor: 80_000,
    currency: "COP",
    merchant: "Tienda Uno",
    occurredAt: "2026-08-12T14:00:00.000Z",
  });
  const second = createCrossSourceDedupeKey({
    kind: "expense",
    amountMinor: 80_000,
    currency: "COP",
    merchant: "Tienda Uno",
    occurredAt: "2026-08-12T14:12:00.000Z",
  });

  assert.equal(first, second);
  assert.equal(
    isLikelyDuplicate(
      {
        proposedKind: "expense",
        amountMinor: 80_000,
        currency: "COP",
        merchant: "Tienda Uno",
        occurredAt: "2026-08-12T14:00:00.000Z",
      },
      {
        proposedKind: "expense",
        amountMinor: 80_000,
        currency: "COP",
        merchant: "TIENDA UNO SAS",
        occurredAt: "2026-08-12T14:08:00.000Z",
      },
    ),
    true,
  );
});
