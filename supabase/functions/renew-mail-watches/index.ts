import { requireCronSecret } from "../_shared/cron.ts";
import { configureGmailWatch, type MailConnection } from "../_shared/gmail.ts";
import { errorResponse, handleOptions, HttpError, json } from "../_shared/http.ts";
import { configureOutlookSubscription } from "../_shared/outlook.ts";
import { createServiceClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    requireCronSecret(request);
    const service = createServiceClient();
    const threshold = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const { data: connections, error } = await service
      .from("source_connections")
      .select("*")
      .eq("status", "active")
      .or(`watch_expires_at.is.null,watch_expires_at.lt.${threshold}`)
      .limit(100);
    if (error) throw error;

    const results: Array<{ connectionId: string; provider: string; status: string; error?: string }> = [];
    for (const connection of connections ?? []) {
      try {
        if (connection.provider === "gmail") await configureGmailWatch(service, connection as MailConnection);
        else await configureOutlookSubscription(service, connection as MailConnection);
        results.push({ connectionId: connection.id, provider: connection.provider, status: "renewed" });
      } catch (renewalError) {
        const message = renewalError instanceof Error ? renewalError.message.slice(0, 1000) : "unknown";
        await service.from("source_connections").update({ status: "error", last_error: message }).eq("id", connection.id);
        results.push({ connectionId: connection.id, provider: connection.provider, status: "failed", error: message });
      }
    }
    await service.schema("private").from("oauth_states").delete().lt("expires_at", new Date().toISOString());
    return json({ checked: connections?.length ?? 0, results });
  } catch (error) {
    return errorResponse(error);
  }
});
