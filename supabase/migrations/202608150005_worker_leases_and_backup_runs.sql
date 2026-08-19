begin;

alter table private.sync_jobs
  add column if not exists lease_token uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists lease_expires_at timestamptz;

create index if not exists sync_jobs_lease_idx on private.sync_jobs(status, lease_expires_at);

create table if not exists private.mail_watch_renewal_leases (
  connection_id uuid primary key references public.source_connections(id) on delete cascade,
  lease_token uuid not null,
  claimed_at timestamptz not null default now(),
  lease_expires_at timestamptz not null
);

create table if not exists private.backup_runs (
  id uuid primary key default gen_random_uuid(),
  storage_connection_id uuid not null references public.storage_connections(id) on delete cascade,
  scheduled_for timestamptz not null,
  status text not null check (status in ('claimed','failed','succeeded')),
  lease_token uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  remote_file_id text,
  remote_file_name text,
  error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storage_connection_id, scheduled_for)
);
create index if not exists backup_runs_claim_idx on private.backup_runs(status, lease_expires_at);

alter table public.cloud_backups add column if not exists backup_run_id uuid unique references private.backup_runs(id) on delete set null;
create unique index if not exists cloud_backups_backup_run_uidx on public.cloud_backups(backup_run_id) where backup_run_id is not null;

create or replace function public.claim_mail_sync_jobs(p_limit integer default 2, p_connection_id uuid default null, p_lease_seconds integer default 300)
returns table(id uuid, connection_id uuid, provider text, lease_token uuid)
language sql security definer set search_path = pg_catalog, public, private
as $$
  with candidates as (
    select j.id from private.sync_jobs j
    where (p_connection_id is null or j.connection_id = p_connection_id)
      and (j.status = 'queued' or (j.status = 'running' and j.lease_expires_at is not null and j.lease_expires_at < now()) or (j.status = 'running' and j.lease_expires_at is null and j.started_at is not null and j.started_at < now() - interval '10 minutes'))
    order by j.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 2), 1), 25)
  ), claimed as (
    update private.sync_jobs j set status = 'running', lease_token = gen_random_uuid(), claimed_at = now(), started_at = now(),
      lease_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds,300),120),300)), error = null
    from candidates c where j.id = c.id
    returning j.id, j.connection_id, j.provider, j.lease_token
  ) select * from claimed;
$$;

create or replace function public.finish_mail_sync_job(p_job_id uuid, p_lease_token uuid, p_status text, p_cursor_after text default null, p_scanned integer default 0, p_inserted integer default 0, p_duplicates integer default 0, p_error_code text default null)
returns boolean language sql security definer set search_path = pg_catalog, public, private
as $$
  with updated as (
    update private.sync_jobs set status = p_status, cursor_after = p_cursor_after, scanned_count = p_scanned,
      inserted_count = p_inserted, duplicate_count = p_duplicates, error = p_error_code, finished_at = now(),
      lease_token = null, lease_expires_at = null
    where id = p_job_id and status = 'running' and lease_token = p_lease_token and p_status in ('succeeded','failed')
    returning 1
  ) select exists(select 1 from updated);
$$;

create or replace function public.claim_mail_watch_connections(p_limit integer default 10, p_lease_seconds integer default 300)
returns table(connection_id uuid, provider text, lease_token uuid)
language sql security definer set search_path = pg_catalog, public, private
as $$
  with eligible as (
    select c.id, c.provider from public.source_connections c
    where c.status = 'active' and (c.watch_expires_at is null or c.watch_expires_at < now() + interval '24 hours')
    order by c.watch_expires_at nulls first, c.updated_at
    for update skip locked limit least(greatest(coalesce(p_limit,10),1),25)
  ), claimed as (
    insert into private.mail_watch_renewal_leases(connection_id, lease_token, claimed_at, lease_expires_at)
    select id, gen_random_uuid(), now(), now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds,300),120),300)) from eligible
    on conflict (connection_id) do update set lease_token = gen_random_uuid(), claimed_at = now(),
      lease_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds,300),120),300))
    where private.mail_watch_renewal_leases.lease_expires_at < now()
    returning connection_id, lease_token
  ) select claimed.connection_id, e.provider, claimed.lease_token from claimed join eligible e on e.id = claimed.connection_id;
$$;

create or replace function public.release_mail_watch_lease(p_connection_id uuid, p_lease_token uuid)
returns boolean language sql security definer set search_path = pg_catalog, public, private
as $$ with deleted as (delete from private.mail_watch_renewal_leases where connection_id = p_connection_id and lease_token = p_lease_token returning 1) select exists(select 1 from deleted); $$;

create or replace function public.claim_cloud_backup_runs(p_limit integer default 1, p_lease_seconds integer default 600)
returns table(run_id uuid, connection_id uuid, user_id uuid, provider text, backup_frequency text, scheduled_for timestamptz, lease_token uuid)
language sql security definer set search_path = pg_catalog, public, private
as $$
  with eligible as (
    select c.id, c.user_id, c.provider, c.backup_frequency, c.next_backup_at
    from public.storage_connections c
    where c.status = 'active' and c.backup_frequency <> 'manual' and c.next_backup_at <= now()
      and exists (select 1 from public.subscriptions s where s.user_id = c.user_id and s.interval = 'annual'
        and s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end > now()))
    order by c.next_backup_at for update skip locked limit least(greatest(coalesce(p_limit,1),1),5)
  ), claimed as (
    insert into private.backup_runs(storage_connection_id, scheduled_for, status, lease_token, claimed_at, lease_expires_at)
    select id, next_backup_at, 'claimed', gen_random_uuid(), now(), now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds,600),300),900)) from eligible
    on conflict (storage_connection_id, scheduled_for) do update set status = 'claimed', lease_token = gen_random_uuid(), claimed_at = now(),
      lease_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds,600),300),900)), error_code = null
    where private.backup_runs.status = 'failed' or (private.backup_runs.status = 'claimed' and private.backup_runs.lease_expires_at < now())
    returning id, storage_connection_id, scheduled_for, lease_token
  ) select claimed.id, e.id, e.user_id, e.provider, e.backup_frequency, claimed.scheduled_for, claimed.lease_token from claimed join eligible e on e.id = claimed.storage_connection_id;
$$;

create or replace function public.finish_cloud_backup_run(p_run_id uuid, p_lease_token uuid, p_status text, p_remote_file_id text default null, p_remote_file_name text default null, p_error_code text default null, p_next_backup_at timestamptz default null)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare v_connection_id uuid;
begin
  update private.backup_runs set status = p_status, remote_file_id = coalesce(p_remote_file_id, remote_file_id), remote_file_name = coalesce(p_remote_file_name, remote_file_name),
    error_code = p_error_code, completed_at = case when p_status = 'succeeded' then now() else null end,
    lease_token = null, lease_expires_at = null, updated_at = now()
  where id = p_run_id and status = 'claimed' and lease_token = p_lease_token and p_status in ('succeeded','failed')
  returning storage_connection_id into v_connection_id;
  if not found then return false; end if;
  if p_status = 'succeeded' then
    update public.storage_connections set next_backup_at = p_next_backup_at, last_backup_at = now(), last_error = null
    where id = v_connection_id;
  end if;
  return true;
end;
$$;

revoke all on function public.claim_mail_sync_jobs(integer,uuid,integer), public.finish_mail_sync_job(uuid,uuid,text,text,integer,integer,integer,text), public.claim_mail_watch_connections(integer,integer), public.release_mail_watch_lease(uuid,uuid), public.claim_cloud_backup_runs(integer,integer), public.finish_cloud_backup_run(uuid,uuid,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.claim_mail_sync_jobs(integer,uuid,integer), public.finish_mail_sync_job(uuid,uuid,text,text,integer,integer,integer,text), public.claim_mail_watch_connections(integer,integer), public.release_mail_watch_lease(uuid,uuid), public.claim_cloud_backup_runs(integer,integer), public.finish_cloud_backup_run(uuid,uuid,text,text,text,text,timestamptz) to service_role;

commit;
