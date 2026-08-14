import type { CandidateKind, CandidateProvider, DuplicateComparable } from "./domain.js";

export function createSourceFingerprint(input: {
  provider: CandidateProvider;
  externalId?: string;
  appPackage?: string;
  occurredAt: string;
  text: string;
}): string {
  const identity = input.externalId
    ? `${input.provider}|external|${input.externalId}`
    : `${input.provider}|${input.appPackage ?? ""}|${normalizeText(input.text)}|${input.occurredAt}`;
  return fnv1a64(identity);
}

export function createCrossSourceDedupeKey(input: {
  kind: CandidateKind;
  amountMinor: number;
  currency: string;
  merchant: string | null;
  occurredAt: string;
}): string {
  // Time is deliberately excluded: the duplicate window is evaluated separately.
  // This keeps the key stable across sources even when their timestamps straddle a bucket boundary.
  return fnv1a64(
    [
      input.kind,
      input.amountMinor,
      input.currency.toUpperCase(),
      normalizeText(input.merchant ?? "unknown"),
    ].join("|"),
  );
}

export function isLikelyDuplicate(
  left: DuplicateComparable,
  right: DuplicateComparable,
  maxMinutes = 15,
): boolean {
  if (left.proposedKind !== right.proposedKind) return false;
  if (left.amountMinor !== right.amountMinor) return false;
  if (left.currency.toUpperCase() !== right.currency.toUpperCase()) return false;

  const leftTime = Date.parse(left.occurredAt);
  const rightTime = Date.parse(right.occurredAt);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return false;
  if (Math.abs(leftTime - rightTime) > maxMinutes * 60_000) return false;

  const leftMerchant = normalizeText(left.merchant ?? "");
  const rightMerchant = normalizeText(right.merchant ?? "");
  if (!leftMerchant || !rightMerchant) return true;
  return tokenSimilarity(leftMerchant, rightMerchant) >= 0.6;
}

export function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

function tokenSimilarity(left: string, right: string): number {
  const a = new Set(left.split(" ").filter(Boolean));
  const b = new Set(right.split(" ").filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
