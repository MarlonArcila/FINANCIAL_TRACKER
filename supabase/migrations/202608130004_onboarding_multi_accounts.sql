-- CapitalFlow: guided onboarding, annual multi-account workspaces, internal-only automation metrics.
begin;

alter table public.accounts
  add column if not exists is_primary boolean not null default false,
  add column if not exists purpose text not null default 'general'
    check (purpose in ('general','trip','work','shared','project','other')),
  add column if not exists purpose_label text check (purpose_label is null or char_length(purpose_label) <= 120),
  add column if not exists archived_at timestamptz;

-- Preserve existing users by promoting their oldest active account to primary.
with ranked as (
  select id, row_number() over (partition by user_id order by created_at, id) as rn
  from public.accounts
  where is_archived = false
)
update public.accounts a
set is_primary = true, purpose = 'general'
from ranked r
where a.id = r.id and r.rn = 1;

create unique index if not exists accounts_one_active_primary_uidx
  on public.accounts(user_id)
  where is_primary = true and is_archived = false;
create index if not exists accounts_user_purpose_idx
  on public.accounts(user_id, is_archived, purpose, created_at);

create table if not exists public.onboarding_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_completed boolean not null default false,
  currencies_completed boolean not null default false,
  email_completed boolean not null default false,
  notification_completed boolean not null default false,
  calibration_attempted boolean not null default false,
  associations_confirmed integer not null default 0 check (associations_confirmed between 0 and 5),
  calibration_target integer not null default 3 check (calibration_target between 3 and 5),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.onboarding_state(user_id, account_completed, currencies_completed, email_completed, notification_completed, completed_at)
select p.id,
       exists(select 1 from public.accounts a where a.user_id = p.id and a.is_archived = false),
       cardinality(coalesce(p.enabled_currencies, array[p.base_currency])) > 0,
       exists(select 1 from public.source_connections s where s.user_id = p.id and s.status = 'active'),
       p.onboarding_completed,
       case when p.onboarding_completed then p.updated_at else null end
from public.profiles p
on conflict (user_id) do nothing;

create or replace function private.active_subscription_interval(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select s.interval
  from public.subscriptions s
  where s.user_id = p_user_id
    and s.status in ('active','trialing')
    and (s.current_period_end is null or s.current_period_end > now())
  order by case when s.interval = 'annual' then 0 else 1 end, s.updated_at desc
  limit 1;
$$;
revoke all on function private.active_subscription_interval(uuid) from public, anon, authenticated;
grant execute on function private.active_subscription_interval(uuid) to service_role;

create or replace function private.enforce_account_plan()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_interval text;
  v_active_count integer;
begin
  v_interval := private.active_subscription_interval(new.user_id);
  if v_interval is null then
    raise exception 'active_subscription_required' using errcode = '42501';
  end if;

  new.currency := upper(new.currency);
  if new.is_archived then
    new.archived_at := coalesce(new.archived_at, now());
  else
    new.archived_at := null;
  end if;

  select count(*) into v_active_count
  from public.accounts a
  where a.user_id = new.user_id
    and a.is_archived = false
    and (tg_op = 'INSERT' or a.id <> new.id);

  if tg_op = 'INSERT' and v_active_count = 0 and new.is_archived = false then
    new.is_primary := true;
    new.purpose := 'general';
  end if;

  if v_interval = 'weekly' then
    if new.is_archived = false and v_active_count >= 1 and (tg_op = 'INSERT' or old.is_archived = true) then
      raise exception 'annual_subscription_required_for_multiple_accounts' using errcode = '42501';
    end if;
    if new.is_archived = false then
      new.is_primary := true;
      new.purpose := 'general';
      new.purpose_label := null;
    end if;
  end if;

  if tg_op = 'UPDATE' and old.is_primary = true and new.is_archived = true then
    raise exception 'primary_account_cannot_be_archived' using errcode = '22023';
  end if;
  if new.is_primary = true and new.is_archived = true then
    raise exception 'archived_account_cannot_be_primary' using errcode = '22023';
  end if;

  return new;
end;
$$;
revoke all on function private.enforce_account_plan() from public, anon, authenticated;

drop trigger if exists enforce_account_plan_before_write on public.accounts;
create trigger enforce_account_plan_before_write
before insert or update of is_archived, is_primary, purpose, purpose_label, currency on public.accounts
for each row execute function private.enforce_account_plan();

alter table public.onboarding_state enable row level security;
create policy onboarding_state_select_own on public.onboarding_state
  for select to authenticated using (user_id = auth.uid());
create policy onboarding_state_insert_own on public.onboarding_state
  for insert to authenticated with check (user_id = auth.uid() and public.has_active_subscription());
create policy onboarding_state_update_own on public.onboarding_state
  for update to authenticated using (user_id = auth.uid() and public.has_active_subscription())
  with check (user_id = auth.uid() and public.has_active_subscription());
grant select, insert, update on public.onboarding_state to authenticated;

create trigger set_onboarding_state_updated_at
before update on public.onboarding_state
for each row execute function public.set_updated_at();

-- Metrics remain available to service-role/internal QA, never to the product UI.
drop view if exists public.automation_metrics_30d;
create or replace view private.automation_metrics_30d as
select
  user_id,
  count(*) filter (where status <> 'duplicate')::integer as total_detected,
  count(*) filter (where status = 'accepted' and auto_decision = true)::integer as auto_posted,
  count(*) filter (where status = 'expired' and auto_decision = true)::integer as auto_ignored,
  count(*) filter (where status in ('accepted','rejected') and auto_decision = false)::integer as manually_resolved,
  count(*) filter (where status = 'pending')::integer as pending_review,
  case when count(*) filter (where status <> 'duplicate') = 0 then 100.0
       else round(100.0 * (count(*) filter (where status = 'accepted' and auto_decision = true))::numeric /
                  (count(*) filter (where status <> 'duplicate')), 1) end as auto_post_rate_pct,
  case when count(*) filter (where status <> 'duplicate') = 0 then 0.0
       else round(100.0 * (count(*) filter (where status in ('pending','accepted','rejected') and auto_decision = false))::numeric /
                  (count(*) filter (where status <> 'duplicate')), 1) end as intervention_rate_pct
from public.transaction_candidates
where created_at >= now() - interval '30 days'
group by user_id;
revoke all on private.automation_metrics_30d from public, anon, authenticated;
grant select on private.automation_metrics_30d to service_role;

-- Keep the account balance view useful for scoped annual accounts.
-- PostgreSQL CREATE OR REPLACE VIEW requires all existing columns to
-- preserve their original name, type and position. New columns are
-- therefore appended after the original account_balances columns.
create or replace view public.account_balances
with (security_invoker = true)
as
select
  -- Existing view columns: keep this order unchanged.
  a.id,
  a.user_id,
  a.name,
  a.type,
  a.currency,
  a.opening_balance_minor,
  a.is_archived,
  a.created_at,
  a.updated_at,
  a.opening_balance_minor + coalesce(sum(
    case
      when t.kind in ('income', 'investment_return') then t.amount_minor
      when t.kind in ('expense', 'goal_contribution', 'investment_contribution') then -t.amount_minor
      else 0
    end
  ), 0)::bigint as balance_minor,

  -- Multi-account columns added by this migration.
  a.is_primary,
  a.purpose,
  a.purpose_label,
  a.archived_at
from public.accounts a
left join public.transactions t
  on t.account_id = a.id
group by a.id;

-- Extend new-user provisioning without changing the existing trigger.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, private, auth
as $$
begin
  insert into public.profiles(id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;

  insert into public.financial_preferences(user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.onboarding_state(user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.categories(user_id, name, kind, icon, is_system)
  values
    (new.id, 'Salario', 'income', '↗', true),
    (new.id, 'Otros ingresos', 'income', '+', true),
    (new.id, 'Alimentación', 'expense', '◉', true),
    (new.id, 'Vivienda', 'expense', '⌂', true),
    (new.id, 'Transporte', 'expense', '→', true),
    (new.id, 'Salud', 'expense', '+', true),
    (new.id, 'Educación', 'expense', '□', true),
    (new.id, 'Entretenimiento', 'expense', '◇', true),
    (new.id, 'Otros', 'mixed', '•', true)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

commit;
