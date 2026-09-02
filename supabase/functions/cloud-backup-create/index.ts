import { performCloudBackup, type BackupConnection } from "../_shared/cloud-backup-service.ts";
import { errorResponse, handleOptions, HttpError, json, readJson } from "../_shared/http.ts";
import { withAdditionalCors } from "../_shared/additional-cors.ts";
import { assertAnnualEntitled, createServiceClient, requireUser } from "../_shared/supabase.ts";

Deno.serve((request) => withAdditionalCors(request, async () => {
  const preflight = handleOptions(request); if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { user } = await requireUser(request); const service = createServiceClient();
    await assertAnnualEntitled(service, user.id);
    const body = await readJson<{ connectionId?: string; kind?: "manual" | "scheduled" }>(request, 10_000);
    const { data: connection, error } = await service.from("storage_connections").select("id,user_id,provider,status,backup_frequency").eq("id", body.connectionId ?? "").eq("user_id", user.id).maybeSingle();
    if (error) throw error; if (!connection || connection.status !== "active") throw new HttpError(422, "active_storage_connection_required");
    const result = await performCloudBackup(service, user.id, connection as BackupConnection, body.kind ?? "manual");
    return json({ backupId: result.id, filename: result.filename, bytes: result.bytes, checksum: result.checksum });
  } catch (error) { return errorResponse(error); }
}));
