import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { buildBackupDocument, sha256Hex } from "./backup.ts";
import { uploadBackupFile } from "./cloud-storage.ts";
import { getStorageAccessToken, type StorageProvider } from "./storage-oauth.ts";

export interface BackupConnection {
  id: string;
  user_id: string;
  provider: StorageProvider;
  status: string;
  backup_frequency?: "manual" | "daily" | "weekly";
}

export async function performCloudBackup(
  service: SupabaseClient,
  userId: string,
  connection: BackupConnection,
  kind: "manual" | "scheduled" | "pre_restore" = "manual",
): Promise<{ id: string; filename: string; bytes: number; checksum: string }> {
  if (connection.user_id !== userId || connection.status !== "active") throw new Error("active_storage_connection_required");
  const accessToken = await getStorageAccessToken(service, { id: connection.id, provider: connection.provider });
  const document = await buildBackupDocument(service, userId);
  const content = JSON.stringify(document);
  const checksum = await sha256Hex(content);
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const prefix = kind === "pre_restore" ? "capitalflow-pre-restore" : "capitalflow-backup";
  const filename = `${prefix}-${stamp}.json`;
  const uploaded = await uploadBackupFile(connection.provider, accessToken, filename, content);
  const bytes = new TextEncoder().encode(content).length;
  const { data: record, error } = await service.from("cloud_backups").insert({
    user_id: userId,
    storage_connection_id: connection.id,
    provider: connection.provider,
    remote_file_id: uploaded.id,
    remote_file_name: uploaded.name,
    checksum_sha256: checksum,
    bytes,
    kind,
  }).select("id").single();
  if (error) throw error;
  await service.from("storage_connections").update({ last_backup_at: new Date().toISOString(), last_error: null }).eq("id", connection.id);
  return { id: record.id, filename: uploaded.name, bytes, checksum };
}

export function nextBackupAt(frequency: "manual" | "daily" | "weekly", from = new Date()): string | null {
  if (frequency === "manual") return null;
  const days = frequency === "daily" ? 1 : 7;
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}
