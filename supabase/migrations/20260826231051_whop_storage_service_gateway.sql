begin;

-- Trusted Whop webhook mutation boundary. The service role receives EXECUTE only;
-- it still does not receive direct INSERT/UPDATE on subscriptions or accounts.
create or replace function public.service_apply_whop_membership(
  p_user_id uuid,
  p_provider_customer_id text,
  p_provider_membership_id text,
  p_provider_plan_id text,
  p_interval text,
  p_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_raw_status text
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_archived uuid[] := '{}'::uuid[];
begin
  if p_user_id is null or nullif(btrim(p_provider_membership_id), '') is null then
    raise exception 'invalid_whop_membership_identity' using errcode = '22023';
  end if;
  if p_interval is not null and p_interval not in ('weekly', 'annual') then
    raise exception 'invalid_whop_membership_interval' using errcode = '22023';
  end if;
  if p_status not in ('trialing', 'active', 'past_due', 'canceled', 'expired', 'unresolved') then
    raise exception 'invalid_whop_membership_status' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.subscriptions s
    where s.provider = 'whop'
      and s.provider_membership_id = p_provider_membership_id
      and s.user_id <> p_user_id
  ) then
    raise exception 'whop_membership_user_mismatch' using errcode = '22023';
  end if;

  insert into public.subscriptions as existing (
    user_id, provider, provider_customer_id, provider_membership_id,
    provider_plan_id, interval, status, current_period_start,
    current_period_end, cancel_at_period_end, raw_status
  ) values (
    p_user_id, 'whop', nullif(p_provider_customer_id, ''), p_provider_membership_id,
    nullif(p_provider_plan_id, ''), p_interval, p_status, p_current_period_start,
    p_current_period_end, coalesce(p_cancel_at_period_end, false), p_raw_status
  )
  on conflict (provider, provider_membership_id) do update set
    provider_customer_id = excluded.provider_customer_id,
    provider_plan_id = excluded.provider_plan_id,
    interval = excluded.interval,
    status = excluded.status,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    raw_status = excluded.raw_status,
    updated_at = now();

  if not exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user_id
      and s.interval = 'annual'
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  ) and exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user_id
      and s.interval = 'weekly'
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  ) then
    with archived as (
      update public.accounts a
      set is_archived = true,
          archived_at = coalesce(a.archived_at, now()),
          updated_at = now()
      where a.user_id = p_user_id
        and a.is_primary = false
        and a.is_archived = false
      returning a.id
    )
    select coalesce(array_agg(id order by id), '{}'::uuid[])
    into v_archived
    from archived;
  end if;

  return v_archived;
end;
$function$;

-- Server-only backup read boundary. Financial tables remain unavailable for direct
-- service-role reads; the RPC returns only the portable backup-v2 document.
create or replace function public.service_build_user_backup(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'format', 'capitalflow-backup-v2',
    'generatedAt', now(),
    'data', jsonb_build_object(
      'profile', (select to_jsonb(p) from public.profiles p where p.id = p_user_id),
      'accounts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at, a.id) from public.accounts a where a.user_id = p_user_id), '[]'::jsonb),
      'categories', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at, c.id) from public.categories c where c.user_id = p_user_id), '[]'::jsonb),
      'transactions', coalesce((select jsonb_agg((to_jsonb(t) || jsonb_build_object('source_candidate_id', null, 'import_batch_id', null)) order by t.occurred_at, t.id) from public.transactions t where t.user_id = p_user_id), '[]'::jsonb),
      'goals', coalesce((select jsonb_agg(to_jsonb(g) order by g.created_at, g.id) from public.goals g where g.user_id = p_user_id), '[]'::jsonb),
      'goal_contributions', coalesce((select jsonb_agg(to_jsonb(gc) order by gc.created_at, gc.id) from public.goal_contributions gc where gc.user_id = p_user_id), '[]'::jsonb),
      'investments', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at, i.id) from public.investments i where i.user_id = p_user_id), '[]'::jsonb),
      'investment_transactions', coalesce((select jsonb_agg(to_jsonb(it) order by it.created_at, it.id) from public.investment_transactions it where it.user_id = p_user_id), '[]'::jsonb),
      'investment_valuations', coalesce((select jsonb_agg(to_jsonb(iv) order by iv.created_at, iv.id) from public.investment_valuations iv where iv.user_id = p_user_id), '[]'::jsonb),
      'categorization_rules', coalesce((select jsonb_agg(to_jsonb(cr) order by cr.created_at, cr.id) from public.categorization_rules cr where cr.user_id = p_user_id), '[]'::jsonb),
      'account_assignment_rules', coalesce((select jsonb_agg((to_jsonb(ar) || jsonb_build_object('learned_from_candidate_id', null)) order by ar.created_at, ar.id) from public.account_assignment_rules ar where ar.user_id = p_user_id), '[]'::jsonb),
      'budget_items', coalesce((select jsonb_agg(to_jsonb(bi) order by bi.created_at, bi.id) from public.budget_items bi where bi.user_id = p_user_id), '[]'::jsonb),
      'financial_preferences', coalesce((select jsonb_agg(to_jsonb(fp) order by fp.updated_at) from public.financial_preferences fp where fp.user_id = p_user_id), '[]'::jsonb)
    ),
    'excluded', jsonb_build_array(
      'Whop subscription entitlement',
      'Gmail connections and OAuth tokens',
      'cloud-storage OAuth tokens',
      'webhook secrets',
      'raw source events and transaction candidates',
      'advisor AI text and audit logs'
    )
  );
$function$;

alter function public.service_apply_whop_membership(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,text) owner to postgres;
alter function public.service_build_user_backup(uuid) owner to postgres;

revoke all on function public.service_apply_whop_membership(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,text) from public, anon, authenticated;
revoke all on function public.service_build_user_backup(uuid) from public, anon, authenticated;
grant execute on function public.service_apply_whop_membership(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,text) to service_role;
grant execute on function public.service_build_user_backup(uuid) to service_role;

-- Operational cloud-storage metadata only. OAuth tokens remain private and all
-- financial data is read through service_build_user_backup().
grant select, insert, update on table public.storage_connections to service_role;
grant select, insert, update on table public.cloud_backups to service_role;

notify pgrst, 'reload schema';
commit;
