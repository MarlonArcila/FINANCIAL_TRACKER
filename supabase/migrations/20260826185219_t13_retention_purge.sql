begin;

-- Retention policy is backend-only. The defaults implement the architecture's
-- provisional 30/90-day policy while keeping audit retention explicitly unset
-- until legal/product policy is approved.
create table private.retention_policy (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  rejected_candidate_days integer not null default 30
    check (rejected_candidate_days between 1 and 3650),
  dedupe_event_days integer not null default 90
    check (dedupe_event_days between 1 and 3650),
  audit_event_days integer
    check (audit_event_days is null or audit_event_days between 1 and 36500),
  updated_at timestamptz not null default now()
);

insert into private.retention_policy (
  singleton,
  enabled,
  rejected_candidate_days,
  dedupe_event_days,
  audit_event_days
) values (true, true, 30, 90, null);

alter table private.retention_policy enable row level security;
revoke all on table private.retention_policy from public, anon, authenticated, service_role;

create index transaction_candidates_retention_idx
  on public.transaction_candidates (
    status,
    (coalesce(reviewed_at, updated_at, created_at))
  )
  where status in ('rejected', 'duplicate', 'expired');

create index source_events_retention_idx
  on public.source_events (processing_status, created_at)
  where processing_status in ('parsed', 'ignored', 'error');

create index webhook_events_retention_idx
  on private.webhook_events (status, received_at)
  where status in ('processed', 'ignored', 'failed');

create or replace function public.service_purge_expired_data()
returns table (
  purge_enabled boolean,
  rejected_candidate_days integer,
  dedupe_event_days integer,
  audit_event_days integer,
  rejected_candidates_deleted bigint,
  dedupe_candidates_deleted bigint,
  source_events_deleted bigint,
  webhook_events_deleted bigint,
  rate_limit_windows_deleted bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_policy private.retention_policy%rowtype;
  v_rejected bigint := 0;
  v_dedupe bigint := 0;
  v_source bigint := 0;
  v_webhook bigint := 0;
  v_rate bigint := 0;
begin
  select rp.* into v_policy
  from private.retention_policy rp
  where rp.singleton = true;

  if not found then
    raise exception 'retention_policy_missing' using errcode = '55000';
  end if;

  if not v_policy.enabled then
    return query select
      false,
      v_policy.rejected_candidate_days,
      v_policy.dedupe_event_days,
      v_policy.audit_event_days,
      0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  delete from public.transaction_candidates c
  where c.status = 'rejected'
    and coalesce(c.reviewed_at, c.updated_at, c.created_at)
      < v_now - make_interval(days => v_policy.rejected_candidate_days);
  get diagnostics v_rejected = row_count;

  delete from public.transaction_candidates c
  where c.status in ('duplicate', 'expired')
    and coalesce(c.reviewed_at, c.updated_at, c.created_at)
      < v_now - make_interval(days => v_policy.dedupe_event_days);
  get diagnostics v_dedupe = row_count;

  delete from public.source_events se
  where se.processing_status in ('parsed', 'ignored', 'error')
    and se.created_at < v_now - make_interval(days => v_policy.dedupe_event_days)
    and not exists (
      select 1
      from public.transaction_candidates c
      where c.source_event_id = se.id
    );
  get diagnostics v_source = row_count;

  delete from private.webhook_events we
  where we.status in ('processed', 'ignored', 'failed')
    and we.received_at < v_now - make_interval(days => v_policy.dedupe_event_days);
  get diagnostics v_webhook = row_count;

  delete from private.rate_limit_windows rl
  where rl.expires_at < v_now;
  get diagnostics v_rate = row_count;

  if (v_rejected + v_dedupe + v_source + v_webhook + v_rate) > 0 then
    insert into private.audit_events (
      user_id,
      actor,
      action,
      entity_type,
      metadata
    ) values (
      null,
      'system',
      'retention.purge',
      'maintenance',
      jsonb_build_object(
        'rejectedCandidateDays', v_policy.rejected_candidate_days,
        'dedupeEventDays', v_policy.dedupe_event_days,
        'auditEventDays', v_policy.audit_event_days,
        'rejectedCandidatesDeleted', v_rejected,
        'dedupeCandidatesDeleted', v_dedupe,
        'sourceEventsDeleted', v_source,
        'webhookEventsDeleted', v_webhook,
        'rateLimitWindowsDeleted', v_rate
      )
    );
  end if;

  return query select
    true,
    v_policy.rejected_candidate_days,
    v_policy.dedupe_event_days,
    v_policy.audit_event_days,
    v_rejected,
    v_dedupe,
    v_source,
    v_webhook,
    v_rate;
end;
$function$;

alter function public.service_purge_expired_data() owner to postgres;
revoke all on function public.service_purge_expired_data() from public, anon, authenticated;
grant execute on function public.service_purge_expired_data() to service_role;

-- Run the same backend RPC directly in Postgres once per day. This avoids
-- storing CRON_SECRET in a database job while keeping the Edge endpoint
-- available for authenticated operations/manual maintenance.
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'capitalflow-retention-purge-daily',
  '17 8 * * *',
  $cron$select * from public.service_purge_expired_data();$cron$
);

notify pgrst, 'reload schema';

commit;
