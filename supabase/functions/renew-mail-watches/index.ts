import { requireCronSecret, requireWorkerEnabled } from "../_shared/cron.ts";
import { configureGmailWatch, type MailConnection } from "../_shared/gmail.ts";
import { errorResponse, handleOptions, HttpError, json } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { claimMailWatchConnections, releaseMailWatchLease, safeWorkerErrorCode } from "../_shared/worker-leases.ts";

Deno.serve(async (request) => {
  const preflight = handleOptions(request); if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    requireCronSecret(request);
    requireWorkerEnabled("MAIL_WATCH_RENEWAL_ENABLED");
    const service = createServiceClient(); const limit = clamp(Number(new URL(request.url).searchParams.get("limit") ?? "10"), 1, 25);
    const claims = await claimMailWatchConnections(service, limit); let succeeded = 0; let failed = 0;
    for (const claim of claims) {
      try {
        const { data: connection, error } = await service.from("source_connections").select("*").eq("id", claim.connection_id).single();
        if (error) throw error;
        await configureGmailWatch(service, connection as MailConnection);
        succeeded += 1;
      } catch (error) {
        failed += 1;
        await service.from("source_connections").update({ status: "error", last_error: safeWorkerErrorCode(error) }).eq("id", claim.connection_id);
      } finally { await releaseMailWatchLease(service, claim); }
    }
    return json({ scanned: claims.length, claimed: claims.length, succeeded, failed, skipped: 0 });
  } catch (error) { return errorResponse(error); }
});
function clamp(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : min; }
