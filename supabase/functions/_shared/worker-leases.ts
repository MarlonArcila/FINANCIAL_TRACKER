import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface MailSyncClaim { id: string; connection_id: string; provider: "gmail"; lease_token: string; }
export interface WatchClaim { connection_id: string; provider: "gmail"; lease_token: string; }
export interface BackupClaim { run_id: string; connection_id: string; user_id: string; provider: "google_drive"; backup_frequency: "daily" | "weekly"; scheduled_for: string; lease_token: string; }

export async function claimMailSyncJobs(service: SupabaseClient, limit: number, connectionId?: string): Promise<MailSyncClaim[]> {
  const { data, error } = await service.rpc("claim_mail_sync_jobs", { p_limit: limit, p_connection_id: connectionId ?? null, p_lease_seconds: 300 });
  if (error) throw error;
  return (data ?? []) as MailSyncClaim[];
}

export async function finishMailSyncJob(service: SupabaseClient, claim: MailSyncClaim, status: "succeeded" | "failed", values: { cursor?: string | null; scanned?: number; inserted?: number; duplicates?: number; errorCode?: string | null } = {}): Promise<boolean> {
  const { data, error } = await service.rpc("finish_mail_sync_job", {
    p_job_id: claim.id, p_lease_token: claim.lease_token, p_status: status, p_cursor_after: values.cursor ?? null,
    p_scanned: values.scanned ?? 0, p_inserted: values.inserted ?? 0, p_duplicates: values.duplicates ?? 0, p_error_code: values.errorCode ?? null,
  });
  if (error) throw error;
  return data === true;
}

export async function claimMailWatchConnections(service: SupabaseClient, limit: number): Promise<WatchClaim[]> {
  const { data, error } = await service.rpc("claim_mail_watch_connections", { p_limit: limit, p_lease_seconds: 300 });
  if (error) throw error;
  return (data ?? []) as WatchClaim[];
}

export async function releaseMailWatchLease(service: SupabaseClient, claim: WatchClaim): Promise<void> {
  const { error } = await service.rpc("release_mail_watch_lease", { p_connection_id: claim.connection_id, p_lease_token: claim.lease_token });
  if (error) throw error;
}

export async function claimCloudBackupRuns(service: SupabaseClient, limit: number): Promise<BackupClaim[]> {
  const { data, error } = await service.rpc("claim_cloud_backup_runs", { p_limit: limit, p_lease_seconds: 600 });
  if (error) throw error;
  return (data ?? []) as BackupClaim[];
}

export async function finishCloudBackupRun(service: SupabaseClient, claim: BackupClaim, status: "succeeded" | "failed", values: { remoteFileId?: string | null; remoteFileName?: string | null; errorCode?: string | null; nextBackupAt?: string | null } = {}): Promise<boolean> {
  const { data, error } = await service.rpc("finish_cloud_backup_run", {
    p_run_id: claim.run_id, p_lease_token: claim.lease_token, p_status: status,
    p_remote_file_id: values.remoteFileId ?? null, p_remote_file_name: values.remoteFileName ?? null,
    p_error_code: values.errorCode ?? null, p_next_backup_at: values.nextBackupAt ?? null,
  });
  if (error) throw error;
  return data === true;
}

export function safeWorkerErrorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;

    const code =
      typeof record.code === "string"
        ? record.code
        : null;

    if (
      code &&
      /^[a-z0-9_:-]{1,60}$/iu.test(code)
    ) {
      return `postgrest:${code}`.slice(0, 80);
    }

    const status =
      typeof record.status === "number"
        ? record.status
        : null;

    if (
      status &&
      Number.isInteger(status)
    ) {
      return `http:${status}`;
    }
  }

  if (error instanceof Error) {
    const value = error.message.trim();

    if (/^[a-z0-9_:-]{1,80}$/iu.test(value)) {
      return value;
    }
  }

  return "worker_failed";
}
