export interface AutomationPolicyInput {
  confidence: number;
  accountQuality: number | null;
  categoryQuality: number | null;
  autoPostEnabled: boolean;
  autoPostMinConfidence: number;
  autoReviewMinConfidence: number;
  categoryRequired: boolean;
}

export interface AutomationPolicyDecision {
  outcome: "auto_post" | "needs_review" | "auto_ignore";
  reason: string;
  score: number;
}

export function decideAutomationPolicy(input: AutomationPolicyInput): AutomationPolicyDecision {
  const confidence = clamp01(input.confidence);
  if (confidence < input.autoReviewMinConfidence) {
    return { outcome: "auto_ignore", reason: "low_confidence", score: roundScore(confidence) };
  }
  if (!input.autoPostEnabled) {
    return { outcome: "needs_review", reason: "automation_disabled", score: roundScore(confidence) };
  }
  if (input.accountQuality === null) {
    return { outcome: "needs_review", reason: "account_ambiguous_or_missing", score: roundScore(confidence) };
  }
  if (input.categoryRequired && input.categoryQuality === null) {
    return { outcome: "needs_review", reason: "category_unresolved", score: roundScore(confidence) };
  }

  const categoryQuality = input.categoryQuality ?? 0.55;
  const score = roundScore(confidence * 0.78 + clamp01(input.accountQuality) * 0.20 + clamp01(categoryQuality) * 0.02);
  const parserFloor = Math.max(0.88, input.autoPostMinConfidence - 0.05);
  if (confidence < parserFloor || score < input.autoPostMinConfidence) {
    return { outcome: "needs_review", reason: "confidence_below_auto_post_threshold", score };
  }
  return { outcome: "auto_post", reason: "high_confidence", score };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function roundScore(value: number): number {
  return Math.round(clamp01(value) * 10_000) / 10_000;
}
