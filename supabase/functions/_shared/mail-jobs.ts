import type {
  SupabaseClient,
} from "npm:@supabase/supabase-js@2";

export async function enqueueMailSync(
  service: SupabaseClient,
  connectionId: string,
  provider: "gmail",
  cursorBefore: string | null,
): Promise<{
  queued: boolean;
  jobId: string | null;
}> {
  const { data, error } =
    await service
      .rpc(
        "service_enqueue_mail_sync",
        {
          p_connection_id:
            connectionId,
          p_provider: provider,
          p_cursor_before:
            cursorBefore,
        },
      )
      .single();

  if (error) throw error;

  return {
    queued:
      data?.queued === true,
    jobId:
      typeof data?.job_id ===
      "string"
        ? data.job_id
        : null,
  };
}
