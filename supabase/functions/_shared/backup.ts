import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { BACKUP_TABLES, type BackupDocument } from "./backup-format.ts";

export { parseBackupDocument, sha256Hex, type BackupDocument } from "./backup-format.ts";

export async function buildBackupDocument(service: SupabaseClient, userId: string): Promise<BackupDocument> {
  const { data: profile, error: profileError } = await service.from("profiles").select("*").eq("id", userId).single();
  if (profileError) throw profileError;
  const data: Record<string, unknown> = { profile };
  for (const table of BACKUP_TABLES) {
    const orderColumn = table === "transactions" ? "occurred_at" : table === "financial_preferences" ? "updated_at" : "created_at";
    const { data: rows, error } = await service.from(table).select("*").eq("user_id", userId).order(orderColumn, { ascending: true });
    if (error) throw error;
    data[table] = sanitizeRows(table, (rows ?? []) as Array<Record<string, unknown>>);
  }
  return {
    format: "capitalflow-backup-v2",
    generatedAt: new Date().toISOString(),
    data,
    excluded: [
      "Whop subscription entitlement", "Gmail/Outlook connections and OAuth tokens", "cloud-storage OAuth tokens", "webhook secrets",
      "raw source events and transaction candidates", "advisor AI text and audit logs",
    ],
  };
}

function sanitizeRows(table: string, rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (table === "transactions") return rows.map((row) => ({ ...row, source_candidate_id: null, import_batch_id: null }));
  if (table === "account_assignment_rules") return rows.map((row) => ({ ...row, learned_from_candidate_id: null }));
  return rows;
}
