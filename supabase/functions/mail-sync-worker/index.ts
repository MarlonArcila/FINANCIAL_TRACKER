import { requireCronSecret, requireWorkerEnabled } from "../_shared/cron.ts";
import { syncGmailConnection, type MailConnection } from "../_shared/gmail.ts";
import { errorResponse, handleOptions, HttpError, json } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { claimMailSyncJobs, finishMailSyncJob, safeWorkerErrorCode, type MailSyncClaim } from "../_shared/worker-leases.ts";

Deno.serve(async (request) => {
  const preflight = handleOptions(request); if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    requireCronSecret(request);
    requireWorkerEnabled("MAIL_SYNC_WORKER_ENABLED");
    const service = createServiceClient();
    const limit = clamp(Number(new URL(request.url).searchParams.get("limit") ?? "10"), 1, 25);
    const claims = await claimMailSyncJobs(service, limit);
    let succeeded = 0; let failed = 0;
    for (const claim of claims) {
      if (await processClaim(service, claim)) succeeded += 1; else failed += 1;
    }
    return json({ scanned: claims.length, claimed: claims.length, succeeded, failed, skipped: 0 });
  } catch (error) { return errorResponse(error); }
});

async function processClaim(service: ReturnType<typeof createServiceClient>, claim: MailSyncClaim): Promise<boolean> {
  let stage = "load_connection";

  try {
    const { data: connection, error } = await service
      .from("source_connections")
      .select("*")
      .eq("id", claim.connection_id)
      .single();

    if (error) throw error;

    stage = "load_profile";

    const { data: profile, error: profileError } = await service
      .from("profiles")
      .select("base_currency")
      .eq("id", connection.user_id)
      .single();

    if (profileError) throw profileError;

    stage = "sync_gmail";

    const result = await syncGmailConnection(
      service,
      connection as MailConnection,
      profile.base_currency,
    );

    stage = "reload_cursor";

    const { data: refreshed, error: refreshedError } =
      await service
        .from("source_connections")
        .select("cursor")
        .eq("id", claim.connection_id)
        .single();

    if (refreshedError) throw refreshedError;

    stage = "finish_job";

    return await finishMailSyncJob(
      service,
      claim,
      "succeeded",
      {
        cursor: refreshed?.cursor ?? null,
        scanned: result.scanned,
        inserted: result.inserted,
        duplicates: result.duplicates,
      },
    );
  } catch (error) {
    const baseCode = safeWorkerErrorCode(error);
    const errorCode =
      `${stage}:${baseCode}`.slice(0, 80);

    console.error(JSON.stringify({
      event: "mail_sync_claim_failed",
      job_id: claim.id,
      stage,
      error_code: baseCode,
    }));

    await finishMailSyncJob(
      service,
      claim,
      "failed",
      {
        errorCode,
      },
    );

    return false;
  }
}
function clamp(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : min; }
