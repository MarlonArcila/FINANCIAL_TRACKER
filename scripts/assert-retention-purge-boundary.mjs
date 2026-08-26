import fs from "node:fs";

const failures = [];
const migrations = fs.readdirSync("supabase/migrations").filter((name) => name.endsWith("_t13_retention_purge.sql"));
if (migrations.length !== 1) failures.push(`migration_count:${migrations.length}`);

const migration = migrations.length === 1
  ? fs.readFileSync(`supabase/migrations/${migrations[0]}`, "utf8")
  : "";
const edge = fs.readFileSync("supabase/functions/purge-expired-data/index.ts", "utf8");
const config = fs.readFileSync("supabase/config.toml", "utf8");
const architecture = fs.readFileSync("docs/ARCHITECTURE.md", "utf8");
const deployment = fs.readFileSync("docs/DEPLOYMENT.md", "utf8");

for (const needle of [
  "create table private.retention_policy",
  "alter table private.retention_policy enable row level security",
  "revoke all on table private.retention_policy from public, anon, authenticated, service_role",
  "create or replace function public.service_purge_expired_data()",
  "security definer",
  "set search_path = ''",
  "revoke all on function public.service_purge_expired_data() from public, anon, authenticated",
  "grant execute on function public.service_purge_expired_data() to service_role",
  "create extension if not exists pg_cron",
  "capitalflow-retention-purge-daily",
  "delete from public.transaction_candidates",
  "delete from public.source_events",
  "delete from private.webhook_events",
  "delete from private.rate_limit_windows",
]) {
  if (!migration.toLowerCase().includes(needle.toLowerCase())) failures.push(`migration_missing:${needle}`);
}

if (/delete\s+from\s+private\.audit_events/i.test(migration)) failures.push("audit_events_must_not_be_purged");
if (/truncate\s+(table\s+)?private\.audit_events/i.test(migration)) failures.push("audit_events_must_not_be_truncated");
if (!migration.includes("audit_event_days integer")) failures.push("audit_retention_decision_not_explicit");
if (!migration.includes("values (true, true, 30, 90, null)")) failures.push("provisional_30_90_policy_missing");

if (!edge.includes('requireCronSecret(request)')) failures.push("edge_missing_cron_secret");
if (!edge.includes('service.rpc("service_purge_expired_data")')) failures.push("edge_missing_service_rpc");
if (!edge.includes('new HttpError(503, "retention_purge_unavailable")')) failures.push("edge_missing_fail_closed");

if (!/\[functions\.purge-expired-data\][\s\S]*?verify_jwt\s*=\s*false/.test(config)) failures.push("config_missing_purge_custom_auth");
if (!architecture.includes("`private.retention_policy`")) failures.push("architecture_missing_retention_policy");
if (!deployment.includes("`capitalflow-retention-purge-daily`")) failures.push("deployment_missing_retention_job");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("RETENTION_PURGE_BOUNDARY=GREEN");
