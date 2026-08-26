import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "./http.ts";
import { enforceUserRateLimit, RATE_LIMIT_POLICIES } from "./rate-limit.ts";

function serviceResult(data: unknown, error: unknown = null) {
  return {
    rpc: () => ({ single: async () => ({ data, error }) }),
  } as never;
}

test("rate-limit policies are bounded and route-specific", () => {
  const policies = Object.values(RATE_LIMIT_POLICIES);
  assert.equal(new Set(policies.map((policy) => policy.scope)).size, policies.length);
  for (const policy of policies) {
    assert.match(policy.scope, /^[a-z0-9_.:-]{1,80}$/u);
    assert.ok(policy.limit >= 1 && policy.limit <= 100);
    assert.ok(policy.windowSeconds >= 60 && policy.windowSeconds <= 600);
  }
});

test("allows an authenticated user while capacity remains", async () => {
  const result = await enforceUserRateLimit(
    serviceResult({ allowed: true, remaining: 3, retry_after_seconds: 42 }),
    "00000000-0000-4000-8000-000000000001",
    RATE_LIMIT_POLICIES.GMAIL_SYNC,
  );
  assert.deepEqual(result, { remaining: 3, retryAfterSeconds: 42 });
});

test("returns a controlled 429 when the window is exhausted", async () => {
  await assert.rejects(
    () => enforceUserRateLimit(
      serviceResult({ allowed: false, remaining: 0, retry_after_seconds: 31 }),
      "00000000-0000-4000-8000-000000000001",
      RATE_LIMIT_POLICIES.WHOP_CHECKOUT,
    ),
    (error: unknown) => error instanceof HttpError
      && error.status === 429
      && error.message === "rate_limited"
      && (error.details as { retryAfterSeconds?: number }).retryAfterSeconds === 31,
  );
});

test("fails closed when the rate-limit service is unavailable or malformed", async () => {
  await assert.rejects(
    () => enforceUserRateLimit(
      serviceResult(null, { code: "PGRST202" }),
      "00000000-0000-4000-8000-000000000001",
      RATE_LIMIT_POLICIES.AI_ADVISOR,
    ),
    (error: unknown) => error instanceof HttpError && error.status === 503 && error.message === "rate_limit_unavailable",
  );
  await assert.rejects(
    () => enforceUserRateLimit(
      serviceResult({ allowed: "yes", remaining: -1, retry_after_seconds: 0 }),
      "00000000-0000-4000-8000-000000000001",
      RATE_LIMIT_POLICIES.AI_ADVISOR,
    ),
    (error: unknown) => error instanceof HttpError && error.status === 503 && error.message === "rate_limit_unavailable",
  );
});
