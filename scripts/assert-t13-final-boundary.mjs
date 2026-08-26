import fs from "node:fs";

function fail(message) {
  console.error(`STOP: ${message}`);
  process.exit(1);
}

const config = fs.readFileSync("supabase/config.toml", "utf8");
const health = fs.readFileSync("supabase/functions/health-status/index.ts", "utf8");
const migrations = fs.readdirSync("supabase/migrations").filter((name) => name.endsWith("_t13_operational_health.sql"));
const rlsTest = fs.readFileSync("supabase/tests/database/rls_tenant_isolation.test.sql", "utf8");
const pilot = fs.readFileSync("scripts/pilot-readiness.sh", "utf8");
const apk = fs.readFileSync("scripts/build-signed-apk.sh", "utf8");

if (migrations.length !== 1) fail(`health_migration_count:${migrations.length}`);
const migration = fs.readFileSync(`supabase/migrations/${migrations[0]}`, "utf8");
for (const required of ["public.service_operational_health()", "security definer", "set search_path = ''", "grant execute on function public.service_operational_health() to service_role"]) {
  if (!migration.toLowerCase().includes(required.toLowerCase())) fail(`health_migration_missing:${required}`);
}
if (!config.includes("[functions.health-status]") || !/\[functions\.health-status\][\s\S]*?verify_jwt\s*=\s*false/u.test(config)) fail("health_custom_auth_config_missing");
if (!health.includes("requireCronSecret(request)")) fail("health_cron_secret_boundary_missing");
if (!health.includes('service.rpc("service_operational_health")')) fail("health_rpc_call_missing");
if (!rlsTest.includes("tenant A cannot read tenant B account")) fail("two_tenant_rls_assertion_missing");
if (!pilot.includes("GOOGLE_DRIVE_REAL_OAUTH_E2E=EXTERNAL_GATE")) fail("pilot_external_gate_ledger_missing");
if (!apk.includes('"$APKSIGNER" verify')) fail("signed_apk_verification_missing");
console.log("T13_FINAL_BOUNDARY=GREEN");
