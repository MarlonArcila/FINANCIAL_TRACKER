-- CapitalFlow: portable imports for all paid plans + annual cloud backup/restore.
begin;

-- File imports are regular ledger transactions, but remain auditable and deduplicable.
create table public.data_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  filename text not null check (char_length(filename) between 1 and 240),
  file_type text not null check (file_type in ('csv','tsv','txt','xlsx','xls','json')),
  file_sha256 text check (file_sha256 is null or file_sha256 ~ '^[a-f0-9]{64}$'),
  source_app text,
  mapping jsonb not null default '{}'::jsonb,
  status text not null default 'processing' check (status in ('processing','completed','failed','canceled')),
  rows_seen integer not null default 0 check (rows_seen >= 0),
  rows_imported integer not null default 0 check (rows_imported >= 0),
  rows_duplicate integer not null default 0 check (rows_duplicate >= 0),
  rows_rejected integer not null default 0 check (rows_rejected >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index data_imports_user_created_idx on public.data_imports(user_id, created_at desc);
create index data_imports_user_hash_idx on public.data_imports(user_id, file_sha256) where file_sha256 is not null;

alter table public.transactions
  add column if not exists import_batch_id uuid references public.data_imports(id) on delete set null,
  add column if not exists import_key text;
create unique index if not exists transactions_user_import_key_uidx
  on public.transactions(user_id, import_key) where import_key is not null;

alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions add constraint transactions_source_check
  check (source in ('manual', 'android_notification', 'gmail', 'outlook', 'system', 'import_file'));

-- Annual cloud storage uses a separate least-privilege OAuth connection from email ingestion.
create table public.storage_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google_drive','onedrive')),
  provider_subject text,
  account_label text,
  status text not null default 'pending' check (status in ('active','expired','revoked','error','pending')),
  granted_scopes text[] not null default '{}',
  last_backup_at timestamptz,
  last_restore_at timestamptz,
  backup_frequency text not null default 'weekly' check (backup_frequency in ('manual','daily','weekly')),
  next_backup_at timestamptz default (now() + interval '7 days'),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table private.storage_oauth_credentials (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null unique references public.storage_connections(id) on delete cascade,
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.storage_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google_drive','onedrive')),
  code_verifier text not null,
  return_url text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index storage_oauth_states_expiry_idx on private.storage_oauth_states(expires_at) where used_at is null;

create table public.cloud_backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_connection_id uuid references public.storage_connections(id) on delete set null,
  provider text not null check (provider in ('google_drive','onedrive')),
  remote_file_id text not null,
  remote_file_name text not null,
  backup_format text not null default 'capitalflow-backup-v2',
  checksum_sha256 text not null check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  bytes bigint not null check (bytes >= 0),
  kind text not null default 'scheduled' check (kind in ('manual','scheduled','pre_restore')),
  status text not null default 'available' check (status in ('available','restored','missing','error')),
  created_at timestamptz not null default now(),
  restored_at timestamptz
);
create index cloud_backups_user_created_idx on public.cloud_backups(user_id, created_at desc);

alter table public.data_imports enable row level security;
alter table public.storage_connections enable row level security;
alter table public.cloud_backups enable row level security;

create policy data_imports_select_own on public.data_imports for select to authenticated using (user_id = auth.uid());
create policy storage_connections_select_own on public.storage_connections for select to authenticated using (user_id = auth.uid());
create policy cloud_backups_select_own on public.cloud_backups for select to authenticated using (user_id = auth.uid());

grant select on public.data_imports, public.storage_connections, public.cloud_backups to authenticated;
revoke insert, update, delete on public.data_imports, public.storage_connections, public.cloud_backups from authenticated;

create trigger set_data_imports_updated_at before update on public.data_imports
for each row execute function public.set_updated_at();
create trigger set_storage_connections_updated_at before update on public.storage_connections
for each row execute function public.set_updated_at();

-- Helper used only by service-role restore. It rewrites owner fields to the authenticated account.
create or replace function private.rebind_backup_owner(p_rows jsonb, p_field text, p_user_id uuid)
returns jsonb
language sql
immutable
security definer
set search_path = pg_catalog, private
as $$
  select coalesce(jsonb_agg(jsonb_set(value, array[p_field], to_jsonb(p_user_id::text), true)), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) value;
$$;
revoke all on function private.rebind_backup_owner(jsonb,text,uuid) from public, anon, authenticated;
grant execute on function private.rebind_backup_owner(jsonb,text,uuid) to service_role;

-- Restore is one database transaction. OAuth tokens, subscription entitlement and source-event history are intentionally excluded.
create or replace function private.restore_user_backup(p_user_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  d jsonb;
  profile_rows jsonb;
  restored_transactions integer := 0;
begin
  if p_payload->>'format' <> 'capitalflow-backup-v2' then
    raise exception 'unsupported_backup_format' using errcode = '22023';
  end if;
  d := p_payload->'data';
  if d is null or jsonb_typeof(d) <> 'object' then
    raise exception 'invalid_backup_payload' using errcode = '22023';
  end if;

  delete from public.goal_contributions where user_id = p_user_id;
  delete from public.investment_transactions where user_id = p_user_id;
  delete from public.investment_valuations where user_id = p_user_id;
  delete from public.categorization_rules where user_id = p_user_id;
  delete from public.account_assignment_rules where user_id = p_user_id;
  delete from public.budget_items where user_id = p_user_id;
  delete from public.goals where user_id = p_user_id;
  delete from public.investments where user_id = p_user_id;
  delete from public.transactions where user_id = p_user_id;
  delete from public.categories where user_id = p_user_id;
  delete from public.accounts where user_id = p_user_id;
  delete from public.financial_preferences where user_id = p_user_id;

  profile_rows := jsonb_build_array(jsonb_set(coalesce(d->'profile', '{}'::jsonb), '{id}', to_jsonb(p_user_id::text), true));
  update public.profiles p set
    full_name = r.full_name,
    base_currency = r.base_currency,
    locale = r.locale,
    timezone = r.timezone,
    onboarding_completed = r.onboarding_completed,
    privacy_version = r.privacy_version,
    privacy_accepted_at = r.privacy_accepted_at,
    enabled_currencies = r.enabled_currencies,
    updated_at = now()
  from jsonb_populate_recordset(null::public.profiles, profile_rows) r
  where p.id = p_user_id;

  insert into public.accounts select * from jsonb_populate_recordset(null::public.accounts, private.rebind_backup_owner(d->'accounts','user_id',p_user_id));
  insert into public.categories select * from jsonb_populate_recordset(null::public.categories, private.rebind_backup_owner(d->'categories','user_id',p_user_id));
  insert into public.transactions select * from jsonb_populate_recordset(null::public.transactions, private.rebind_backup_owner(d->'transactions','user_id',p_user_id));
  get diagnostics restored_transactions = row_count;
  insert into public.goals select * from jsonb_populate_recordset(null::public.goals, private.rebind_backup_owner(d->'goals','user_id',p_user_id));
  insert into public.investments select * from jsonb_populate_recordset(null::public.investments, private.rebind_backup_owner(d->'investments','user_id',p_user_id));
  insert into public.goal_contributions select * from jsonb_populate_recordset(null::public.goal_contributions, private.rebind_backup_owner(d->'goal_contributions','user_id',p_user_id));
  insert into public.investment_transactions select * from jsonb_populate_recordset(null::public.investment_transactions, private.rebind_backup_owner(d->'investment_transactions','user_id',p_user_id));
  insert into public.investment_valuations select * from jsonb_populate_recordset(null::public.investment_valuations, private.rebind_backup_owner(d->'investment_valuations','user_id',p_user_id));
  insert into public.categorization_rules select * from jsonb_populate_recordset(null::public.categorization_rules, private.rebind_backup_owner(d->'categorization_rules','user_id',p_user_id));
  insert into public.account_assignment_rules select * from jsonb_populate_recordset(null::public.account_assignment_rules, private.rebind_backup_owner(d->'account_assignment_rules','user_id',p_user_id));
  insert into public.budget_items select * from jsonb_populate_recordset(null::public.budget_items, private.rebind_backup_owner(d->'budget_items','user_id',p_user_id));
  insert into public.financial_preferences select * from jsonb_populate_recordset(null::public.financial_preferences, private.rebind_backup_owner(d->'financial_preferences','user_id',p_user_id));

  return jsonb_build_object('restored', true, 'transactions', restored_transactions);
end;
$$;
revoke all on function private.restore_user_backup(uuid,jsonb) from public, anon, authenticated;
grant execute on function private.restore_user_backup(uuid,jsonb) to service_role;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

commit;
