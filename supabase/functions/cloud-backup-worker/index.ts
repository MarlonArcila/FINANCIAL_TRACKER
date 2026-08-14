import { nextBackupAt, performCloudBackup, type BackupConnection } from "../_shared/cloud-backup-service.ts";
import { requiredEnv } from "../_shared/env.ts";
import { errorResponse, handleOptions, HttpError, json } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const preflight = handleOptions(request); if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    if (request.headers.get("x-cron-secret") !== requiredEnv("CRON_SECRET")) throw new HttpError(401, "invalid_cron_secret");
    const service = createServiceClient();
    const now = new Date();
    const { data: connections, error } = await service.from("storage_connections")
      .select("id,user_id,provider,status,backup_frequency,next_backup_at")
      .eq("status", "active").neq("backup_frequency", "manual").lte("next_backup_at", now.toISOString()).limit(25);
    if (error) throw error;
    let created = 0; let skipped = 0; const failures: Array<{ id: string; error: string }> = [];
    for (const connection of connections ?? []) {
      const { data: sub, error: subError } = await service.from("subscriptions").select("id,current_period_end").eq("user_id", connection.user_id).eq("interval", "annual").in("status", ["active","trialing"]).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (subError) { failures.push({ id: connection.id, error: subError.message }); continue; }
      const entitled = Boolean(sub && (!sub.current_period_end || Date.parse(sub.current_period_end) > Date.now()));
      if (!entitled) {
        skipped += 1;
        await service.from("storage_connections").update({ next_backup_at: new Date(Date.now() + 86_400_000).toISOString() }).eq("id", connection.id);
        continue;
      }
      try {
        await performCloudBackup(service, connection.user_id, connection as BackupConnection, "scheduled");
        created += 1;
        await service.from("storage_connections").update({ next_backup_at: nextBackupAt(connection.backup_frequency) }).eq("id", connection.id);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "backup_failed";
        failures.push({ id: connection.id, error: message });
        await service.from("storage_connections").update({ last_error: message.slice(0, 500), next_backup_at: new Date(Date.now() + 6 * 3_600_000).toISOString() }).eq("id", connection.id);
      }
    }
    return json({ scanned: connections?.length ?? 0, created, skipped, failures });
  } catch (error) { return errorResponse(error); }
});
