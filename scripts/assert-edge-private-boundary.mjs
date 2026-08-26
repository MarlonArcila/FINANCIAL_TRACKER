import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const functionsRoot = join(root, "supabase", "functions");
const violations = [];

function visit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      visit(path);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    const source = readFileSync(path, "utf8");
    if (/\.schema\(\s*["']private["']\s*\)/u.test(source)) {
      violations.push(relative(root, path));
    }
  }
}

visit(functionsRoot);

const config = readFileSync(join(root, "supabase", "config.toml"), "utf8");
const schemasLine = config.match(/^schemas\s*=\s*\[(.*)\]\s*$/mu)?.[1] ?? "";
if (/(["'])private\1/u.test(schemasLine)) {
  violations.push("supabase/config.toml exposes private schema");
}

const whopWebhook = readFileSync(join(root, "supabase", "functions", "whop-webhook", "index.ts"), "utf8");
if (!whopWebhook.includes('service.rpc("service_apply_whop_membership"')) violations.push("whop-webhook service membership RPC missing");
if (whopWebhook.includes('.from("subscriptions").upsert') || whopWebhook.includes('.from("accounts").update')) violations.push("whop-webhook direct membership/account DML");
const backupSource = readFileSync(join(root, "supabase", "functions", "_shared", "backup.ts"), "utf8");
if (!backupSource.includes('service.rpc("service_build_user_backup"')) violations.push("backup service RPC missing");
if (/service\.from\(/u.test(backupSource)) violations.push("backup direct service-role financial reads");
const gatewayMigrations = readdirSync(join(root, "supabase", "migrations")).filter((name) => name.endsWith("_whop_storage_service_gateway.sql"));
if (gatewayMigrations.length !== 1) violations.push(`whop/storage gateway migration count=${gatewayMigrations.length}`);
else {
  const gateway = readFileSync(join(root, "supabase", "migrations", gatewayMigrations[0]), "utf8").toLowerCase();
  for (const required of ["public.service_apply_whop_membership(", "public.service_build_user_backup(", "security definer", "set search_path = ''", "grant execute on function public.service_apply_whop_membership", "grant execute on function public.service_build_user_backup", "grant select, insert, update on table public.storage_connections", "grant select, insert, update on table public.cloud_backups"]) {
    if (!gateway.includes(required)) violations.push(`whop/storage gateway missing: ${required}`);
  }
}

if (violations.length) {
  console.error("PRIVATE_DATA_API_BOUNDARY=FAIL");
  for (const violation of violations) console.error(` - ${violation}`);
  process.exit(1);
}

console.log("PRIVATE_DATA_API_BOUNDARY=GREEN");
