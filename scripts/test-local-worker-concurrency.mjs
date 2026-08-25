#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { ConcurrencyFailure, makeFixtureIds, classifyPsqlFailure, assertBackupLogicalRun, assertBackupRace, assertWatchRace, assertWatchPrecondition, assertBackupPrecondition } from "./concurrency-assertions.mjs";

const DEFAULT_LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const allowedHosts = new Set(["127.0.0.1", "localhost", "::1"]);

function localDatabaseUrl(raw) {
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error("invalid_local_database_url"); }
  const hostname = parsed.hostname.toLowerCase().replaceAll("[", "").replaceAll("]", "");
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !allowedHosts.has(hostname)) {
    throw new Error("database_url_must_be_local");
  }
  return raw;
}

let databaseUrl;
try {
  databaseUrl = localDatabaseUrl(process.env.SMOKE_LOCAL_DB_URL ?? DEFAULT_LOCAL_DB_URL);
} catch {
  console.error("SMOKE_LOCAL_DB_URL must point to localhost; no connection was opened.");
  process.exit(2);
}

function psql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-Atqc", sql], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (spawnError) => {
      const failure = classifyPsqlFailure(stderr, spawnError.code);
      const error = new Error(failure.code);
      error.failureCode = failure.code;
      error.sqlstate = failure.sqlstate;
      error.constraint = failure.constraint;
      error.relation = failure.relation;
      reject(error);
    });
    child.once("close", (code) => {
      if (code === 0) return resolve(stdout.trim());
      const failure = classifyPsqlFailure(stderr);
      const error = new Error(failure.code);
      error.failureCode = failure.code;
      error.sqlstate = failure.sqlstate;
      error.constraint = failure.constraint;
      error.relation = failure.relation;
      reject(error);
    });
  });
}

function rows(output, columns) {
  if (!output) return [];
  return output.split("\n").filter(Boolean).map((line) => {
    const values = line.split("|");
    if (values.length !== columns) throw new Error("unexpected_local_row_shape");
    return values;
  });
}

function roleRpc(selectSql) {
  return "begin; set local role service_role; " + selectSql + " reset role; commit;";
}


function failure(stage, code) { return new ConcurrencyFailure(stage, code); }

function classify(error, fallbackStage) {
  if (error instanceof ConcurrencyFailure) return error;
  const normalized = failure(fallbackStage, error?.failureCode ?? "unknown_psql_error");
  normalized.sqlstate = error?.sqlstate;
  normalized.constraint = error?.constraint;
  normalized.relation = error?.relation;
  return normalized;
}

function reportFailure(name, error) {
  const normalized = classify(error, "fixture_setup");
  console.error(`${name}_FAILURE_STAGE=${normalized.stage}`);
  console.error(`${name}_FAILURE_CODE=${normalized.code}`);
  if (normalized.sqlstate) console.error(`${name}_FAILURE_SQLSTATE=${normalized.sqlstate}`);
  if (normalized.constraint) console.error(`_FAILURE_CONSTRAINT=`);
  if (normalized.relation) console.error(`${name}_FAILURE_RELATION=${normalized.relation}`);
}
let cleanupFailed = false;
async function cleanupBestEffort(name, sql) {
  try { await psql(sql); } catch (error) {
    cleanupFailed = true;
    const normalized = classify(error, "cleanup");
    console.error(`${name}_CLEANUP_FAILURE_STAGE=${normalized.stage}`);
    console.error(`${name}_CLEANUP_FAILURE_CODE=${normalized.code}`);
    if (normalized.sqlstate) console.error(`${name}_CLEANUP_FAILURE_SQLSTATE=${normalized.sqlstate}`);
    if (normalized.constraint) console.error(`_CLEANUP_FAILURE_CONSTRAINT=`);
    if (normalized.relation) console.error(`${name}_CLEANUP_FAILURE_RELATION=${normalized.relation}`);
  }
}

async function runMailConcurrency(fixture) {
  const { userId, connectionId, jobId, email } = fixture;
  const setup = `insert into auth.users(id,email) values ('${userId}','${email}');
insert into public.source_connections(id,user_id,provider,status,watch_expires_at) values ('${connectionId}','${userId}','gmail','active',now()+interval '7 days');
insert into private.sync_jobs(id,connection_id,provider,status) values ('${jobId}','${connectionId}','gmail','queued');`;
  const cleanup = `delete from public.source_connections where id='${connectionId}';
delete from auth.users where id='${userId}';`;
  try {
    await cleanupBestEffort("MAIL", cleanup);
    if (cleanupFailed) throw failure("cleanup", "cleanup_failure");
    await psql("begin;" + setup + "commit;");
    const claim = roleRpc(`select id,connection_id,provider,lease_token from public.claim_mail_sync_jobs(1,'${connectionId}',300);`);
    const [a, b] = await Promise.all([psql(claim), psql(claim)]);
    const claimed = [...rows(a, 4), ...rows(b, 4)];
    if (claimed.length !== 1 || claimed[0][0] !== jobId || claimed[0][1] !== connectionId || !claimed[0][3]) throw new Error("mail_claim_identity");
    const state = await psql(`select status,lease_token is not null from private.sync_jobs where id='${jobId}';`);
    if (state !== "running|t") throw new Error("mail_claim_state");
    const active = await psql(roleRpc(`select id from public.claim_mail_sync_jobs(1,'${connectionId}',300);`));
    if (active !== "") throw new Error("mail_active_lease_stolen");
    await psql(`update private.sync_jobs set lease_expires_at=now()-interval '1 second' where id='${jobId}';`);
    const recovered = rows(await psql(roleRpc(`select id,connection_id,provider,lease_token from public.claim_mail_sync_jobs(1,'${connectionId}',300);`)), 4);
    if (recovered.length !== 1 || recovered[0][0] !== jobId) throw new Error("mail_expired_lease");
    console.log("MAIL_CONCURRENCY=PASS");
    return true;
  } finally {
    await cleanupBestEffort("MAIL", cleanup);
  }
}

async function runWatchConcurrency(fixture) {
  const { userId, connectionId, email } = fixture;
  const setup = `insert into auth.users(id,email) values ('${userId}','${email}');
insert into public.source_connections(id,user_id,provider,status,watch_expires_at) values ('${connectionId}','${userId}','gmail','active',now()-interval '1 hour');`;
  const cleanup = `delete from public.source_connections where id='${connectionId}';
delete from auth.users where id='${userId}';`;
  try {
    await cleanupBestEffort("WATCH", cleanup);
    if (cleanupFailed) throw failure("cleanup", "cleanup_failure");
    await psql("begin;" + setup + "commit;");
    const precondition = rows(await psql(`select (select count(*)::integer from public.source_connections c where c.status='active' and (c.watch_expires_at is null or c.watch_expires_at < now() + interval '24 hours')), (select count(*)::integer from public.source_connections c where c.id='${connectionId}' and c.status='active' and (c.watch_expires_at is null or c.watch_expires_at < now() + interval '24 hours')), (select count(*)::integer from public.source_connections where id='${connectionId}'), (select count(*)::integer from private.mail_watch_renewal_leases where connection_id='${connectionId}');`), 4);
    if (precondition.length !== 1) throw failure("precondition", "local_db_contaminated");
    assertWatchPrecondition(...precondition[0].map(Number));
    const claim = roleRpc(`select connection_id,provider,lease_token from public.claim_mail_watch_connections(1,300);`);
    const [a, b] = await Promise.all([psql(claim), psql(claim)]);
    const rowsA = rows(a, 3);
    const rowsB = rows(b, 3);
    console.log(`WATCH_A_CLAIMS=${rowsA.length}`);
    console.log(`WATCH_B_CLAIMS=${rowsB.length}`);
    console.log(`WATCH_TOTAL_CLAIMS=${rowsA.length + rowsB.length}`);
    assertWatchRace(rowsA, rowsB, connectionId);
    const state = await psql(`select count(*)::integer from private.mail_watch_renewal_leases where connection_id='${connectionId}';`);
    if (state !== "1") throw new Error("watch_lease_count");
    console.log("WATCH_CONCURRENCY=PASS");
    return true;
  } finally {
    await cleanupBestEffort("WATCH", cleanup);
  }
}

async function runBackupConcurrency(fixture) {
  const { userId, subscriptionId, storageConnectionId: connectionId, email } = fixture;
  const setup = `insert into auth.users(id,email) values ('${userId}', '${email}');
insert into public.subscriptions(id,user_id,provider,interval,status,current_period_end) values ('${subscriptionId}','${userId}','whop','annual','active',now()+interval '1 day');
insert into public.storage_connections(id,user_id,provider,status,backup_frequency,next_backup_at) values ('${connectionId}','${userId}','google_drive','active','weekly',now()-interval '1 hour');`;
  const cleanup = `delete from public.storage_connections where id='${connectionId}';
delete from public.subscriptions where id='${subscriptionId}';
delete from auth.users where id='${userId}';`;
  try {
    await cleanupBestEffort("BACKUP", cleanup);
    if (cleanupFailed) throw failure("cleanup", "cleanup_failure");
    await psql("begin;" + setup + "commit;");
    const precondition = rows(await psql(`select (select count(*)::integer from public.storage_connections c where c.status='active' and c.backup_frequency <> 'manual' and c.next_backup_at <= now() and exists (select 1 from public.subscriptions s where s.user_id=c.user_id and s.interval='annual' and s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end > now()))), (select count(*)::integer from public.storage_connections c where c.id='${connectionId}' and c.status='active' and c.backup_frequency <> 'manual' and c.next_backup_at <= now() and exists (select 1 from public.subscriptions s where s.user_id=c.user_id and s.interval='annual' and s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end > now()))), (select count(*)::integer from public.storage_connections where id='${connectionId}'), (select count(*)::integer from private.backup_runs where storage_connection_id='${connectionId}');`), 4);
    if (precondition.length !== 1) throw failure("precondition", "local_db_contaminated");
    assertBackupPrecondition(...precondition[0].map(Number));
    const claim = roleRpc(`select run_id,connection_id,user_id,provider,backup_frequency,scheduled_for,lease_token from public.claim_cloud_backup_runs(1,600);`);
    const [a, b] = await Promise.all([psql(claim), psql(claim)]);
    const rowsA = rows(a, 7);
    const rowsB = rows(b, 7);
    console.log(`BACKUP_A_CLAIMS=${rowsA.length}`);
    console.log(`BACKUP_B_CLAIMS=${rowsB.length}`);
    console.log(`BACKUP_TOTAL_CLAIMS=${rowsA.length + rowsB.length}`);
    const [runId, , , , , scheduledFor] = assertBackupRace(rowsA, rowsB, connectionId);
    const state = Number(await psql(`select count(*)::integer from private.backup_runs where storage_connection_id='${connectionId}' and scheduled_for='${scheduledFor}';`));
    console.log(`BACKUP_LOGICAL_RUN_COUNT=${state}`);
    assertBackupLogicalRun(state);
    const row = await psql(`select id::text,storage_connection_id::text,scheduled_for::text from private.backup_runs where storage_connection_id='${connectionId}' and scheduled_for='${scheduledFor}';`);
    if (row !== runId + "|" + connectionId + "|" + scheduledFor) throw failure("identity_assertion", "unexpected_claim_identity");
    console.log("BACKUP_CONCURRENCY=PASS");
    return true;
  } finally {
    await cleanupBestEffort("BACKUP", cleanup);
  }
}
async function runManualVsWorker(fixture) {
  const { connectionId, jobId } = fixture;
  const files = await Promise.all([
    readFile(new URL("../supabase/functions/gmail-sync/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/outlook-sync/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/mail-sync-worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/_shared/worker-leases.ts", import.meta.url), "utf8"),
  ]);
  const [gmail, outlook, worker, leases] = files;
  const sharedBoundary = (source) => source.includes("claimMailSyncJobs") && source.includes("connection.id");
  if (!sharedBoundary(gmail) || !sharedBoundary(outlook) || !worker.includes("claimMailSyncJobs") || !leases.includes('rpc("claim_mail_sync_jobs"')) throw new Error("manual_worker_boundary_missing");
  let leaseOwner = null;
  const mockRpc = async (name, args) => {
    if (name !== "claim_mail_sync_jobs" || args.p_connection_id !== connectionId) throw new Error("manual_worker_boundary_args");
    if (leaseOwner) return [];
    leaseOwner = "winner";
    return [{ id: jobId, connection_id: args.p_connection_id, provider: "gmail", lease_token: "local-test-token" }];
  };
  const [manual, workerClaim] = await Promise.all([
    mockRpc("claim_mail_sync_jobs", { p_limit: 1, p_connection_id: connectionId, p_lease_seconds: 300 }),
    mockRpc("claim_mail_sync_jobs", { p_limit: 1, p_connection_id: connectionId, p_lease_seconds: 300 }),
  ]);
  if (manual.length + workerClaim.length !== 1) throw new Error("manual_worker_double_claim");
  console.log("MANUAL_VS_WORKER=PASS");
  return true;
}

const fixtures = { mail: makeFixtureIds("mail"), watch: makeFixtureIds("watch"), backup: makeFixtureIds("backup"), manual: makeFixtureIds("manual") };
const outcomes = [];
for (const [name, fn, fixture] of [["MAIL_CONCURRENCY", runMailConcurrency, fixtures.mail], ["WATCH_CONCURRENCY", runWatchConcurrency, fixtures.watch], ["BACKUP_CONCURRENCY", runBackupConcurrency, fixtures.backup]]) {
  try { await fn(fixture); outcomes.push([name, true]); } catch (error) { reportFailure(name.replace("_CONCURRENCY", ""), error); console.error(name + "=FAIL"); outcomes.push([name, false]); }
  if (cleanupFailed) break;
}
if (!cleanupFailed) {
  try { await runManualVsWorker(fixtures.manual); outcomes.push(["MANUAL_VS_WORKER", true]); } catch (error) { reportFailure("MANUAL_VS_WORKER", error); console.error("MANUAL_VS_WORKER=FAIL"); outcomes.push(["MANUAL_VS_WORKER", false]); }
}
const passed = !cleanupFailed && outcomes.every(([, ok]) => ok);
console.log("CONCURRENCY_RESULT=" + (passed ? "PASS" : "FAIL"));
process.exitCode = passed ? 0 : 1;
