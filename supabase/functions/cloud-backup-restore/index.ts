import { buildBackupDocument, parseBackupDocument, sha256Hex } from "../_shared/backup.ts";
import { downloadBackupFile, uploadBackupFile } from "../_shared/cloud-storage.ts";
import { errorResponse, handleOptions, HttpError, json, readJson } from "../_shared/http.ts";
import { withAdditionalCors } from "../_shared/additional-cors.ts";
import { assertAnnualEntitled, createServiceClient, requireUser } from "../_shared/supabase.ts";
import { getStorageAccessToken, type StorageProvider } from "../_shared/storage-oauth.ts";

Deno.serve((request) => withAdditionalCors(request, async () => {
  const preflight = handleOptions(request); if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { user } = await requireUser(request); const service = createServiceClient();
    await assertAnnualEntitled(service, user.id);
    const body = await readJson<{ connectionId?: string; backupId?: string; confirmation?: string }>(request, 20_000);
    if (body.confirmation !== "RESTAURAR") throw new HttpError(422, "restore_confirmation_required");
    const { data: connection, error: connectionError } = await service.from("storage_connections").select("id,provider,status").eq("id", body.connectionId ?? "").eq("user_id", user.id).maybeSingle();
    if (connectionError) throw connectionError; if (!connection || connection.status !== "active") throw new HttpError(422, "active_storage_connection_required");
    const { data: backup, error: backupError } = await service.from("cloud_backups").select("*").eq("id", body.backupId ?? "").eq("user_id", user.id).maybeSingle();
    if (backupError) throw backupError; if (!backup) throw new HttpError(404, "backup_not_found");
    if (backup.provider !== connection.provider) throw new HttpError(422, "backup_provider_mismatch");
    const provider = connection.provider as StorageProvider;
    const accessToken = await getStorageAccessToken(service, { id: connection.id, provider });
    const content = await downloadBackupFile(provider, accessToken, backup.remote_file_id);
    const checksum = await sha256Hex(content);
    if (checksum !== backup.checksum_sha256) throw new HttpError(409, "backup_checksum_mismatch");
    const document = parseBackupDocument(content);

    // Safety copy before any destructive restore.
    const currentDocument = await buildBackupDocument(service, user.id);
    const currentContent = JSON.stringify(currentDocument);
    const safetyChecksum = await sha256Hex(currentContent);
    const safetyName = `capitalflow-pre-restore-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`;
    const safetyRemote = await uploadBackupFile(provider, accessToken, safetyName, currentContent);
    const { error: safetyRecordError } = await service.from("cloud_backups").insert({
      user_id: user.id, storage_connection_id: connection.id, provider, remote_file_id: safetyRemote.id, remote_file_name: safetyRemote.name,
      checksum_sha256: safetyChecksum, bytes: new TextEncoder().encode(currentContent).length, kind: "pre_restore",
    });
    if (safetyRecordError) throw safetyRecordError;

    const { data: restoreResult, error: restoreError } = await service.rpc("service_restore_user_backup", {
      p_user_id: user.id,
      p_payload: document,
      p_backup_id: backup.id,
      p_safety_backup_id: safetyRemote.id,
    });
    if (restoreError) throw restoreError;
    const now = new Date().toISOString();
    const { error: backupStatusError } = await service.from("cloud_backups")
      .update({ status: "restored", restored_at: now })
      .eq("id", backup.id);
    if (backupStatusError) throw backupStatusError;
    const { error: connectionUpdateError } = await service.from("storage_connections")
      .update({ last_restore_at: now, last_error: null })
      .eq("id", connection.id);
    if (connectionUpdateError) throw connectionUpdateError;
    return json({ restored: true, result: restoreResult, safetyBackupName: safetyRemote.name });
  } catch (error) { return errorResponse(error); }
}));
