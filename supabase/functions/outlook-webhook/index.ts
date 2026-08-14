import { requiredEnv } from "../_shared/env.ts";
import { errorResponse, HttpError, json, readJson, text } from "../_shared/http.ts";
import { enqueueMailSync } from "../_shared/mail-jobs.ts";
import { createServiceClient } from "../_shared/supabase.ts";

interface GraphNotification {
  subscriptionId?: string;
  clientState?: string;
  changeType?: string;
  resource?: string;
  tenantId?: string;
}

Deno.serve(async (request) => {
  try {
    const url = new URL(request.url);
    const validationToken = url.searchParams.get("validationToken");
    if (validationToken !== null) {
      if (validationToken.length > 2048) throw new HttpError(400, "validation_token_too_long");
      return text(validationToken, 200, { "content-type": "text/plain; charset=utf-8" });
    }
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");

    const payload = await readJson<{ value?: GraphNotification[] }>(request, 200_000);
    const notifications = payload.value ?? [];
    if (notifications.length === 0) return json({ received: true, queued: 0 }, 202);
    const expectedClientState = requiredEnv("OUTLOOK_CLIENT_STATE");
    if (notifications.some((item) => item.clientState !== expectedClientState)) {
      throw new HttpError(401, "invalid_client_state");
    }

    const subscriptionIds = [...new Set(
      notifications.map((item) => item.subscriptionId).filter((value): value is string => Boolean(value)),
    )].slice(0, 100);
    if (subscriptionIds.length === 0) return json({ received: true, queued: 0 }, 202);

    const service = createServiceClient();
    const { data: connections, error } = await service
      .from("source_connections")
      .select("id,cursor,watch_resource_id")
      .eq("provider", "outlook")
      .eq("status", "active")
      .in("watch_resource_id", subscriptionIds);
    if (error) throw error;

    let queuedCount = 0;
    for (const connection of connections ?? []) {
      const result = await enqueueMailSync(service, connection.id, "outlook", connection.cursor);
      if (result.queued) queuedCount += 1;
    }
    return json({ received: true, matched: connections?.length ?? 0, queued: queuedCount }, 202);
  } catch (error) {
    return errorResponse(error);
  }
});
