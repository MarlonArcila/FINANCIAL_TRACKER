-- CapitalFlow MVP: automation-first ingestion, annual AI entitlement and multi-currency support.
begin;

alter table public.profiles
  add column if not exists enabled_currencies text[] not null default array['COP']::text[];

alter table public.financial_preferences
  add column if not exists auto_post_enabled boolean not null default true,
  add column if not exists auto_post_min_confidence numeric(5,4) not null default 0.9400 check (auto_post_min_confidence between 0.70 and 0.9999),
  add column if not exists auto_review_min_confidence numeric(5,4) not null default 0.7000 check (auto_review_min_confidence between 0.50 and 0.95),
  add column if not exists learn_from_reviews boolean not null default true,
  add column if not exists auto_use_other_category boolean not null default true;

alter table public.transaction_candidates
  add column if not exists auto_decision boolean not null default false,
  add column if not exists review_reason text,
  add column if not exists resolved_account_id uuid references public.accounts(id) on delete set null,
  add column if not exists resolved_category_id uuid references public.categories(id) on delete set null,
  add column if not exists automation_score numeric(5,4) check (automation_score is null or automation_score between 0 and 1),
  add column if not exists automation_metadata jsonb not null default '{}'::jsonb;

alter table public.transactions
  add column if not exists auto_posted boolean not null default false,
  add column if not exists base_currency text check (base_currency is null or base_currency ~ '^[A-Z]{3}$'),
  add column if not exists base_amount_minor bigint check (base_amount_minor is null or base_amount_minor between 0 and 9007199254740991),
  add column if not exists fx_rate numeric(24,12) check (fx_rate is null or fx_rate > 0),
  add column if not exists fx_source text,
  add column if not exists fx_rate_at timestamptz;

create table if not exists public.account_assignment_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  match_type text not null check (match_type in ('sender_equals', 'app_package_equals')),
  match_value text not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  transaction_kind text check (transaction_kind in ('income', 'expense')),
  priority integer not null default 100,
  is_active boolean not null default true,
  learned_from_candidate_id uuid references public.transaction_candidates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists account_assignment_rules_unique_match
  on public.account_assignment_rules(user_id, match_type, lower(match_value), coalesce(transaction_kind, ''))
  where is_active = true;
create index if not exists account_assignment_rules_user_priority_idx
  on public.account_assignment_rules(user_id, is_active, priority desc);

create table if not exists public.exchange_rates (
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text not null check (quote_currency ~ '^[A-Z]{3}$'),
  provider text not null,
  rate numeric(24,12) not null check (rate > 0),
  source_label text not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  primary key (base_currency, quote_currency, provider)
);

create or replace function private.user_has_annual_subscription(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = p_user_id
      and s.interval = 'annual'
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;
revoke all on function private.user_has_annual_subscription(uuid) from public, anon, authenticated;
grant execute on function private.user_has_annual_subscription(uuid) to service_role;

create or replace function public.has_annual_subscription()
returns boolean
language sql
stable
security definer
set search_path = public, private, auth
as $$
  select private.user_has_annual_subscription(auth.uid());
$$;
grant execute on function public.has_annual_subscription() to authenticated;

create or replace function private.normalize_profile_currencies()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  normalized text[];
begin
  new.base_currency := upper(new.base_currency);
  select array_agg(distinct upper(value) order by upper(value))
    into normalized
  from unnest(coalesce(new.enabled_currencies, array[]::text[])) as value
  where upper(value) ~ '^[A-Z]{3}$';

  if normalized is null or cardinality(normalized) = 0 then
    normalized := array[new.base_currency];
  elsif not (new.base_currency = any(normalized)) then
    normalized := array_append(normalized, new.base_currency);
  end if;

  if cardinality(normalized) > 20 then
    raise exception 'too_many_enabled_currencies' using errcode = '22023';
  end if;
  new.enabled_currencies := normalized;
  return new;
end;
$$;

create trigger normalize_profile_currencies_before_write
before insert or update of base_currency, enabled_currencies on public.profiles
for each row execute function private.normalize_profile_currencies();

-- Normalize existing profiles too; this also guarantees that an existing non-COP
-- base currency is present in enabled_currencies after the migration.
update public.profiles set enabled_currencies = enabled_currencies;

alter table public.account_assignment_rules enable row level security;
alter table public.exchange_rates enable row level security;

create policy account_assignment_rules_select_own on public.account_assignment_rules
  for select to authenticated using (user_id = auth.uid());
create policy account_assignment_rules_insert_own_active on public.account_assignment_rules
  for insert to authenticated with check (user_id = auth.uid() and public.has_active_subscription());
create policy account_assignment_rules_update_own_active on public.account_assignment_rules
  for update to authenticated using (user_id = auth.uid() and public.has_active_subscription())
  with check (user_id = auth.uid() and public.has_active_subscription());
create policy account_assignment_rules_delete_own_active on public.account_assignment_rules
  for delete to authenticated using (user_id = auth.uid() and public.has_active_subscription());

create policy exchange_rates_read_authenticated on public.exchange_rates
  for select to authenticated using (true);

create trigger set_account_assignment_rules_updated_at
before update on public.account_assignment_rules
for each row execute function public.set_updated_at();

create or replace view public.automation_metrics_30d
with (security_invoker = true)
as
select
  user_id,
  count(*) filter (where status <> 'duplicate')::integer as total_detected,
  count(*) filter (where status = 'accepted' and auto_decision = true)::integer as auto_posted,
  count(*) filter (where status = 'expired' and auto_decision = true)::integer as auto_ignored,
  count(*) filter (where status in ('accepted','rejected') and auto_decision = false)::integer as manually_resolved,
  count(*) filter (where status = 'pending')::integer as pending_review,
  case
    when count(*) filter (where status <> 'duplicate') = 0 then 100.0
    else round(100.0 * (count(*) filter (where status = 'accepted' and auto_decision = true))::numeric / (count(*) filter (where status <> 'duplicate')), 1)
  end as auto_post_rate_pct,
  case
    when count(*) filter (where status <> 'duplicate') = 0 then 0.0
    else round(100.0 * (count(*) filter (where status in ('pending','accepted','rejected') and auto_decision = false))::numeric / (count(*) filter (where status <> 'duplicate')), 1)
  end as intervention_rate_pct
from public.transaction_candidates
where created_at >= now() - interval '30 days'
group by user_id;

grant select on public.automation_metrics_30d to authenticated;

grant select, insert, update, delete on public.account_assignment_rules to authenticated;
grant select on public.exchange_rates to authenticated;
revoke insert, update, delete on public.exchange_rates from authenticated;

commit;
