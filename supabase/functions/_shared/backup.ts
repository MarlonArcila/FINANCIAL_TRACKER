import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { type BackupDocument } from "./backup-format.ts";

export { parseBackupDocument, sha256Hex, type BackupDocument } from "./backup-format.ts";

export async function buildBackupDocument(service: SupabaseClient, userId: string): Promise<BackupDocument> {
  const { data, error } = await service.rpc("service_build_user_backup", { p_user_id: userId });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("service_backup_payload_invalid");
  return data as BackupDocument;
}
