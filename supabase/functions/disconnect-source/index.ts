import { disconnectMailConnection } from "../_shared/disconnect.ts";
import { errorResponse, handleOptions, HttpError, json, readJson } from "../_shared/http.ts";
import { withAdditionalCors } from "../_shared/additional-cors.ts";
import { createServiceClient, requireUser } from "../_shared/supabase.ts";

Deno.serve((request) => withAdditionalCors(request, async () => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { user } = await requireUser(request);
    const body = await readJson<{ provider?: "gmail" }>(request, 10_000);
    if (body.provider !== "gmail") throw new HttpError(422, "invalid_provider");
    const service = createServiceClient();
    const { data: connection, error } = await service
      .from("source_connections")
      .select("id,user_id,provider,watch_resource_id")
      .eq("user_id", user.id)
      .eq("provider", body.provider)
      .maybeSingle();
    if (error) throw error;
    if (!connection) return json({ disconnected: false, reason: "not_connected" });
    return json({ disconnected: true, ...(await disconnectMailConnection(service, connection)) });
  } catch (error) {
    return errorResponse(error);
  }
}));
