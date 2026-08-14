import type { DirectionClassification } from "../domain.js";
import {
  EXPENSE_STRONG,
  EXPENSE_WEAK,
  INCOME_STRONG,
  INCOME_WEAK,
  NOISE_PATTERNS,
} from "./rules.js";

export function isLikelyNoise(text: string): boolean {
  const normalized = normalize(text);
  const hasTransactionalVerb = [...EXPENSE_STRONG, ...INCOME_STRONG].some((keyword) =>
    normalized.includes(normalize(keyword)),
  );

  return NOISE_PATTERNS.some((pattern) => pattern.test(normalized)) && !hasTransactionalVerb;
}

export function classifyDirection(text: string): DirectionClassification {
  const normalized = normalize(text);
  const expenseStrong = matched(normalized, EXPENSE_STRONG);
  const incomeStrong = matched(normalized, INCOME_STRONG);
  const expenseWeak = matched(normalized, EXPENSE_WEAK);
  const incomeWeak = matched(normalized, INCOME_WEAK);

  let expenseScore = expenseStrong.length * 3 + expenseWeak.length;
  let incomeScore = incomeStrong.length * 3 + incomeWeak.length;

  // Negations and reversals change the meaning of otherwise strong words.
  if (/reversad[oa]|reversión|reversion|reversed|refund|reembolso/iu.test(normalized)) {
    if (expenseScore > incomeScore) incomeScore += 4;
  }

  if (/fallid[oa]|rechazad[oa]|declined|failed|cancelad[oa]/iu.test(normalized)) {
    return {
      kind: null,
      confidence: 0,
      reasons: ["The event describes a failed, declined, or canceled movement."],
    };
  }

  if (expenseScore === 0 && incomeScore === 0) {
    return { kind: null, confidence: 0, reasons: ["No income or expense direction signal found."] };
  }

  if (expenseScore === incomeScore) {
    return { kind: null, confidence: 0.35, reasons: ["Income and expense signals are ambiguous."] };
  }

  const kind = expenseScore > incomeScore ? "expense" : "income";
  const winner = Math.max(expenseScore, incomeScore);
  const loser = Math.min(expenseScore, incomeScore);
  const confidence = Math.min(1, 0.58 + (winner - loser) * 0.09);
  const keywords = kind === "expense" ? [...expenseStrong, ...expenseWeak] : [...incomeStrong, ...incomeWeak];

  return {
    kind,
    confidence,
    reasons: [
      `${kind === "expense" ? "Expense" : "Income"} keywords: ${keywords.join(", ") || "weak context"}.`,
    ],
  };
}

function matched(text: string, keywords: readonly string[]): string[] {
  return keywords.filter((keyword) => text.includes(normalize(keyword)));
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}
