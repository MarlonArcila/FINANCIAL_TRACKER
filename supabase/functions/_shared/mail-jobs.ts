import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function enqueueMailSync(
  service: SupabaseClient,
  connectionId: string,
  provider: "gmail",
  cursorBefore: string | null,
): Promise<{ queued: boolean; jobId: string | null }> {
  const { data: existing, error: existingError } = await service
    .schema("private")
    .from("sync_jobs")
    .select("id")
    .eq("connection_id", connectionId)
    .in("status", ["queued", "running"])
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return { queued: false, jobId: existing.id as string };

  const { data, error } = await service
    .schema("private")
    .from("sync_jobs")
    .insert({ connection_id: connectionId, provider, cursor_before: cursorBefore })
    .select("id")
    .single();
  if (error?.code === "23505") {
    const { data: concurrent, error: concurrentError } = await service
      .schema("private")
      .from("sync_jobs")
      .select("id")
      .eq("connection_id", connectionId)
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle();
    if (concurrentError) throw concurrentError;
    return { queued: false, jobId: (concurrent?.id as string | null) ?? null };
  }
  if (error) throw error;
  return { queued: true, jobId: data.id as string };
}
