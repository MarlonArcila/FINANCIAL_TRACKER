export interface BackupDocument {
  format: "capitalflow-backup-v2";
  generatedAt: string;
  data: Record<string, unknown>;
  excluded: string[];
}

export const BACKUP_TABLES = [
  "accounts", "categories", "transactions", "goals", "goal_contributions", "investments", "investment_transactions",
  "investment_valuations", "categorization_rules", "account_assignment_rules", "budget_items", "financial_preferences",
] as const;

export function parseBackupDocument(content: string): BackupDocument {
  let parsed: Partial<BackupDocument>;
  try { parsed = JSON.parse(content) as Partial<BackupDocument>; }
  catch { throw new Error("Backup inválido: JSON ilegible."); }
  if (parsed.format !== "capitalflow-backup-v2" || !parsed.data || typeof parsed.data !== "object") throw new Error("Backup inválido o versión no soportada.");
  const required = ["profile", ...BACKUP_TABLES];
  for (const key of required) if (!(key in parsed.data)) throw new Error(`Backup incompleto: falta ${key}.`);
  return parsed as BackupDocument;
}

export async function sha256Hex(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
