import { syncGmailConnection, type MailConnection } from "../_shared/gmail.ts";
import { enqueueMailSync } from "../_shared/mail-jobs.ts";
import { errorResponse, handleOptions, HttpError, json } from "../_shared/http.ts";
import { withAdditionalCors } from "../_shared/additional-cors.ts";
import { enforceUserRateLimit, RATE_LIMIT_POLICIES } from "../_shared/rate-limit.ts";
import { assertEntitled, createServiceClient, requireUser } from "../_shared/supabase.ts";
import { claimMailSyncJobs, finishMailSyncJob, safeWorkerErrorCode } from "../_shared/worker-leases.ts";
Deno.serve((request) => withAdditionalCors(request, async () => { const preflight = handleOptions(request); if (preflight) return preflight; try {
  if (request.method !== "POST") throw new HttpError(405, "method_not_allowed"); const { user } = await requireUser(request); const service = createServiceClient(); await assertEntitled(service, user.id); await enforceUserRateLimit(service, user.id, RATE_LIMIT_POLICIES.GMAIL_SYNC);
  const { data: connection, error } = await service.from("source_connections").select("*").eq("user_id", user.id).eq("provider", "gmail").maybeSingle(); if (error) throw error; if (!connection) throw new HttpError(404, "gmail_not_connected");
  const { data: profile, error: profileError } = await service.from("profiles").select("base_currency").eq("id", user.id).single(); if (profileError) throw profileError;
  await enqueueMailSync(service, connection.id, "gmail", null); const [claim] = await claimMailSyncJobs(service, 1, connection.id); if (!claim) return json({ status: "sync_in_progress" }, 202);
  try { const manualConnection = { ...(connection as MailConnection), last_sync_at: null }; const result = await syncGmailConnection(service, manualConnection, profile.base_currency); const { data: refreshed } = await service.from("source_connections").select("cursor").eq("id", connection.id).single(); await finishMailSyncJob(service, claim, "succeeded", { cursor: refreshed?.cursor ?? null, scanned: result.scanned, inserted: result.inserted, duplicates: result.duplicates }); return json(result); }
  catch (syncError) { await finishMailSyncJob(service, claim, "failed", { errorCode: safeWorkerErrorCode(syncError) }); throw syncError; }
} catch (error) { return errorResponse(error); } }));
