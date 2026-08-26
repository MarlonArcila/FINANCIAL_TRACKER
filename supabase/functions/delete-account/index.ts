import { recordAuditEvent } from "../_shared/audit.ts";
import { disconnectMailConnection, type DisconnectableConnection } from "../_shared/disconnect.ts";
import { errorResponse, handleOptions, HttpError, json, readJson } from "../_shared/http.ts";
import { createServiceClient, requireUser } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    if (request.method !== "POST" && request.method !== "DELETE") throw new HttpError(405, "method_not_allowed");
    const { user } = await requireUser(request);
    const body = await readJson<{ confirmation?: string }>(request, 10_000);
    if (body.confirmation !== "ELIMINAR") throw new HttpError(422, "confirmation_required");
    const service = createServiceClient();
    const { data: connections, error } = await service
      .from("source_connections")
      .select("id,user_id,provider,watch_resource_id")
      .eq("user_id", user.id);
    if (error) throw error;

    const cleanupWarnings: string[] = [];
    for (const connection of (connections ?? []) as DisconnectableConnection[]) {
      const result = await disconnectMailConnection(service, connection, "system");
      if (result.warning) cleanupWarnings.push(`${connection.provider}: ${result.warning}`);
    }
    await recordAuditEvent(service, {
      userId: user.id,
      actor: "user",
      action: "account.deleted",
      entityType: "auth_user",
      entityId: user.id,
      metadata: { cleanup_warnings: cleanupWarnings },
    });
    const { error: deleteError } = await service.auth.admin.deleteUser(user.id);
    if (deleteError) throw deleteError;
    return json({ deleted: true, cleanupWarnings });
  } catch (error) {
    return errorResponse(error);
  }
});
