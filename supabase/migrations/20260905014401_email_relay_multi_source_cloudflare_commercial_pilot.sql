-- CapitalFlow Phase 1 v2: one private relay alias per user, many mail sources.
-- Gmail, Outlook, Proton and other providers all feed the same Cloudflare Worker,
-- HMAC gateway, Source Event lineage, multilingual parser and candidate pipeline.

create table if not exists private.email_relay_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.source_connections(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[A-Za-z0-9_-]{43}$'),
  alias_hint text not null check (char_length(alias_hint) between 4 and 32),
  status text not null default 'pending' check (status in ('pending','active','error','revoked')),
  last_received_at timestamptz,
  last_financial_event_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,user_id)
);
create unique index if not exists email_relay_aliases_one_current_user_uidx
  on private.email_relay_aliases(user_id) where revoked_at is null;
create index if not exists email_relay_aliases_connection_idx on private.email_relay_aliases(connection_id);

create table if not exists private.email_relay_sources (
  id uuid primary key default gen_random_uuid(),
  alias_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gmail','outlook','proton','other')),
  label text not null check (char_length(label) between 1 and 80),
  status text not null default 'pending' check (status in ('pending','active','error','revoked')),
  gmail_confirmation_url text,
  gmail_confirmation_code text,
  verification_detected_at timestamptz,
  last_received_at timestamptz,
  last_financial_event_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_relay_sources_alias_user_fk foreign key(alias_id,user_id)
    references private.email_relay_aliases(id,user_id) on delete cascade
);
create index if not exists email_relay_sources_alias_idx on private.email_relay_sources(alias_id);
create index if not exists email_relay_sources_user_idx on private.email_relay_sources(user_id);
create unique index if not exists email_relay_sources_active_label_uidx
  on private.email_relay_sources(alias_id,provider,lower(label)) where revoked_at is null;

create table if not exists private.email_relay_replays (
  nonce_hash text primary key check (nonce_hash ~ '^[A-Za-z0-9_-]{43}$'),
  received_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists email_relay_replays_expiry_idx on private.email_relay_replays(expires_at);

create table if not exists private.email_relay_rate_limits (
  alias_id uuid not null references private.email_relay_aliases(id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key(alias_id, window_start)
);

create table if not exists private.financial_sender_catalog (
  id text primary key,
  display_name text not null,
  sender_domains text[] not null default '{}',
  country_code text,
  enabled boolean not null default true,
  sort_order integer not null default 100,
  updated_at timestamptz not null default now()
);

alter table private.email_relay_aliases enable row level security;
alter table private.email_relay_sources enable row level security;
alter table private.email_relay_replays enable row level security;
alter table private.email_relay_rate_limits enable row level security;
alter table private.financial_sender_catalog enable row level security;

insert into private.financial_sender_catalog(id,display_name,sender_domains,country_code,sort_order) values
 ('bancolombia','Bancolombia',array['bancolombia.com'],'CO',10),
 ('nequi','Nequi',array['nequi.com.co'],'CO',20),
 ('davivienda','Davivienda',array['davivienda.com'],'CO',30),
 ('daviplata','DaviPlata',array['daviplata.com'],'CO',40),
 ('nu-colombia','Nu Colombia',array['nu.com.co'],'CO',50),
 ('banco-bogota','Banco de Bogota',array['bancodebogota.com'],'CO',60),
 ('bbva-colombia','BBVA Colombia',array['bbva.com.co'],'CO',70)
on conflict (id) do update set
 display_name=excluded.display_name, sender_domains=excluded.sender_domains,
 country_code=excluded.country_code, sort_order=excluded.sort_order, enabled=true, updated_at=now();

-- Preserve the Google-only OAuth connector architecture. Outlook/Proton are relay
-- source labels only; they are not reintroduced as public data-plane providers.
alter table public.source_connections drop constraint if exists source_connections_provider_check;
alter table public.source_connections add constraint source_connections_provider_check
  check (provider in ('gmail','email_relay'));

alter table public.source_events drop constraint if exists source_events_provider_check;
alter table public.source_events add constraint source_events_provider_check
  check (provider in ('android_notification','gmail','email_relay'));

alter table public.transaction_candidates drop constraint if exists transaction_candidates_provider_check;
alter table public.transaction_candidates add constraint transaction_candidates_provider_check
  check (provider in ('android_notification','gmail','email_relay'));

alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions add constraint transactions_source_check
  check (source in ('manual','android_notification','gmail','system','import_file','email_relay'));

alter table public.source_events
  add column if not exists recipient_alias_id uuid references private.email_relay_aliases(id) on delete set null,
  add column if not exists recipient_source_id uuid references private.email_relay_sources(id) on delete set null,
  add column if not exists forwarding_provider_hint text,
  add column if not exists message_id text,
  add column if not exists received_at timestamptz,
  add column if not exists raw_sha256 text,
  add column if not exists parser_version text,
  add column if not exists parser_rule_version text,
  add column if not exists detected_amount_minor bigint,
  add column if not exists detected_currency text,
  add column if not exists detected_direction text,
  add column if not exists detected_merchant text,
  add column if not exists detected_reference text,
  add column if not exists detected_confidence numeric(6,5),
  add column if not exists candidate_id uuid references public.transaction_candidates(id) on delete set null,
  add column if not exists transaction_id uuid references public.transactions(id) on delete set null;

alter table public.source_events drop constraint if exists source_events_email_relay_raw_sha256_check;
alter table public.source_events add constraint source_events_email_relay_raw_sha256_check
  check (raw_sha256 is null or raw_sha256 ~ '^[a-f0-9]{64}$');
alter table public.source_events drop constraint if exists source_events_email_relay_message_id_length_check;
alter table public.source_events add constraint source_events_email_relay_message_id_length_check
  check (message_id is null or char_length(message_id) <= 998);
alter table public.source_events drop constraint if exists source_events_email_relay_forwarding_provider_check;
alter table public.source_events add constraint source_events_email_relay_forwarding_provider_check
  check (forwarding_provider_hint is null or forwarding_provider_hint in ('gmail','outlook','proton','other'));
alter table public.source_events drop constraint if exists source_events_email_relay_detected_currency_check;
alter table public.source_events add constraint source_events_email_relay_detected_currency_check
  check (detected_currency is null or detected_currency ~ '^[A-Z]{3}$');
alter table public.source_events drop constraint if exists source_events_email_relay_detected_direction_check;
alter table public.source_events add constraint source_events_email_relay_detected_direction_check
  check (detected_direction is null or detected_direction in ('income','expense'));
alter table public.source_events drop constraint if exists source_events_email_relay_detected_confidence_check;
alter table public.source_events add constraint source_events_email_relay_detected_confidence_check
  check (detected_confidence is null or (detected_confidence >= 0 and detected_confidence <= 1));

-- Dedup is intentionally primary-alias scoped, not source scoped. The same bank
-- movement forwarded through Gmail and Outlook must not become two events.
create unique index if not exists source_events_email_relay_message_uidx
  on public.source_events(user_id,recipient_alias_id,message_id)
  where provider='email_relay' and recipient_alias_id is not null and message_id is not null;
create unique index if not exists source_events_email_relay_raw_uidx
  on public.source_events(user_id,recipient_alias_id,raw_sha256)
  where provider='email_relay' and recipient_alias_id is not null and raw_sha256 is not null;

create or replace function public.service_create_or_rotate_email_relay_alias(
  p_user_id uuid, p_token_hash text, p_alias_hint text
) returns table(alias_id uuid, connection_id uuid, status text)
language plpgsql security invoker set search_path=''
as $$
declare v_connection uuid; v_alias uuid;
begin
  insert into public.source_connections(user_id,provider,status)
    values (p_user_id,'email_relay','pending')
  on conflict (user_id,provider) do update set status='pending', last_error=null, updated_at=now()
  returning id into v_connection;
  update private.email_relay_sources s set status='revoked',revoked_at=coalesce(s.revoked_at,now()),updated_at=now()
    where s.user_id=p_user_id and s.revoked_at is null;
  update private.email_relay_aliases a set status='revoked', revoked_at=coalesce(a.revoked_at,now()), updated_at=now()
    where a.user_id=p_user_id and a.revoked_at is null;
  insert into private.email_relay_aliases(user_id,connection_id,token_hash,alias_hint,status)
    values (p_user_id,v_connection,p_token_hash,p_alias_hint,'pending') returning id into v_alias;
  return query select v_alias,v_connection,'pending'::text;
end $$;

create or replace function public.service_get_email_relay_state(p_user_id uuid)
returns table(alias_id uuid,connection_id uuid,status text,alias_hint text,last_received_at timestamptz,
  last_financial_event_at timestamptz,created_at timestamptz,updated_at timestamptz)
language sql stable security invoker set search_path=''
as $$
  select a.id,a.connection_id,a.status,a.alias_hint,a.last_received_at,a.last_financial_event_at,a.created_at,a.updated_at
  from private.email_relay_aliases a where a.user_id=p_user_id and a.revoked_at is null
  order by a.created_at desc limit 1
$$;

create or replace function public.service_create_email_relay_source(p_user_id uuid,p_provider text,p_label text)
returns table(source_id uuid,provider text,label text,status text)
language plpgsql security invoker set search_path=''
as $$
declare v_alias uuid; v_label text; v_source uuid;
begin
  if p_provider not in ('gmail','outlook','proton','other') then raise exception 'invalid_email_relay_source_provider' using errcode='22023'; end if;
  v_label=btrim(coalesce(p_label,''));
  if char_length(v_label)<1 or char_length(v_label)>80 then raise exception 'invalid_email_relay_source_label' using errcode='22023'; end if;
  select a.id into v_alias from private.email_relay_aliases a where a.user_id=p_user_id and a.revoked_at is null order by a.created_at desc limit 1;
  if v_alias is null then raise exception 'email_relay_alias_required' using errcode='P0001'; end if;
  select s.id into v_source from private.email_relay_sources s
    where s.alias_id=v_alias and s.provider=p_provider and lower(s.label)=lower(v_label) and s.revoked_at is null limit 1;
  if v_source is null then
    insert into private.email_relay_sources(alias_id,user_id,provider,label,status)
      values(v_alias,p_user_id,p_provider,v_label,'pending') returning id into v_source;
  end if;
  return query select s.id,s.provider,s.label,s.status from private.email_relay_sources s where s.id=v_source;
end $$;

create or replace function public.service_list_email_relay_sources(p_user_id uuid)
returns table(source_id uuid,alias_id uuid,provider text,label text,status text,gmail_confirmation_url text,
  gmail_confirmation_code text,verification_detected_at timestamptz,last_received_at timestamptz,
  last_financial_event_at timestamptz,created_at timestamptz,updated_at timestamptz)
language sql stable security invoker set search_path=''
as $$
  select s.id,s.alias_id,s.provider,s.label,s.status,s.gmail_confirmation_url,s.gmail_confirmation_code,
    s.verification_detected_at,s.last_received_at,s.last_financial_event_at,s.created_at,s.updated_at
  from private.email_relay_sources s
  join private.email_relay_aliases a on a.id=s.alias_id and a.user_id=s.user_id
  where s.user_id=p_user_id and s.revoked_at is null and a.revoked_at is null
  order by s.created_at,s.id
$$;

create or replace function public.service_resolve_email_relay_alias(p_token_hash text)
returns table(alias_id uuid,user_id uuid,connection_id uuid,status text)
language sql stable security invoker set search_path=''
as $$
  select a.id,a.user_id,a.connection_id,a.status
  from private.email_relay_aliases a where a.token_hash=p_token_hash and a.revoked_at is null and a.status <> 'revoked' limit 1
$$;

create or replace function public.service_match_email_relay_source(p_alias_id uuid,p_provider text)
returns table(source_id uuid,match_status text)
language plpgsql stable security invoker set search_path=''
as $$
declare v_count integer; v_revoked integer; v_source uuid;
begin
  if p_provider not in ('gmail','outlook','proton','other') then
    return query select null::uuid,'invalid_provider'::text; return;
  end if;
  select count(*) into v_count from private.email_relay_sources s
    where s.alias_id=p_alias_id and s.provider=p_provider and s.revoked_at is null and s.status <> 'revoked';
  if v_count=1 then
    select s.id into v_source from private.email_relay_sources s
      where s.alias_id=p_alias_id and s.provider=p_provider and s.revoked_at is null and s.status <> 'revoked' limit 1;
    return query select v_source,'matched'::text;
    return;
  elsif v_count>1 then
    return query select null::uuid,'ambiguous'::text;
    return;
  end if;
  select count(*) into v_revoked from private.email_relay_sources s
    where s.alias_id=p_alias_id and s.provider=p_provider and (s.revoked_at is not null or s.status='revoked');
  if v_revoked>0 then
    return query select null::uuid,'revoked'::text;
  else
    return query select null::uuid,'unconfigured'::text;
  end if;
end $$;

create or replace function public.service_revoke_email_relay_source(p_user_id uuid,p_source_id uuid)
returns boolean language plpgsql security invoker set search_path=''
as $$
declare n integer;
begin
  update private.email_relay_sources s set status='revoked',revoked_at=coalesce(s.revoked_at,now()),updated_at=now()
    where s.id=p_source_id and s.user_id=p_user_id and s.revoked_at is null;
  get diagnostics n=row_count;
  return n=1;
end $$;

create or replace function public.service_revoke_email_relay_alias(p_user_id uuid)
returns boolean language plpgsql security invoker set search_path=''
as $$
declare n integer;
begin
  update private.email_relay_sources s set status='revoked',revoked_at=coalesce(s.revoked_at,now()),updated_at=now()
    where s.user_id=p_user_id and s.revoked_at is null;
  update private.email_relay_aliases a set status='revoked',revoked_at=coalesce(a.revoked_at,now()),updated_at=now()
    where a.user_id=p_user_id and a.revoked_at is null;
  get diagnostics n=row_count;
  update public.source_connections set status='revoked',updated_at=now() where user_id=p_user_id and provider='email_relay';
  return n>0;
end $$;

create or replace function public.service_claim_email_relay_replay(p_nonce_hash text,p_expires_at timestamptz)
returns boolean language plpgsql security invoker set search_path=''
as $$
declare inserted integer;
begin
  delete from private.email_relay_replays where expires_at < now();
  insert into private.email_relay_replays(nonce_hash,expires_at) values (p_nonce_hash,p_expires_at)
    on conflict do nothing;
  get diagnostics inserted=row_count;
  return inserted=1;
end $$;

create or replace function public.service_take_email_relay_rate_limit(p_alias_id uuid,p_limit integer,p_window_seconds integer)
returns boolean language plpgsql security invoker set search_path=''
as $$
declare bucket timestamptz; n integer;
begin
  if p_limit < 1 or p_limit > 1000 or p_window_seconds < 10 or p_window_seconds > 86400 then
    raise exception 'invalid_rate_limit' using errcode='22023';
  end if;
  bucket=to_timestamp(floor(extract(epoch from now())/p_window_seconds)*p_window_seconds);
  insert into private.email_relay_rate_limits(alias_id,window_start,request_count) values (p_alias_id,bucket,1)
    on conflict(alias_id,window_start) do update set request_count=private.email_relay_rate_limits.request_count+1
    returning request_count into n;
  delete from private.email_relay_rate_limits where window_start < now()-interval '2 days';
  return n<=p_limit;
end $$;

create or replace function public.service_update_email_relay_state(
  p_alias_id uuid,p_source_id uuid,p_provider_hint text,p_status text,p_financial boolean default false,
  p_gmail_url text default null,p_gmail_code text default null
) returns boolean language plpgsql security invoker set search_path=''
as $$
declare v_connection uuid; v_source uuid; v_count integer; n integer; v_alias_status text;
begin
  if p_status not in ('pending','active','error','revoked') then raise exception 'invalid_relay_status' using errcode='22023'; end if;
  update private.email_relay_aliases a set
    status=case when a.status='active' and p_status in ('pending','error') then 'active' else p_status end,last_received_at=now(),
    last_financial_event_at=case when p_financial then now() else a.last_financial_event_at end,
    updated_at=now()
  where a.id=p_alias_id and a.revoked_at is null returning a.connection_id,a.status into v_connection,v_alias_status;
  get diagnostics n=row_count;
  if n<>1 then return false; end if;

  v_source=p_source_id;
  if v_source is null and p_provider_hint in ('gmail','outlook','proton','other') then
    select count(*) into v_count from private.email_relay_sources s
      where s.alias_id=p_alias_id and s.provider=p_provider_hint and s.revoked_at is null and s.status <> 'revoked';
    if v_count=1 then
      select s.id into v_source from private.email_relay_sources s
        where s.alias_id=p_alias_id and s.provider=p_provider_hint and s.revoked_at is null and s.status <> 'revoked' limit 1;
    end if;
  end if;
  if v_source is not null then
    update private.email_relay_sources s set
      status=p_status,last_received_at=now(),
      last_financial_event_at=case when p_financial then now() else s.last_financial_event_at end,
      gmail_confirmation_url=case when s.provider='gmail' then coalesce(p_gmail_url,s.gmail_confirmation_url) else s.gmail_confirmation_url end,
      gmail_confirmation_code=case when s.provider='gmail' then coalesce(p_gmail_code,s.gmail_confirmation_code) else s.gmail_confirmation_code end,
      verification_detected_at=case when s.provider='gmail' and (p_gmail_url is not null or p_gmail_code is not null) then now() else s.verification_detected_at end,
      updated_at=now()
    where s.id=v_source and s.alias_id=p_alias_id and s.revoked_at is null;
  end if;
  update public.source_connections set status=v_alias_status,last_sync_at=now(),last_error=null,updated_at=now() where id=v_connection;
  return true;
end $$;

create or replace function public.service_list_financial_sender_catalog()
returns table(id text,display_name text,sender_domains text[],country_code text,sort_order integer)
language sql stable security invoker set search_path=''
as $$ select c.id,c.display_name,c.sender_domains,c.country_code,c.sort_order from private.financial_sender_catalog c where c.enabled order by c.sort_order,c.display_name $$;

revoke all on function public.service_create_or_rotate_email_relay_alias(uuid,text,text) from public,anon,authenticated;
revoke all on function public.service_get_email_relay_state(uuid) from public,anon,authenticated;
revoke all on function public.service_create_email_relay_source(uuid,text,text) from public,anon,authenticated;
revoke all on function public.service_list_email_relay_sources(uuid) from public,anon,authenticated;
revoke all on function public.service_resolve_email_relay_alias(text) from public,anon,authenticated;
revoke all on function public.service_match_email_relay_source(uuid,text) from public,anon,authenticated;
revoke all on function public.service_revoke_email_relay_source(uuid,uuid) from public,anon,authenticated;
revoke all on function public.service_revoke_email_relay_alias(uuid) from public,anon,authenticated;
revoke all on function public.service_claim_email_relay_replay(text,timestamptz) from public,anon,authenticated;
revoke all on function public.service_take_email_relay_rate_limit(uuid,integer,integer) from public,anon,authenticated;
revoke all on function public.service_update_email_relay_state(uuid,uuid,text,text,boolean,text,text) from public,anon,authenticated;
revoke all on function public.service_list_financial_sender_catalog() from public,anon,authenticated;

grant execute on function public.service_create_or_rotate_email_relay_alias(uuid,text,text) to service_role;
grant execute on function public.service_get_email_relay_state(uuid) to service_role;
grant execute on function public.service_create_email_relay_source(uuid,text,text) to service_role;
grant execute on function public.service_list_email_relay_sources(uuid) to service_role;
grant execute on function public.service_resolve_email_relay_alias(text) to service_role;
grant execute on function public.service_match_email_relay_source(uuid,text) to service_role;
grant execute on function public.service_revoke_email_relay_source(uuid,uuid) to service_role;
grant execute on function public.service_revoke_email_relay_alias(uuid) to service_role;
grant execute on function public.service_claim_email_relay_replay(text,timestamptz) to service_role;
grant execute on function public.service_take_email_relay_rate_limit(uuid,integer,integer) to service_role;
grant execute on function public.service_update_email_relay_state(uuid,uuid,text,text,boolean,text,text) to service_role;
grant execute on function public.service_list_financial_sender_catalog() to service_role;

revoke all on table private.email_relay_aliases,private.email_relay_sources,private.email_relay_replays,private.email_relay_rate_limits,private.financial_sender_catalog from public,anon,authenticated;
grant usage on schema private to service_role;
grant select,insert,update,delete on table private.email_relay_aliases,private.email_relay_sources,private.email_relay_replays,private.email_relay_rate_limits to service_role;
grant select on table private.financial_sender_catalog to service_role;
