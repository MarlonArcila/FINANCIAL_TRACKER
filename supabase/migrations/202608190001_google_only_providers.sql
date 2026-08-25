begin;

do $$
begin
  if exists (
    select 1
    from public.source_connections
    where provider = 'outlook'
  )
  or exists (
    select 1
    from private.oauth_states
    where provider = 'outlook'
  )
  or exists (
    select 1
    from public.source_events
    where provider = 'outlook'
  )
  or exists (
    select 1
    from public.transaction_candidates
    where provider = 'outlook'
  )
  or exists (
    select 1
    from public.transactions
    where source = 'outlook'
  )
  or exists (
    select 1
    from private.sync_jobs
    where provider = 'outlook'
  )
  or exists (
    select 1
    from public.storage_connections
    where provider = 'onedrive'
  )
  or exists (
    select 1
    from private.storage_oauth_states
    where provider = 'onedrive'
  )
  or exists (
    select 1
    from public.cloud_backups
    where provider = 'onedrive'
  )
  then
    raise exception 'MICROSOFT_PROVIDER_DATA_PRESENT';
  end if;
end;
$$;

-- Remove every legacy check constraint that explicitly contains Outlook
-- or OneDrive, regardless of its historical name.
do $$
declare
  item record;
begin
  for item in
    select
      c.conrelid::regclass as relation_name,
      c.conname
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid = any (
        array[
          'public.source_connections'::regclass,
          'private.oauth_states'::regclass,
          'public.source_events'::regclass,
          'public.transaction_candidates'::regclass,
          'public.transactions'::regclass,
          'private.sync_jobs'::regclass,
          'public.storage_connections'::regclass,
          'private.storage_oauth_states'::regclass,
          'public.cloud_backups'::regclass
        ]
      )
      and (
        lower(pg_get_constraintdef(c.oid)) like '%outlook%'
        or lower(pg_get_constraintdef(c.oid)) like '%onedrive%'
      )
  loop
    execute format(
      'alter table %s drop constraint %I',
      item.relation_name,
      item.conname
    );
  end loop;
end;
$$;

alter table public.source_connections
  drop constraint if exists source_connections_provider_check;

alter table public.source_connections
  add constraint source_connections_provider_check
  check (provider = 'gmail');

alter table private.oauth_states
  drop constraint if exists oauth_states_provider_check;

alter table private.oauth_states
  add constraint oauth_states_provider_check
  check (provider = 'gmail');

alter table public.source_events
  drop constraint if exists source_events_provider_check;

alter table public.source_events
  add constraint source_events_provider_check
  check (provider in ('android_notification', 'gmail'));

alter table public.transaction_candidates
  drop constraint if exists transaction_candidates_provider_check;

alter table public.transaction_candidates
  add constraint transaction_candidates_provider_check
  check (provider in ('android_notification', 'gmail'));

alter table public.transactions
  drop constraint if exists transactions_source_check;

alter table public.transactions
  add constraint transactions_source_check
  check (
    source in (
      'manual',
      'android_notification',
      'gmail',
      'system',
      'import_file'
    )
  );

alter table private.sync_jobs
  drop constraint if exists sync_jobs_provider_check;

alter table private.sync_jobs
  add constraint sync_jobs_provider_check
  check (provider = 'gmail');

alter table public.storage_connections
  drop constraint if exists storage_connections_provider_check;

alter table public.storage_connections
  add constraint storage_connections_provider_check
  check (provider = 'google_drive');

alter table private.storage_oauth_states
  drop constraint if exists storage_oauth_states_provider_check;

alter table private.storage_oauth_states
  add constraint storage_oauth_states_provider_check
  check (provider = 'google_drive');

alter table public.cloud_backups
  drop constraint if exists cloud_backups_provider_check;

alter table public.cloud_backups
  add constraint cloud_backups_provider_check
  check (provider = 'google_drive');

commit;
