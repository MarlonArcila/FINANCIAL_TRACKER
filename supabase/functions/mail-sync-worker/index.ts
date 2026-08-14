import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { requireCronSecret } from "../_shared/cron.ts";
import { syncGmailConnection, type MailConnection } from "../_shared/gmail.ts";
import { errorResponse, handleOptions, HttpError, json } from "../_shared/http.ts";
import { syncOutlookConnection } from "../_shared/outlook.ts";
import { createServiceClient } from "../_shared/supabase.ts";

interface SyncJob {
  id: string;
  connection_id: string;
  provider: "gmail" | "outlook";
}

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    requireCronSecret(request);
    const service = createServiceClient();
    const url = new URL(request.url);
    const maxJobs = clamp(Number(url.searchParams.get("limit") ?? "10"), 1, 25);
    const results: Array<Record<string, unknown>> = [];

    for (let index = 0; index < maxJobs; index += 1) {
      const job = await claimJob(service);
      if (!job) break;
      results.push(await processJob(service, job));
    }
    return json({ processed: results.length, results });
  } catch (error) {
    return errorResponse(error);
  }
});

async function claimJob(service: SupabaseClient): Promise<SyncJob | null> {
  const { data: candidate, error } = await service
    .schema("private")
    .from("sync_jobs")
    .select("id,connection_id,provider")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!candidate) return null;

  const { data: claimed, error: claimError } = await service
    .schema("private")
    .from("sync_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", candidate.id)
    .eq("status", "queued")
    .select("id,connection_id,provider")
    .maybeSingle();
  if (claimError) throw claimError;
  return claimed as SyncJob | null;
}

async function processJob(service: SupabaseClient, job: SyncJob): Promise<Record<string, unknown>> {
  try {
    const { data: connection, error } = await service
      .from("source_connections")
      .select("*")
      .eq("id", job.connection_id)
      .single();
    if (error) throw error;
    const { data: profile, error: profileError } = await service
      .from("profiles")
      .select("base_currency")
      .eq("id", connection.user_id)
      .single();
    if (profileError) throw profileError;

    const result = job.provider === "gmail"
      ? await syncGmailConnection(service, connection as MailConnection, profile.base_currency)
      : await syncOutlookConnection(service, connection as MailConnection, profile.base_currency);
    const { data: refreshed } = await service.from("source_connections").select("cursor").eq("id", job.connection_id).single();
    await service.schema("private").from("sync_jobs").update({
      status: "succeeded",
      cursor_after: refreshed?.cursor ?? null,
      scanned_count: result.scanned,
      inserted_count: result.inserted,
      duplicate_count: result.duplicates,
      finished_at: new Date().toISOString(),
    }).eq("id", job.id);
    return { jobId: job.id, status: "succeeded", ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "unknown";
    await service.schema("private").from("sync_jobs").update({
      status: "failed",
      error: message,
      finished_at: new Date().toISOString(),
    }).eq("id", job.id);
    await service.from("source_connections").update({ status: "error", last_error: message }).eq("id", job.connection_id);
    return { jobId: job.id, status: "failed", error: message };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
