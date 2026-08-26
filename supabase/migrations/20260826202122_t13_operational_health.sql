begin;

create or replace function public.service_operational_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stale_running_sync_jobs bigint;
  v_queued_sync_jobs_over_15m bigint;
  v_failed_sync_jobs_24h bigint;
  v_stale_watch_leases bigint;
  v_stale_backup_runs bigint;
  v_failed_backup_runs_24h bigint;
  v_source_connections_error bigint;
  v_expiring_gmail_watches_6h bigint;
  v_critical bigint;
  v_warnings bigint;
begin
  select count(*) into v_stale_running_sync_jobs
  from private.sync_jobs j
  where j.status = 'running'
    and coalesce(j.lease_expires_at, j.started_at + interval '10 minutes', j.created_at + interval '10 minutes') < now();

  select count(*) into v_queued_sync_jobs_over_15m
  from private.sync_jobs j
  where j.status = 'queued' and j.created_at < now() - interval '15 minutes';

  select count(*) into v_failed_sync_jobs_24h
  from private.sync_jobs j
  where j.status = 'failed' and coalesce(j.finished_at, j.created_at) >= now() - interval '24 hours';

  select count(*) into v_stale_watch_leases
  from private.mail_watch_renewal_leases l
  where l.lease_expires_at < now();

  select count(*) into v_stale_backup_runs
  from private.backup_runs b
  where b.status = 'claimed' and b.lease_expires_at is not null and b.lease_expires_at < now();

  select count(*) into v_failed_backup_runs_24h
  from private.backup_runs b
  where b.status = 'failed' and b.updated_at >= now() - interval '24 hours';

  select count(*) into v_source_connections_error
  from public.source_connections c
  where c.status = 'error';

  select count(*) into v_expiring_gmail_watches_6h
  from public.source_connections c
  where c.provider = 'gmail'
    and c.status = 'active'
    and (c.watch_expires_at is null or c.watch_expires_at < now() + interval '6 hours');

  v_critical := v_stale_running_sync_jobs + v_queued_sync_jobs_over_15m + v_stale_watch_leases + v_stale_backup_runs;
  v_warnings := v_failed_sync_jobs_24h + v_failed_backup_runs_24h + v_source_connections_error + v_expiring_gmail_watches_6h;

  return jsonb_build_object(
    'status', case when v_critical > 0 then 'degraded' when v_warnings > 0 then 'warning' else 'healthy' end,
    'checkedAt', now(),
    'criticalIssues', v_critical,
    'warningIssues', v_warnings,
    'staleRunningSyncJobs', v_stale_running_sync_jobs,
    'queuedSyncJobsOver15m', v_queued_sync_jobs_over_15m,
    'failedSyncJobs24h', v_failed_sync_jobs_24h,
    'staleWatchLeases', v_stale_watch_leases,
    'staleBackupRuns', v_stale_backup_runs,
    'failedBackupRuns24h', v_failed_backup_runs_24h,
    'sourceConnectionsError', v_source_connections_error,
    'expiringGmailWatches6h', v_expiring_gmail_watches_6h
  );
end;
$$;

alter function public.service_operational_health() owner to postgres;
revoke all on function public.service_operational_health() from public, anon, authenticated;
grant execute on function public.service_operational_health() to service_role;

notify pgrst, 'reload schema';
commit;
