import { nextBackupAt, performCloudBackup, type BackupConnection } from "../_shared/cloud-backup-service.ts";
import { requireCronSecret, requireWorkerEnabled } from "../_shared/cron.ts";
import { errorResponse, handleOptions, HttpError, json } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { claimCloudBackupRuns, finishCloudBackupRun, safeWorkerErrorCode, type BackupClaim } from "../_shared/worker-leases.ts";
Deno.serve(async (request) => {
  const preflight = handleOptions(request); if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    requireCronSecret(request);
    requireWorkerEnabled("CLOUD_BACKUP_WORKER_ENABLED");
    const service = createServiceClient(); const limit = clamp(Number(new URL(request.url).searchParams.get("limit") ?? "1"), 1, 5);
    const claims = await claimCloudBackupRuns(service, limit); let succeeded = 0; let failed = 0;
    for (const claim of claims) { if (await processClaim(service, claim)) succeeded += 1; else failed += 1; }
    return json({ scanned: claims.length, claimed: claims.length, succeeded, failed, skipped: 0 });
  } catch (error) { return errorResponse(error); }
});
async function processClaim(service: ReturnType<typeof createServiceClient>, claim: BackupClaim): Promise<boolean> {
  try {
    const connection: BackupConnection = { id: claim.connection_id, user_id: claim.user_id, provider: claim.provider, status: "active", backup_frequency: claim.backup_frequency };
    const result = await performCloudBackup(service, claim.user_id, connection, "scheduled", claim.run_id);
    const next = nextBackupAt(claim.backup_frequency, new Date(claim.scheduled_for));
    return await finishCloudBackupRun(service, claim, "succeeded", { remoteFileId: result.remoteFileId, remoteFileName: result.filename, nextBackupAt: next });
  } catch (error) { await finishCloudBackupRun(service, claim, "failed", { errorCode: safeWorkerErrorCode(error) }); return false; }
}
function clamp(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : min; }
