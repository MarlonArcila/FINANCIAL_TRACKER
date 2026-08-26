import fs from "node:fs";

const expected = new Map([
  ["supabase/functions/gmail-oauth-start/index.ts", "RATE_LIMIT_POLICIES.GMAIL_OAUTH_START"],
  ["supabase/functions/storage-oauth-start/index.ts", "RATE_LIMIT_POLICIES.STORAGE_OAUTH_START"],
  ["supabase/functions/gmail-sync/index.ts", "RATE_LIMIT_POLICIES.GMAIL_SYNC"],
  ["supabase/functions/ai-advisor/index.ts", "RATE_LIMIT_POLICIES.AI_ADVISOR"],
  ["supabase/functions/whop-checkout/index.ts", "RATE_LIMIT_POLICIES.WHOP_CHECKOUT"],
]);

const failures = [];
for (const [file, policy] of expected) {
  const source = fs.readFileSync(file, "utf8");
  if (!source.includes('from "../_shared/rate-limit.ts"')) failures.push(`${file}:missing_rate_limit_import`);
  if (!source.includes(`await enforceUserRateLimit(service, user.id, ${policy})`)) failures.push(`${file}:missing_${policy}`);
}

const helper = fs.readFileSync("supabase/functions/_shared/rate-limit.ts", "utf8");
if (!helper.includes('service.rpc("service_take_rate_limit"')) failures.push("helper:missing_service_rpc");
if (!helper.includes('new HttpError(429, "rate_limited"')) failures.push("helper:missing_429");
if (!helper.includes('new HttpError(503, "rate_limit_unavailable"')) failures.push("helper:missing_fail_closed");

const migrations = fs.readdirSync("supabase/migrations").filter((name) => name.endsWith("_t13_rate_limit.sql"));
if (migrations.length !== 1) failures.push(`migration:expected_one_found_${migrations.length}`);
else {
  const sql = fs.readFileSync(`supabase/migrations/${migrations[0]}`, "utf8").toLowerCase();
  const required = [
    "create table private.rate_limit_windows",
    "alter table private.rate_limit_windows enable row level security",
    "revoke all on table private.rate_limit_windows from public, anon, authenticated, service_role",
    "create or replace function public.service_take_rate_limit",
    "security definer",
    "set search_path = ''",
    "revoke all on function public.service_take_rate_limit(text,text,integer,integer) from public, anon, authenticated",
    "grant execute on function public.service_take_rate_limit(text,text,integer,integer) to service_role",
  ];
  for (const item of required) if (!sql.includes(item.toLowerCase())) failures.push(`migration:missing:${item}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("EDGE_RATE_LIMIT_BOUNDARY=GREEN");
