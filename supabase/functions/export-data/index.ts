import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { errorResponse, handleOptions, HttpError, json } from "../_shared/http.ts";
import { createServiceClient, requireUser } from "../_shared/supabase.ts";

const TABLES = [
  "profiles", "subscriptions", "accounts", "categories", "source_connections", "source_events",
  "transaction_candidates", "transactions", "transaction_revisions", "categorization_rules", "goals",
  "goal_contributions", "investments", "investment_transactions", "investment_valuations", "budget_items",
  "financial_preferences", "advisor_runs", "account_assignment_rules", "data_imports", "storage_connections", "cloud_backups",
] as const;

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { user, client } = await requireUser(request);
    const service = createServiceClient();
    const exported: Record<string, unknown[]> = {};
    for (const table of TABLES) exported[table] = await fetchAllForUser(client, table, user.id);

    const document = {
      exportFormat: "capitalflow-json-v1",
      generatedAt: new Date().toISOString(),
      user: { id: user.id, email: user.email ?? null },
      data: exported,
      excludedSecrets: ["oauth access tokens", "oauth refresh tokens", "webhook secrets", "service credentials"],
    };
    const content = JSON.stringify(document, null, 2);
    await service.schema("private").from("audit_events").insert({
      user_id: user.id,
      actor: "user",
      action: "data.exported",
      entity_type: "account",
      entity_id: user.id,
      metadata: { bytes: new TextEncoder().encode(content).length },
    });
    return json({
      filename: `capitalflow-export-${new Date().toISOString().slice(0, 10)}.json`,
      mimeType: "application/json",
      content,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

async function fetchAllForUser(service: SupabaseClient, table: string, userId: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  const pageSize = 1_000;
  const filterColumn = table === "profiles" ? "id" : "user_id";
  for (let from = 0; from < 100_000; from += pageSize) {
    const { data, error } = await service.from(table).select("*").eq(filterColumn, userId).range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}
