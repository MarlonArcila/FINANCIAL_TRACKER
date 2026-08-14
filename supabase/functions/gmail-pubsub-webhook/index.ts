import { errorResponse, HttpError, json, readJson } from "../_shared/http.ts";
import { requireGooglePubSubAuth } from "../_shared/google-pubsub-auth.ts";
import { enqueueMailSync } from "../_shared/mail-jobs.ts";
import { createServiceClient } from "../_shared/supabase.ts";

interface PubSubEnvelope {
  message?: { data?: string; messageId?: string; publishTime?: string };
  subscription?: string;
}

Deno.serve(async (request) => {
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    await requireGooglePubSubAuth(request);
    const payload = await readJson<PubSubEnvelope>(request, 100_000);
    if (!payload.message?.data) return json({ ignored: true });

    let decoded: { emailAddress?: string; historyId?: string };
    try {
      decoded = JSON.parse(atob(payload.message.data)) as { emailAddress?: string; historyId?: string };
    } catch {
      throw new HttpError(400, "invalid_pubsub_data");
    }
    if (!decoded.emailAddress) throw new HttpError(400, "missing_email_address");

    const service = createServiceClient();
    const { data: connection, error } = await service
      .from("source_connections")
      .select("id,cursor")
      .eq("provider", "gmail")
      .eq("email_address", decoded.emailAddress)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw error;
    if (!connection) return json({ ignored: true, reason: "connection_not_found" });

    const queued = await enqueueMailSync(service, connection.id, "gmail", connection.cursor);
    return json({ received: true, historyId: decoded.historyId ?? null, ...queued }, 202);
  } catch (error) {
    return errorResponse(error);
  }
});
