import { syncGmailConnection, type MailConnection } from "../_shared/gmail.ts";
import { errorResponse, handleOptions, HttpError, json } from "../_shared/http.ts";
import { assertEntitled, createServiceClient, requireUser } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const preflight = handleOptions(request); if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { user } = await requireUser(request);
    const service = createServiceClient();
    await assertEntitled(service, user.id);
    const { data: connection, error } = await service.from("source_connections").select("*").eq("user_id", user.id).eq("provider", "gmail").maybeSingle();
    if (error) throw error;
    if (!connection) throw new HttpError(404, "gmail_not_connected");
    const { data: profile, error: profileError } = await service.from("profiles").select("base_currency").eq("id", user.id).single();
    if (profileError) throw profileError;
    try {
      return json(await syncGmailConnection(service, connection as MailConnection, profile.base_currency));
    } catch (syncError) {
      await service.from("source_connections").update({ status: "error", last_error: syncError instanceof Error ? syncError.message.slice(0, 1000) : "unknown" }).eq("id", connection.id);
      throw syncError;
    }
  } catch (error) { return errorResponse(error); }
});
