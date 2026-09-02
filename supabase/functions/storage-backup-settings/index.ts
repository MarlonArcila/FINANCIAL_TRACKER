import { nextBackupAt } from "../_shared/cloud-backup-service.ts";
import { errorResponse, handleOptions, HttpError, json, readJson } from "../_shared/http.ts";
import { withAdditionalCors } from "../_shared/additional-cors.ts";
import { assertAnnualEntitled, createServiceClient, requireUser } from "../_shared/supabase.ts";

Deno.serve((request) => withAdditionalCors(request, async () => {
  const preflight = handleOptions(request); if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { user } = await requireUser(request); const service = createServiceClient();
    await assertAnnualEntitled(service, user.id);
    const body = await readJson<{ connectionId?: string; frequency?: "manual" | "daily" | "weekly" }>(request, 10_000);
    if (!body.connectionId || !body.frequency || !["manual","daily","weekly"].includes(body.frequency)) throw new HttpError(422, "invalid_backup_settings");
    const { data, error } = await service.from("storage_connections").update({ backup_frequency: body.frequency, next_backup_at: nextBackupAt(body.frequency) }).eq("id", body.connectionId).eq("user_id", user.id).select("id,backup_frequency,next_backup_at").maybeSingle();
    if (error) throw error; if (!data) throw new HttpError(404, "storage_connection_not_found");
    return json(data);
  } catch (error) { return errorResponse(error); }
}));
