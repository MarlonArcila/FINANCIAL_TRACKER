import assert from "node:assert/strict";
import test from "node:test";

import { HttpError, errorResponse, safeErrorLogRecord } from "./http.ts";
import { requireCronSecret } from "./cron.ts";
import { canConsumeStorageOAuthState, canUseGmailPubSubTokenFallback, requireWhopWebhookSecret, validateGooglePubSubClaims, verifyConfiguredWhopSignature } from "./external-auth.ts";
import { canConsumeOAuthState, consumeOAuthState, requireOAuthCallbackState } from "./oauth-state.ts";
import { consumeStorageOAuthState } from "./storage-oauth.ts";

test("rejects Pub/Sub OIDC claims without the configured service account", () => {
  assert.throws(
    () => validateGooglePubSubClaims({ email: "attacker@example.test", email_verified: true }, "expected@example.test"),
    (error: unknown) => error instanceof HttpError && error.message === "unexpected_pubsub_service_account",
  );
  assert.throws(
    () => validateGooglePubSubClaims({ email: "expected@example.test", email_verified: true }, null),
    (error: unknown) => error instanceof HttpError && error.message === "missing_pubsub_service_account_config",
  );
});

test("allows the Gmail Pub/Sub token fallback only for local tests", () => {
  assert.equal(canUseGmailPubSubTokenFallback("local"), true);
  assert.equal(canUseGmailPubSubTokenFallback("test"), true);
  assert.equal(canUseGmailPubSubTokenFallback("production"), false);
  assert.equal(canUseGmailPubSubTokenFallback(null), false);
});

test("rejects expired and already consumed storage OAuth states", () => {
  const now = Date.parse("2026-08-15T12:00:00.000Z");
  assert.equal(canConsumeStorageOAuthState({ expires_at: "2026-08-15T12:01:00.000Z", used_at: null }, now), true);
  assert.equal(canConsumeStorageOAuthState({ expires_at: "2026-08-15T11:59:59.000Z", used_at: null }, now), false);
  assert.equal(canConsumeStorageOAuthState({ expires_at: "2026-08-15T12:01:00.000Z", used_at: "2026-08-15T11:00:00.000Z" }, now), false);
  assert.equal(canConsumeStorageOAuthState({ expires_at: "not-a-date", used_at: null }, now), false);
});

test("rejects an invalid CRON secret", () => {
  const request = new Request("https://edge.example.test", { headers: { "x-cron-secret": "wrong" } });
  assert.throws(
    () => requireCronSecret(request, "expected"),
    (error: unknown) => error instanceof HttpError && error.message === "invalid_cron_secret",
  );
});

test("rejects missing, nonexistent, expired, and reused OAuth states", () => {
  const now = Date.parse("2026-08-15T12:00:00.000Z");
  assert.throws(() => requireOAuthCallbackState(null), (error: unknown) => error instanceof HttpError && error.status === 400);
  assert.equal(canConsumeOAuthState(null, "gmail", now), false);
  assert.equal(canConsumeOAuthState({ provider: "gmail", expires_at: "2026-08-15T11:59:59.000Z", used_at: null }, "gmail", now), false);
  assert.equal(canConsumeOAuthState({ provider: "gmail", expires_at: "2026-08-15T12:01:00.000Z", used_at: "2026-08-15T11:30:00.000Z" }, "gmail", now), false);
});

test("returns controlled Whop errors without configuration or for an invalid configured signature", () => {
  assert.throws(() => requireWhopWebhookSecret(null), (error: unknown) => error instanceof HttpError && error.status === 503 && error.message === "webhook_not_configured");
  assert.throws(() => verifyConfiguredWhopSignature(true, () => { throw new Error("invalid"); }), (error: unknown) => error instanceof HttpError && error.status === 401 && error.message === "invalid_webhook_signature");
});

test("does not flag a normal Supabase authentication message but detects a Bearer value", async () => {
  const previous = process.env.SMOKE_TEST_IMPORT;
  process.env.SMOKE_TEST_IMPORT = "1";
  const { findSensitiveResponseRule } = await import("../../../scripts/smoke-test-edge-functions.mjs?test=security-boundaries");
  if (previous === undefined) delete process.env.SMOKE_TEST_IMPORT; else process.env.SMOKE_TEST_IMPORT = previous;
  assert.equal(findSensitiveResponseRule("Missing authorization header"), null);
  assert.equal(findSensitiveResponseRule("Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature"), "bearer_token_value");
});

const validState = "a".repeat(43);
const consumedRow = { user_id: "00000000-0000-4000-8000-000000000001", provider: "gmail", code_verifier: "verifier", return_url: "https://app.example.test/callback" };

function rpcService(results: Array<{ data: typeof consumedRow | null; error: unknown }>) {
  return { rpc: () => ({ maybeSingle: async () => results.shift() ?? { data: null, error: null } }) } as never;
}

test("OAuth RPC returns 400 for nonexistent or used state and returns only a successful consumed row", async () => {
  await assert.rejects(() => consumeOAuthState(rpcService([{ data: null, error: null }]), validState, "gmail"), (error: unknown) => error instanceof HttpError && error.status === 400);
  const consumed = await consumeOAuthState(rpcService([{ data: consumedRow, error: null }]), validState, "gmail");
  assert.deepEqual(consumed, { userId: consumedRow.user_id, codeVerifier: consumedRow.code_verifier, returnUrl: consumedRow.return_url });
});

test("only one concurrent OAuth state consumption succeeds", async () => {
  let consumed = false;
  const service = { rpc: () => ({ maybeSingle: async () => {
    if (consumed) return { data: null, error: null };
    consumed = true;
    return { data: consumedRow, error: null };
  } }) } as never;
  const outcomes = await Promise.allSettled([consumeOAuthState(service, validState, "gmail"), consumeOAuthState(service, validState, "gmail")]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
});

test("storage OAuth uses the same RPC failure boundary", async () => {
  await assert.rejects(() => consumeStorageOAuthState(rpcService([{ data: null, error: null }]), validState), (error: unknown) => error instanceof HttpError && error.status === 400);
  await assert.rejects(() => consumeStorageOAuthState(rpcService([{ data: null, error: { code: "PGRST106", status: 406, message: "state access_token Authorization" } }]), validState), (error: unknown) => error instanceof HttpError && error.status === 503 && error.message === "oauth_state_service_unavailable");
});

test("PostgREST errors log only a structured sanitized record", async () => {
  const record = safeErrorLogRecord({ code: "PGRST106", status: 406, message: "state=secret oauth_code=secret access_token=secret Authorization: Bearer secret" });
  assert.deepEqual(record, { event: "edge_function_failure", error_type: "postgrest", error_code: "PGRST106", status: 406 });
  const lines: string[] = [];
  const original = console.error;
  console.error = (value: unknown) => lines.push(String(value));
  try {
    const response = errorResponse({ code: "PGRST106", status: 406, message: "access_token=secret" });
    assert.deepEqual(await response.json(), { error: "internal_error" });
  } finally { console.error = original; }
  assert.equal(lines.length, 1);
  assert.equal(lines[0], JSON.stringify(record));
  assert.equal(lines[0].includes("[object Object]"), false);
  assert.equal(/state|oauth_code|access_token|authorization/i.test(lines[0]), false);
});

test("does not return an unexpected error message to the caller", async () => {
  const response = errorResponse(new Error("access_token=not-for-client"));
  const body = await response.json() as { error: string };
  assert.deepEqual(body, { error: "internal_error" });
});
