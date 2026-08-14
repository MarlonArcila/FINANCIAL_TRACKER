import assert from "node:assert/strict";
import test from "node:test";

import { decideAutomationPolicy } from "./automation-policy.ts";

test("auto-posts a high-confidence candidate with resolved account and category", () => {
  const result = decideAutomationPolicy({
    confidence: 0.98,
    accountQuality: 0.995,
    categoryQuality: 0.99,
    autoPostEnabled: true,
    autoPostMinConfidence: 0.94,
    autoReviewMinConfidence: 0.70,
    categoryRequired: false,
  });
  assert.equal(result.outcome, "auto_post");
  assert.ok(result.score >= 0.94);
});

test("requires review when account resolution is ambiguous", () => {
  const result = decideAutomationPolicy({
    confidence: 0.99,
    accountQuality: null,
    categoryQuality: 0.99,
    autoPostEnabled: true,
    autoPostMinConfidence: 0.94,
    autoReviewMinConfidence: 0.70,
    categoryRequired: false,
  });
  assert.deepEqual(result, { outcome: "needs_review", reason: "account_ambiguous_or_missing", score: 0.99 });
});

test("auto-ignores candidates below the configured noise floor", () => {
  const result = decideAutomationPolicy({
    confidence: 0.42,
    accountQuality: 0.99,
    categoryQuality: 0.99,
    autoPostEnabled: true,
    autoPostMinConfidence: 0.94,
    autoReviewMinConfidence: 0.70,
    categoryRequired: false,
  });
  assert.equal(result.outcome, "auto_ignore");
  assert.equal(result.reason, "low_confidence");
});

test("keeps a borderline candidate in review rather than auto-posting", () => {
  const result = decideAutomationPolicy({
    confidence: 0.91,
    accountQuality: 0.96,
    categoryQuality: 0.88,
    autoPostEnabled: true,
    autoPostMinConfidence: 0.94,
    autoReviewMinConfidence: 0.70,
    categoryRequired: false,
  });
  assert.equal(result.outcome, "needs_review");
  assert.equal(result.reason, "confidence_below_auto_post_threshold");
});
