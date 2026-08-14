import { errorResponse, handleOptions, HttpError, json, readJson } from "../_shared/http.ts";
import { assertEntitled, createServiceClient, requireUser } from "../_shared/supabase.ts";

type Row = {
  source_row: number;
  occurred_at: string;
  kind: "income" | "expense";
  amount_minor: number;
  currency: string;
  merchant?: string | null;
  description?: string | null;
  category_name?: string | null;
  account_name?: string | null;
};

type Body = {
  importId?: string;
  filename?: string;
  fileType?: "csv" | "tsv" | "txt" | "xlsx" | "xls" | "json";
  fileSha256?: string;
  sourceApp?: string | null;
  mapping?: Record<string, string>;
  defaultAccountId: string;
  createMissingCategories?: boolean;
  rows: Row[];
  finalChunk?: boolean;
};

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { user } = await requireUser(request);
    const service = createServiceClient();
    await assertEntitled(service, user.id);
    const body = await readJson<Body>(request, 2_500_000);
    if (!body.defaultAccountId) throw new HttpError(422, "default_account_required");
    if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 400) throw new HttpError(422, "rows_must_have_1_to_400_items");

    const { data: accounts, error: accountError } = await service.from("accounts").select("id,name,currency,is_archived").eq("user_id", user.id).eq("is_archived", false);
    if (accountError) throw accountError;
    const defaultAccount = accounts?.find((item) => item.id === body.defaultAccountId);
    if (!defaultAccount) throw new HttpError(422, "default_account_not_found");

    const importRecord = body.importId
      ? await loadImport(service, user.id, body.importId)
      : await createImport(service, user.id, body);

    const { data: categoryRows, error: categoryError } = await service.from("categories").select("id,name,kind").eq("user_id", user.id).eq("is_archived", false);
    if (categoryError) throw categoryError;
    const categories = [...(categoryRows ?? [])];
    const accountMap = new Map((accounts ?? []).map((account) => [normalize(account.name), account]));
    const categoryMap = new Map(categories.map((category) => [`${normalize(category.name)}:${category.kind}`, category]));

    const valid: Array<Record<string, unknown> & { import_key: string }> = [];
    const rejected: Array<{ sourceRow: number; reason: string }> = [];
    for (const row of body.rows) {
      try {
        const normalized = validateRow(row);
        const requestedAccount = normalized.account_name ? accountMap.get(normalize(normalized.account_name)) : null;
        const account = requestedAccount && requestedAccount.currency === normalized.currency ? requestedAccount : defaultAccount;
        if (account.currency !== normalized.currency) throw new Error(`La cuenta ${account.name} usa ${account.currency}, pero la fila usa ${normalized.currency}.`);
        const category = await resolveCategory(service, user.id, normalized, categoryMap, body.createMissingCategories ?? true);
        const key = await importKey({ ...normalized, account_id: account.id });
        valid.push({
          user_id: user.id,
          account_id: account.id,
          category_id: category?.id ?? null,
          kind: normalized.kind,
          amount_minor: normalized.amount_minor,
          currency: normalized.currency,
          merchant: normalized.merchant,
          description: normalized.description,
          occurred_at: normalized.occurred_at,
          source: "import_file",
          source_candidate_id: null,
          import_batch_id: importRecord.id,
          import_key: key,
          metadata: { imported_source_row: normalized.source_row, source_app: body.sourceApp ?? importRecord.source_app ?? null },
        });
      } catch (error) {
        rejected.push({ sourceRow: Number(row?.source_row ?? 0), reason: error instanceof Error ? error.message : "invalid_row" });
      }
    }

    const keys = valid.map((row) => row.import_key);
    const existingKeys = new Set<string>();
    if (keys.length) {
      const { data: existing, error: existingError } = await service.from("transactions").select("import_key").eq("user_id", user.id).in("import_key", keys);
      if (existingError) throw existingError;
      for (const item of existing ?? []) if (item.import_key) existingKeys.add(item.import_key);
    }
    const toInsert = valid.filter((row) => !existingKeys.has(row.import_key));
    const duplicateCount = valid.length - toInsert.length;
    let insertedCount = 0;
    if (toInsert.length) {
      const { data: inserted, error: insertError } = await service.from("transactions").insert(toInsert).select("id");
      if (insertError) {
        if (insertError.code === "23505") throw new HttpError(409, "concurrent_import_duplicate_detected");
        throw insertError;
      }
      insertedCount = inserted?.length ?? 0;
    }

    const nextStats = {
      rows_seen: importRecord.rows_seen + body.rows.length,
      rows_imported: importRecord.rows_imported + insertedCount,
      rows_duplicate: importRecord.rows_duplicate + duplicateCount,
      rows_rejected: importRecord.rows_rejected + rejected.length,
      ...(body.finalChunk ? { status: "completed", completed_at: new Date().toISOString() } : {}),
    };
    const { error: updateError } = await service.from("data_imports").update(nextStats).eq("id", importRecord.id).eq("user_id", user.id);
    if (updateError) throw updateError;
    await service.schema("private").from("audit_events").insert({
      user_id: user.id,
      actor: "user",
      action: body.finalChunk ? "data.import.completed" : "data.import.chunk",
      entity_type: "data_import",
      entity_id: importRecord.id,
      metadata: { chunk_rows: body.rows.length, imported: insertedCount, duplicates: duplicateCount, rejected: rejected.length },
    });

    return json({
      importId: importRecord.id,
      imported: insertedCount,
      duplicates: duplicateCount,
      rejected: rejected.length,
      errors: rejected.slice(0, 30),
      cumulative: nextStats,
      completed: Boolean(body.finalChunk),
    });
  } catch (error) {
    return errorResponse(error);
  }
});

async function createImport(service: ReturnType<typeof createServiceClient>, userId: string, body: Body) {
  if (!body.filename || !body.fileType) throw new HttpError(422, "filename_and_file_type_required");
  const filename = body.filename.trim().slice(0, 240);
  const fileSha256 = body.fileSha256?.toLowerCase() ?? null;
  if (fileSha256 && !/^[a-f0-9]{64}$/u.test(fileSha256)) throw new HttpError(422, "invalid_file_sha256");
  const { data, error } = await service.from("data_imports").insert({
    user_id: userId,
    filename,
    file_type: body.fileType,
    file_sha256: fileSha256,
    source_app: body.sourceApp?.trim().slice(0, 100) || null,
    mapping: body.mapping ?? {},
  }).select("*").single();
  if (error) throw error;
  return data;
}

async function loadImport(service: ReturnType<typeof createServiceClient>, userId: string, importId: string) {
  const { data, error } = await service.from("data_imports").select("*").eq("id", importId).eq("user_id", userId).single();
  if (error) throw error;
  if (data.status !== "processing") throw new HttpError(409, "import_not_processing");
  return data;
}

async function resolveCategory(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  row: Row,
  map: Map<string, { id: string; name: string; kind: string }>,
  createMissing: boolean,
) {
  if (!row.category_name) return null;
  const exact = map.get(`${normalize(row.category_name)}:${row.kind}`) ?? map.get(`${normalize(row.category_name)}:mixed`);
  if (exact) return exact;
  if (!createMissing) return null;
  const { data, error } = await service.from("categories").insert({ user_id: userId, name: row.category_name.slice(0, 80), kind: row.kind }).select("id,name,kind").single();
  if (error) {
    if (error.code === "23505") {
      const { data: retry, error: retryError } = await service.from("categories").select("id,name,kind").eq("user_id", userId).ilike("name", row.category_name).in("kind", [row.kind, "mixed"]).limit(1).maybeSingle();
      if (retryError) throw retryError;
      if (retry) return retry;
    }
    throw error;
  }
  map.set(`${normalize(data.name)}:${data.kind}`, data);
  return data;
}

function validateRow(row: Row): Row {
  if (!row || typeof row !== "object") throw new Error("Fila inválida.");
  const occurred = new Date(row.occurred_at);
  if (Number.isNaN(occurred.valueOf())) throw new Error("Fecha inválida.");
  if (row.kind !== "income" && row.kind !== "expense") throw new Error("Tipo inválido.");
  if (!Number.isSafeInteger(row.amount_minor) || row.amount_minor <= 0) throw new Error("Monto inválido.");
  const currency = String(row.currency ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency)) throw new Error("Moneda inválida.");
  return {
    source_row: Number(row.source_row) || 0,
    occurred_at: occurred.toISOString(),
    kind: row.kind,
    amount_minor: row.amount_minor,
    currency,
    merchant: clean(row.merchant),
    description: clean(row.description),
    category_name: clean(row.category_name, 80),
    account_name: clean(row.account_name, 80),
  };
}

function clean(value: string | null | undefined, max = 300): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").trim().toLowerCase().replace(/\s+/gu, " ");
}

async function importKey(row: Row & { account_id: string }): Promise<string> {
  const canonical = [row.account_id, row.kind, row.amount_minor, row.currency, row.occurred_at, normalize(row.merchant ?? ""), normalize(row.description ?? "")].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
