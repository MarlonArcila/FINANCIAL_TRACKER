import { errorResponse, handleOptions, HttpError, json, readJson } from "../_shared/http.ts";
import { assertAnnualEntitled, createServiceClient, requireUser } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const preflight = handleOptions(request); if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { user } = await requireUser(request); const service = createServiceClient();
    await assertAnnualEntitled(service, user.id);
    const body = await readJson<{ connectionId?: string }>(request, 10_000);
    if (!body.connectionId) throw new HttpError(422, "connection_id_required");
    const { data: connection, error } = await service.from("storage_connections").select("id,provider").eq("id", body.connectionId).eq("user_id", user.id).maybeSingle();
    if (error) throw error; if (!connection) throw new HttpError(404, "storage_connection_not_found");
    await service.schema("private").from("storage_oauth_credentials").delete().eq("connection_id", connection.id);
    await service.from("storage_connections").update({ status: "revoked", last_error: null }).eq("id", connection.id);
    return json({ disconnected: true });
  } catch (error) { return errorResponse(error); }
});
