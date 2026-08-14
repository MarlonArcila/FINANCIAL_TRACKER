import type { DetectedCandidate, FinancialEventInput } from "../domain.js";
import { createCrossSourceDedupeKey, createSourceFingerprint } from "../dedupe.js";
import { parseLocalizedMoney } from "../money.js";
import { classifyDirection, isLikelyNoise } from "./classify.js";
import { extractMerchant } from "./merchant.js";
import { PARSER_VERSION } from "./rules.js";
import { sanitizeFinancialText } from "./sanitize.js";

export function parseFinancialEvent(input: FinancialEventInput): DetectedCandidate | null {
  const combined = [input.title, input.sender, input.text].filter(Boolean).join(" | ");
  if (isLikelyNoise(combined)) return null;

  const money = parseLocalizedMoney(combined, input.defaultCurrency ?? "COP");
  if (!money) return null;

  const direction = classifyDirection(combined);
  if (!direction.kind) return null;

  const merchant = extractMerchant(input.text, input.title, input.sender);
  const sanitized = sanitizeFinancialText([input.title, input.text].filter(Boolean).join(" — "));
  const occurredAt = normalizeDate(input.occurredAt);

  let confidence = 0.25 + money.confidence * 0.35 + direction.confidence * 0.35;
  if (merchant) confidence += 0.05;
  confidence = Math.min(0.99, Math.max(0, confidence));
  if (confidence < 0.55) return null;

  const fingerprint = createSourceFingerprint({
    provider: input.provider,
    ...(input.externalId ? { externalId: input.externalId } : {}),
    ...(input.appPackage ? { appPackage: input.appPackage } : {}),
    occurredAt,
    text: sanitized,
  });
  const dedupeKey = createCrossSourceDedupeKey({
    kind: direction.kind,
    amountMinor: money.amountMinor,
    currency: money.currency,
    merchant,
    occurredAt,
  });

  return {
    localId: input.externalId ?? crypto.randomUUID(),
    provider: input.provider,
    externalId: input.externalId ?? null,
    appPackage: input.appPackage ?? null,
    occurredAt,
    proposedKind: direction.kind,
    amountMinor: money.amountMinor,
    currency: money.currency,
    merchant,
    description: sanitized || null,
    confidence: Number(confidence.toFixed(4)),
    fingerprint,
    dedupeKey,
    reasons: [
      `Amount detected as ${money.rawAmount} ${money.currency}.`,
      ...direction.reasons,
      ...(merchant ? [`Merchant/source inferred as ${merchant}.`] : []),
    ],
    parserVersion: PARSER_VERSION,
  };
}

export { classifyDirection, isLikelyNoise } from "./classify.js";
export { extractMerchant } from "./merchant.js";
export { sanitizeFinancialText } from "./sanitize.js";
export { PARSER_VERSION } from "./rules.js";

function normalizeDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}
