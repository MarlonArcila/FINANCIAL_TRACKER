import { requireCronSecret } from "../_shared/cron.ts";
import { errorResponse, handleOptions, HttpError, json } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

type PurgeResult = {
  purge_enabled: boolean;
  rejected_candidate_days: number;
  dedupe_event_days: number;
  audit_event_days: number | null;
  rejected_candidates_deleted: number;
  dedupe_candidates_deleted: number;
  source_events_deleted: number;
  webhook_events_deleted: number;
  rate_limit_windows_deleted: number;
};

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;

  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    requireCronSecret(request);

    const service = createServiceClient();
    const { data, error } = await service.rpc("service_purge_expired_data");
    if (error) throw error;

    const row = (Array.isArray(data) ? data[0] : data) as PurgeResult | null;
    if (!row || typeof row.purge_enabled !== "boolean") {
      throw new HttpError(503, "retention_purge_unavailable");
    }

    return json({
      enabled: row.purge_enabled,
      policy: {
        rejectedCandidateDays: row.rejected_candidate_days,
        dedupeEventDays: row.dedupe_event_days,
        auditEventDays: row.audit_event_days,
      },
      deleted: {
        rejectedCandidates: row.rejected_candidates_deleted,
        dedupeCandidates: row.dedupe_candidates_deleted,
        sourceEvents: row.source_events_deleted,
        webhookEvents: row.webhook_events_deleted,
        rateLimitWindows: row.rate_limit_windows_deleted,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
});
