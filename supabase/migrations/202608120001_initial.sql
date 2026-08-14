-- CapitalFlow MVP initial schema
-- PostgreSQL / Supabase

begin;

create extension if not exists pgcrypto;
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  base_currency text not null default 'COP' check (base_currency ~ '^[A-Z]{3}$'),
  locale text not null default 'es-CO',
  timezone text not null default 'America/Bogota',
  onboarding_completed boolean not null default false,
  privacy_version text,
  privacy_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'whop' check (provider = 'whop'),
  provider_customer_id text,
  provider_membership_id text,
  provider_plan_id text,
  interval text check (interval in ('weekly', 'annual')),
  status text not null default 'unresolved' check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired', 'unresolved')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  raw_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_membership_id)
);
create index subscriptions_user_status_idx on public.subscriptions(user_id, status, current_period_end desc);

create or replace function private.user_has_active_subscription(p_user_id uuid)
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
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;
revoke all on function private.user_has_active_subscription(uuid) from public, anon, authenticated;
grant execute on function private.user_has_active_subscription(uuid) to service_role;

create or replace function public.has_active_subscription()
returns boolean
language sql
stable
security definer
set search_path = public, private, auth
as $$
  select private.user_has_active_subscription(auth.uid());
$$;
grant execute on function public.has_active_subscription() to authenticated;

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  type text not null check (type in ('cash', 'checking', 'savings', 'credit', 'investment', 'other')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  opening_balance_minor bigint not null default 0 check (opening_balance_minor between -9007199254740991 and 9007199254740991),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index accounts_user_idx on public.accounts(user_id, is_archived);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null check (kind in ('income', 'expense', 'goal', 'investment', 'mixed')),
  icon text,
  color text,
  is_system boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index categories_user_name_kind_uidx on public.categories(user_id, lower(name), kind) where is_archived = false;

create table public.source_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gmail', 'outlook')),
  provider_subject text,
  email_address text,
  status text not null default 'pending' check (status in ('active', 'expired', 'revoked', 'error', 'pending')),
  granted_scopes text[] not null default '{}',
  cursor text,
  watch_resource_id text,
  watch_expires_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table private.oauth_credentials (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null unique references public.source_connections(id) on delete cascade,
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  encryption_version smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gmail', 'outlook')),
  code_verifier text not null,
  return_url text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index oauth_states_expiry_idx on private.oauth_states(expires_at) where used_at is null;

create table public.source_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid references public.source_connections(id) on delete set null,
  provider text not null check (provider in ('android_notification', 'gmail', 'outlook')),
  external_id text,
  app_package text,
  occurred_at timestamptz not null,
  sender_normalized text,
  title_sanitized text,
  text_sanitized text,
  fingerprint text not null,
  metadata jsonb not null default '{}'::jsonb,
  processing_status text not null default 'received' check (processing_status in ('received', 'parsed', 'ignored', 'error')),
  processing_error text,
  created_at timestamptz not null default now(),
  unique (user_id, provider, fingerprint)
);
create index source_events_user_occurred_idx on public.source_events(user_id, occurred_at desc);

create table public.transaction_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_event_id uuid references public.source_events(id) on delete set null,
  provider text not null check (provider in ('android_notification', 'gmail', 'outlook')),
  external_id text,
  app_package text,
  proposed_kind text not null check (proposed_kind in ('income', 'expense')),
  amount_minor bigint not null check (amount_minor between 1 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  merchant text,
  description text,
  occurred_at timestamptz not null,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  fingerprint text not null,
  dedupe_key text not null,
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  parser_version text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'duplicate', 'expired')),
  duplicate_of uuid references public.transaction_candidates(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, fingerprint)
);
create index candidates_user_status_idx on public.transaction_candidates(user_id, status, occurred_at desc);
create index candidates_user_dedupe_idx on public.transaction_candidates(user_id, dedupe_key, occurred_at desc);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  category_id uuid references public.categories(id) on delete set null,
  kind text not null check (kind in ('income', 'expense', 'transfer', 'goal_contribution', 'investment_contribution', 'investment_return', 'adjustment')),
  amount_minor bigint not null check (amount_minor between 0 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  merchant text,
  description text,
  occurred_at timestamptz not null,
  source text not null default 'manual' check (source in ('manual', 'android_notification', 'gmail', 'outlook', 'system')),
  source_candidate_id uuid unique references public.transaction_candidates(id) on delete set null,
  transfer_group_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transactions_user_occurred_idx on public.transactions(user_id, occurred_at desc);
create index transactions_account_idx on public.transactions(account_id, occurred_at desc);
create index transactions_category_idx on public.transactions(category_id, occurred_at desc);

create table public.transaction_revisions (
  id bigint generated always as identity primary key,
  transaction_id uuid not null,
  user_id uuid not null,
  actor_user_id uuid,
  action text not null check (action in ('update', 'delete')),
  previous_row jsonb not null,
  created_at timestamptz not null default now()
);
create index transaction_revisions_user_idx on public.transaction_revisions(user_id, created_at desc);

create table public.categorization_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  match_type text not null check (match_type in ('merchant_contains', 'sender_equals', 'app_package_equals', 'description_contains')),
  match_value text not null,
  category_id uuid not null references public.categories(id) on delete cascade,
  transaction_kind text check (transaction_kind in ('income', 'expense')),
  priority integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index categorization_rules_user_priority_idx on public.categorization_rules(user_id, is_active, priority desc);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  target_minor bigint not null check (target_minor between 1 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  target_date date,
  priority smallint not null default 3 check (priority between 1 and 5),
  status text not null default 'active' check (status in ('active', 'completed', 'paused', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index goals_user_status_idx on public.goals(user_id, status, priority desc);

create table public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  transaction_id uuid references public.transactions(id) on delete set null,
  amount_minor bigint not null check (amount_minor between 1 and 9007199254740991),
  note text,
  contributed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index goal_contributions_goal_idx on public.goal_contributions(goal_id, contributed_at desc);

create table public.investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null check (char_length(name) between 1 and 100),
  asset_class text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  risk_level text not null default 'medium' check (risk_level in ('low', 'medium', 'high')),
  notes text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.investment_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  investment_id uuid not null references public.investments(id) on delete cascade,
  transaction_id uuid references public.transactions(id) on delete set null,
  kind text not null check (kind in ('contribution', 'withdrawal', 'income', 'fee')),
  amount_minor bigint not null check (amount_minor between 0 and 9007199254740991),
  occurred_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);
create index investment_transactions_investment_idx on public.investment_transactions(investment_id, occurred_at desc);

create table public.investment_valuations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  investment_id uuid not null references public.investments(id) on delete cascade,
  value_minor bigint not null check (value_minor between 0 and 9007199254740991),
  valued_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);
create index investment_valuations_investment_idx on public.investment_valuations(investment_id, valued_at desc);

create table public.budget_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete cascade,
  label text not null,
  kind text not null check (kind in ('essential', 'discretionary')),
  amount_minor bigint not null check (amount_minor between 0 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  cadence text not null default 'monthly' check (cadence in ('weekly', 'monthly', 'annual', 'one_time')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.financial_preferences (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  risk_tolerance text not null default 'medium' check (risk_tolerance in ('low', 'medium', 'high')),
  emergency_months_target numeric(4,1) not null default 3 check (emergency_months_target between 0 and 36),
  target_annual_return_bps integer not null default 800 check (target_annual_return_bps between -9900 and 100000),
  horizon_months integer not null default 60 check (horizon_months between 0 and 1200),
  ai_explanations_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.advisor_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  engine_version text not null,
  input_snapshot jsonb not null,
  plan_snapshot jsonb not null,
  ai_explanation text,
  created_at timestamptz not null default now()
);
create index advisor_runs_user_idx on public.advisor_runs(user_id, created_at desc);

create table private.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  attempts integer not null default 0,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

create table private.audit_events (
  id bigint generated always as identity primary key,
  user_id uuid,
  actor text not null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table private.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.source_connections(id) on delete cascade,
  provider text not null check (provider in ('gmail', 'outlook')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  cursor_before text,
  cursor_after text,
  scanned_count integer not null default 0,
  inserted_count integer not null default 0,
  duplicate_count integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create unique index sync_jobs_connection_active_uidx
on private.sync_jobs(connection_id)
where status in ('queued', 'running');

-- Tenant-safe foreign references. RLS protects rows, while this trigger also
-- prevents a user-owned row from pointing at another user's hidden resource.
create or replace function private.enforce_owned_references()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_category_kind text;
begin
  if tg_table_name = 'transactions' then
    if not exists (select 1 from public.accounts a where a.id = new.account_id and a.user_id = new.user_id) then
      raise exception 'account_not_owned' using errcode = '42501';
    end if;
    if new.source_candidate_id is not null and not exists (
      select 1 from public.transaction_candidates c where c.id = new.source_candidate_id and c.user_id = new.user_id
    ) then
      raise exception 'candidate_not_owned' using errcode = '42501';
    end if;
    if new.category_id is not null then
      select c.kind into v_category_kind from public.categories c where c.id = new.category_id and c.user_id = new.user_id;
      if not found then raise exception 'category_not_owned' using errcode = '42501'; end if;
      if new.kind in ('income', 'expense') and v_category_kind not in (new.kind, 'mixed') then
        raise exception 'category_kind_mismatch' using errcode = '23514';
      end if;
    end if;

  elsif tg_table_name = 'goals' then
    if new.category_id is not null then
      select c.kind into v_category_kind from public.categories c where c.id = new.category_id and c.user_id = new.user_id;
      if not found then raise exception 'category_not_owned' using errcode = '42501'; end if;
      if v_category_kind not in ('goal', 'mixed') then raise exception 'category_kind_mismatch' using errcode = '23514'; end if;
    end if;

  elsif tg_table_name = 'investments' then
    if new.category_id is not null then
      select c.kind into v_category_kind from public.categories c where c.id = new.category_id and c.user_id = new.user_id;
      if not found then raise exception 'category_not_owned' using errcode = '42501'; end if;
      if v_category_kind not in ('investment', 'mixed') then raise exception 'category_kind_mismatch' using errcode = '23514'; end if;
    end if;

  elsif tg_table_name = 'goal_contributions' then
    if not exists (select 1 from public.goals g where g.id = new.goal_id and g.user_id = new.user_id) then
      raise exception 'goal_not_owned' using errcode = '42501';
    end if;
    if new.transaction_id is not null and not exists (
      select 1 from public.transactions t where t.id = new.transaction_id and t.user_id = new.user_id
    ) then
      raise exception 'transaction_not_owned' using errcode = '42501';
    end if;

  elsif tg_table_name = 'investment_transactions' then
    if not exists (select 1 from public.investments i where i.id = new.investment_id and i.user_id = new.user_id) then
      raise exception 'investment_not_owned' using errcode = '42501';
    end if;
    if new.transaction_id is not null and not exists (
      select 1 from public.transactions t where t.id = new.transaction_id and t.user_id = new.user_id
    ) then
      raise exception 'transaction_not_owned' using errcode = '42501';
    end if;

  elsif tg_table_name = 'investment_valuations' then
    if not exists (select 1 from public.investments i where i.id = new.investment_id and i.user_id = new.user_id) then
      raise exception 'investment_not_owned' using errcode = '42501';
    end if;

  elsif tg_table_name = 'categorization_rules' then
    select c.kind into v_category_kind from public.categories c where c.id = new.category_id and c.user_id = new.user_id;
    if not found then raise exception 'category_not_owned' using errcode = '42501'; end if;
    if new.transaction_kind is not null and v_category_kind not in (new.transaction_kind, 'mixed') then
      raise exception 'category_kind_mismatch' using errcode = '23514';
    end if;

  elsif tg_table_name = 'budget_items' and new.category_id is not null then
    if not exists (select 1 from public.categories c where c.id = new.category_id and c.user_id = new.user_id) then
      raise exception 'category_not_owned' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;
revoke all on function private.enforce_owned_references() from public, anon, authenticated;

create trigger enforce_transactions_owned_references
before insert or update on public.transactions
for each row execute function private.enforce_owned_references();
create trigger enforce_goals_owned_references
before insert or update on public.goals
for each row execute function private.enforce_owned_references();
create trigger enforce_investments_owned_references
before insert or update on public.investments
for each row execute function private.enforce_owned_references();
create trigger enforce_goal_contributions_owned_references
before insert or update on public.goal_contributions
for each row execute function private.enforce_owned_references();
create trigger enforce_investment_transactions_owned_references
before insert or update on public.investment_transactions
for each row execute function private.enforce_owned_references();
create trigger enforce_investment_valuations_owned_references
before insert or update on public.investment_valuations
for each row execute function private.enforce_owned_references();
create trigger enforce_categorization_rules_owned_references
before insert or update on public.categorization_rules
for each row execute function private.enforce_owned_references();
create trigger enforce_budget_items_owned_references
before insert or update on public.budget_items
for each row execute function private.enforce_owned_references();

-- Updated-at triggers.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles','subscriptions','accounts','categories','source_connections',
    'transaction_candidates','transactions','categorization_rules','goals',
    'investments','budget_items'
  ] loop
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end;
$$;

create trigger set_oauth_credentials_updated_at
before update on private.oauth_credentials
for each row execute function public.set_updated_at();

create trigger set_financial_preferences_updated_at
before update on public.financial_preferences
for each row execute function public.set_updated_at();

create or replace function private.capture_transaction_revision()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.transaction_revisions(transaction_id, user_id, actor_user_id, action, previous_row)
  values (old.id, old.user_id, auth.uid(), lower(tg_op), to_jsonb(old));
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function private.capture_transaction_revision() from public, anon, authenticated;

create trigger capture_transaction_revision
before update or delete on public.transactions
for each row execute function private.capture_transaction_revision();

create or replace function private.refresh_goal_status()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_goal_id uuid := coalesce(new.goal_id, old.goal_id);
  v_total bigint;
  v_target bigint;
begin
  select g.target_minor, coalesce(sum(gc.amount_minor), 0)
    into v_target, v_total
  from public.goals g
  left join public.goal_contributions gc on gc.goal_id = g.id
  where g.id = v_goal_id
  group by g.target_minor;

  if v_target is not null then
    update public.goals
      set status = case
        when status in ('paused', 'canceled') then status
        when v_total >= v_target then 'completed'
        else 'active'
      end
    where id = v_goal_id;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function private.refresh_goal_status() from public, anon, authenticated;

create trigger refresh_goal_status_after_contribution
after insert or update or delete on public.goal_contributions
for each row execute function private.refresh_goal_status();

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

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

-- Read models. security_invoker ensures base-table RLS is applied.
create or replace view public.account_balances
with (security_invoker = true)
as
select
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
  ), 0)::bigint as balance_minor
from public.accounts a
left join public.transactions t on t.account_id = a.id
 group by a.id;

create or replace view public.monthly_cashflow
with (security_invoker = true)
as
select
  t.user_id,
  date_trunc('month', t.occurred_at) as month,
  t.currency,
  coalesce(sum(t.amount_minor) filter (where t.kind = 'income'), 0)::bigint as income_minor,
  coalesce(sum(t.amount_minor) filter (where t.kind = 'expense'), 0)::bigint as expense_minor,
  (
    coalesce(sum(t.amount_minor) filter (where t.kind = 'income'), 0)
    - coalesce(sum(t.amount_minor) filter (where t.kind = 'expense'), 0)
  )::bigint as net_minor
from public.transactions t
where t.kind in ('income', 'expense')
group by t.user_id, date_trunc('month', t.occurred_at), t.currency;

create or replace view public.goal_progress
with (security_invoker = true)
as
select
  g.id,
  g.user_id,
  g.category_id,
  g.name,
  g.target_minor,
  coalesce(sum(gc.amount_minor), 0)::bigint as current_minor,
  greatest(g.target_minor - coalesce(sum(gc.amount_minor), 0), 0)::bigint as remaining_minor,
  g.currency,
  g.target_date,
  g.priority,
  g.status,
  g.created_at,
  g.updated_at
from public.goals g
left join public.goal_contributions gc on gc.goal_id = g.id
group by g.id;

create or replace view public.investment_performance
with (security_invoker = true)
as
with transaction_totals as (
  select
    investment_id,
    sum(case
      when kind = 'contribution' then amount_minor
      when kind = 'withdrawal' then -amount_minor
      else 0
    end)::bigint as net_contributions_minor,
    max(occurred_at) as last_transaction_at
  from public.investment_transactions
  group by investment_id
), latest_valuations as (
  select distinct on (investment_id)
    investment_id,
    value_minor,
    valued_at
  from public.investment_valuations
  order by investment_id, valued_at desc, created_at desc
)
select
  i.id,
  i.user_id,
  i.category_id,
  i.name,
  i.asset_class,
  i.currency,
  greatest(coalesce(tt.net_contributions_minor, 0), 0)::bigint as net_contributions_minor,
  coalesce(lv.value_minor, 0)::bigint as current_value_minor,
  case
    when coalesce(tt.net_contributions_minor, 0) <= 0 then null
    else round(((coalesce(lv.value_minor, 0) - tt.net_contributions_minor)::numeric / tt.net_contributions_minor) * 10000)::integer
  end as return_bps,
  i.risk_level,
  i.notes,
  i.is_archived,
  greatest(
    i.updated_at,
    coalesce(lv.valued_at, i.updated_at),
    coalesce(tt.last_transaction_at, i.updated_at)
  ) as updated_at
from public.investments i
left join transaction_totals tt on tt.investment_id = i.id
left join latest_valuations lv on lv.investment_id = i.id;

create or replace function public.accept_transaction_candidate(
  p_candidate_id uuid,
  p_account_id uuid,
  p_category_id uuid default null,
  p_corrections jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_candidate public.transaction_candidates%rowtype;
  v_account public.accounts%rowtype;
  v_category public.categories%rowtype;
  v_kind text;
  v_amount bigint;
  v_currency text;
  v_merchant text;
  v_description text;
  v_transaction_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not private.user_has_active_subscription(v_user_id) then
    raise exception 'active_subscription_required' using errcode = '42501';
  end if;

  select * into v_candidate
  from public.transaction_candidates
  where id = p_candidate_id and user_id = v_user_id and status = 'pending'
  for update;
  if not found then
    raise exception 'candidate_not_found_or_not_pending' using errcode = 'P0002';
  end if;

  select * into v_account
  from public.accounts
  where id = p_account_id and user_id = v_user_id and is_archived = false;
  if not found then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;

  if p_category_id is not null then
    select * into v_category
    from public.categories
    where id = p_category_id and user_id = v_user_id and is_archived = false;
    if not found then
      raise exception 'category_not_found' using errcode = 'P0002';
    end if;
  end if;

  v_kind := coalesce(nullif(p_corrections ->> 'kind', ''), v_candidate.proposed_kind);
  if v_kind not in ('income', 'expense') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;

  v_amount := case
    when p_corrections ? 'amountMinor' then (p_corrections ->> 'amountMinor')::bigint
    else v_candidate.amount_minor
  end;
  if v_amount <= 0 or v_amount > 9007199254740991 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  v_currency := upper(coalesce(nullif(p_corrections ->> 'currency', ''), v_candidate.currency));
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid_currency' using errcode = '22023';
  end if;
  if v_account.currency <> v_currency then
    raise exception 'account_currency_mismatch' using errcode = '22023';
  end if;

  if p_category_id is not null and v_category.kind not in (v_kind, 'mixed') then
    raise exception 'category_kind_mismatch' using errcode = '22023';
  end if;

  v_merchant := case when p_corrections ? 'merchant' then nullif(p_corrections ->> 'merchant', '') else v_candidate.merchant end;
  v_description := case when p_corrections ? 'description' then nullif(p_corrections ->> 'description', '') else v_candidate.description end;

  insert into public.transactions(
    user_id, account_id, category_id, kind, amount_minor, currency,
    merchant, description, occurred_at, source, source_candidate_id,
    metadata
  ) values (
    v_user_id, p_account_id, p_category_id, v_kind, v_amount, v_currency,
    v_merchant, v_description, v_candidate.occurred_at, v_candidate.provider,
    v_candidate.id,
    jsonb_build_object('parser_version', v_candidate.parser_version, 'confidence', v_candidate.confidence)
  ) returning id into v_transaction_id;

  update public.transaction_candidates
  set status = 'accepted', reviewed_at = now()
  where id = v_candidate.id;

  insert into private.audit_events(user_id, actor, action, entity_type, entity_id, metadata)
  values (v_user_id, 'user', 'candidate.accepted', 'transaction', v_transaction_id::text, jsonb_build_object('candidate_id', v_candidate.id));

  return v_transaction_id;
end;
$$;
revoke all on function public.accept_transaction_candidate(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.accept_transaction_candidate(uuid, uuid, uuid, jsonb) to authenticated;

-- Row-level security.
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.source_connections enable row level security;
alter table public.source_events enable row level security;
alter table public.transaction_candidates enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_revisions enable row level security;
alter table public.categorization_rules enable row level security;
alter table public.goals enable row level security;
alter table public.goal_contributions enable row level security;
alter table public.investments enable row level security;
alter table public.investment_transactions enable row level security;
alter table public.investment_valuations enable row level security;
alter table public.budget_items enable row level security;
alter table public.financial_preferences enable row level security;
alter table public.advisor_runs enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy subscriptions_select_own on public.subscriptions for select to authenticated using (user_id = auth.uid());

create policy source_connections_select_own on public.source_connections for select to authenticated using (user_id = auth.uid());
create policy source_events_select_own on public.source_events for select to authenticated using (user_id = auth.uid());
create policy candidates_select_own on public.transaction_candidates for select to authenticated using (user_id = auth.uid());
create policy candidates_update_own_active on public.transaction_candidates for update to authenticated
  using (user_id = auth.uid() and public.has_active_subscription())
  with check (user_id = auth.uid() and public.has_active_subscription());
create policy revisions_select_own on public.transaction_revisions for select to authenticated using (user_id = auth.uid());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'accounts','categories','transactions','categorization_rules','goals',
    'goal_contributions','investments','investment_transactions',
    'investment_valuations','budget_items','financial_preferences','advisor_runs'
  ] loop
    execute format('create policy %I_select_own on public.%I for select to authenticated using (user_id = auth.uid())', table_name, table_name);
    execute format('create policy %I_insert_own_active on public.%I for insert to authenticated with check (user_id = auth.uid() and public.has_active_subscription())', table_name, table_name);
    execute format('create policy %I_update_own_active on public.%I for update to authenticated using (user_id = auth.uid() and public.has_active_subscription()) with check (user_id = auth.uid() and public.has_active_subscription())', table_name, table_name);
    execute format('create policy %I_delete_own_active on public.%I for delete to authenticated using (user_id = auth.uid() and public.has_active_subscription())', table_name, table_name);
  end loop;
end;
$$;

-- Explicit grants; RLS still applies.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select on public.account_balances, public.monthly_cashflow, public.goal_progress, public.investment_performance to authenticated;

revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;
grant all on all tables in schema private to service_role;
grant all on all sequences in schema private to service_role;

commit;
