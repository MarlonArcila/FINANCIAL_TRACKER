#!/usr/bin/env node

const smokeTestImport = process.env.SMOKE_TEST_IMPORT === "1";
const stagingUrl = process.env.SMOKE_SUPABASE_URL?.replace(/\/$/, "");
const smokeUserJwt = process.env.SMOKE_USER_JWT;

if (!stagingUrl && !smokeTestImport) {
  console.error("Missing SMOKE_SUPABASE_URL; no requests were made.");
  process.exit(2);
}

if (!smokeTestImport) try {
  const parsed = new URL(stagingUrl);
  if (parsed.protocol !== "https:") throw new Error("staging URL must use HTTPS");
} catch {
  console.error("Invalid SMOKE_SUPABASE_URL; no requests were made.");
  process.exit(2);
}

const protectedFunctions = [
  "account-manage", "ai-advisor", "cloud-backup-create", "cloud-backup-restore", "delete-account",
  "disconnect-source", "export-data", "fx-rate", "gmail-oauth-start", "gmail-sync", "import-transactions",
  "notification-ingest", "outlook-oauth-start", "outlook-sync", "storage-backup-settings", "storage-disconnect",
  "storage-oauth-start", "transaction-confirm", "whop-checkout",
];
const workerFunctions = ["mail-sync-worker", "renew-mail-watches", "cloud-backup-worker"];
const nonexistentOAuthState = "a".repeat(43);
const responseLeakRules = [
  ["authorization_bearer_value", /\bauthorization\s*:\s*bearer\s+\S+/i],
  ["bearer_token_value", /\bbearer\s+[A-Za-z0-9._~+\/=-]{20,}/i],
  ["supabase_secret_value", /\bsb_secret_[A-Za-z0-9_-]{8,}/i],
  ["service_role_value", /\bservice_role\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/i],
  ["oauth_secret_value", /\b(?:access_token|refresh_token|client_secret)\s*["'=:\s]+[A-Za-z0-9._~+\/=-]{8,}/i],
  ["jwt_value", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ["stack_trace", /\b(?:Error|TypeError|ReferenceError):[^\n]*\n\s*at\s+/],
  ["file_url", /file:\/\//i],
  ["internal_path", /\/(?:home|workspace|app)\/[A-Za-z0-9_./-]+/i],
];

export function findSensitiveResponseRule(body) {
  return responseLeakRules.find(([, pattern]) => pattern.test(body))?.[0] ?? null;
}
if (!smokeTestImport) {
const results = [];

async function request(functionName, test, options, expected, passWhen, query = "") {
  let response;
  let body = "";
  try {
    response = await fetch(`${stagingUrl}/functions/v1/${functionName}${query}`, options);
    body = await response.text();
  } catch {
    results.push({ functionName, test, expected, status: "NETWORK", outcome: "FAIL", notes: "request_failed" });
    return;
  }
  const leakRule = findSensitiveResponseRule(body);
  const leaked = leakRule !== null;
  const pass = passWhen(response.status) && !leaked;
  results.push({
    functionName,
    test,
    expected,
    status: response.status,
    outcome: pass ? "PASS" : "FAIL",
    notes: leaked ? "response_contains_" + leakRule + ";status=" + response.status + ";body_length=" + body.length : "controlled_response",
  });
}

const postJson = (body, headers = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
  redirect: "manual",
});
const rejectsUser = (status) => status === 401 || status === 403;
const rejectsWorker = (status) => status === 401 || status === 403;
const controlledProviderFailure = (status) => [400, 401, 403, 503].includes(status);

for (const functionName of protectedFunctions) {
  await request(functionName, "no_user_jwt", postJson({}), "401_or_403", rejectsUser);
}

for (const functionName of workerFunctions) {
  await request(functionName, "missing_cron_secret", postJson({}), "401_or_403", rejectsWorker);
  await request(
    functionName,
    "invalid_cron_secret",
    postJson({}, { "x-cron-secret": "smoke-test-deliberately-invalid" }),
    "401_or_403",
    rejectsWorker,
  );
  results.push({
    functionName,
    test: "valid_cron_secret",
    expected: "not_run",
    status: "SKIP",
    outcome: "SKIP",
    notes: "not_run_to_avoid_worker_side_effects",
  });
}

for (const functionName of ["gmail-oauth-callback", "outlook-oauth-callback", "storage-oauth-callback"]) {
  await request(
    functionName,
    "random_nonexistent_oauth_state",
    { method: "GET", redirect: "manual" },
    "400_or_401_or_403",
    (status) => [400, 401, 403].includes(status),
    "?code=smoke-invalid&state=" + nonexistentOAuthState,
  );
}

await request("whop-webhook", "missing_signature", postJson({}), "401_or_403_or_503", controlledProviderFailure);
await request(
  "whop-webhook",
  "fake_signature",
  postJson({}, { "webhook-id": "smoke-invalid", "webhook-timestamp": "0", "webhook-signature": "v1,invalid" }),
  "401_or_403_or_503",
  controlledProviderFailure,
);
await request("gmail-pubsub-webhook", "missing_oidc", postJson({}), "401_or_403_or_503", controlledProviderFailure);
await request(
  "outlook-webhook",
  "invalid_client_state",
  postJson({ value: [{ subscriptionId: "smoke-invalid", clientState: "invalid" }] }),
  "401_or_403_or_503",
  controlledProviderFailure,
);

if (smokeUserJwt) {
  const authorized = { authorization: `Bearer ${smokeUserJwt}` };
  for (const functionName of ["gmail-oauth-start", "outlook-oauth-start", "storage-oauth-start", "whop-checkout"]) {
    await request(functionName, "provider_not_configured_with_user", postJson({}, authorized), "controlled_non_2xx", (status) => status >= 400 && status < 600);
  }
} else {
  for (const functionName of ["gmail-oauth-start", "outlook-oauth-start", "storage-oauth-start", "whop-checkout"]) {
    results.push({ functionName, test: "provider_not_configured_with_user", expected: "controlled_non_2xx", status: "SKIP", outcome: "SKIP", notes: "SMOKE_USER_JWT_not_supplied" });
  }
}

console.table(results.map((result) => ({
  Function: result.functionName,
  Test: result.test,
  Expected: result.expected,
  "Actual HTTP status": result.status,
  "PASS/FAIL": result.outcome,
  Notes: result.notes,
})));

const failed = results.filter((result) => result.outcome === "FAIL").length;
const skipped = results.filter((result) => result.outcome === "SKIP").length;
console.log(`Smoke tests: ${results.length}; passed: ${results.length - failed - skipped}; failed: ${failed}; skipped: ${skipped}.`);
process.exitCode = failed ? 1 : 0;
}
