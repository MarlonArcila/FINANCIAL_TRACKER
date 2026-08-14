import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { getGoogleAccessToken } from "./gmail.ts";
import { getMicrosoftAccessToken } from "./outlook.ts";

export interface DisconnectableConnection {
  id: string;
  user_id: string;
  provider: "gmail" | "outlook";
  watch_resource_id: string | null;
}

/** Best-effort remote cleanup followed by authoritative local deletion. */
export async function disconnectMailConnection(
  service: SupabaseClient,
  connection: DisconnectableConnection,
  actor: "user" | "system" = "user",
): Promise<{ remoteRevoked: boolean; warning: string | null }> {
  let remoteRevoked = false;
  let warning: string | null = null;
  try {
    if (connection.provider === "gmail") {
      const accessToken = await getGoogleAccessToken(service, connection.id);
      const response = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: accessToken }),
      });
      if (!response.ok) throw new Error(`Google revoke failed with ${response.status}`);
      remoteRevoked = true;
    } else if (connection.watch_resource_id) {
      const accessToken = await getMicrosoftAccessToken(service, connection.id);
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(connection.watch_resource_id)}`,
        { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok && response.status !== 404) {
        throw new Error(`Microsoft subscription delete failed with ${response.status}`);
      }
      remoteRevoked = true;
    }
  } catch (error) {
    warning = error instanceof Error ? error.message.slice(0, 500) : "remote_cleanup_failed";
  }

  const { error: deleteError } = await service.from("source_connections").delete().eq("id", connection.id);
  if (deleteError) throw deleteError;
  await service.schema("private").from("audit_events").insert({
    user_id: connection.user_id,
    actor,
    action: "source.disconnected",
    entity_type: "source_connection",
    entity_id: connection.id,
    metadata: { provider: connection.provider, remote_revoked: remoteRevoked, warning },
  });
  return { remoteRevoked, warning };
}
