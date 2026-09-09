-- V4: private setup intent, trusted inbound source identity, forwarding tests and delivery lineage.
-- All browser access remains through email-relay-settings; these are service-role-only objects.

create table if not exists private.email_relay_setup_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  alias_id uuid not null references private.email_relay_aliases(id) on delete cascade,
  provider text not null check (provider in ('gmail','outlook','proton','other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
alter table private.email_relay_setup_intents enable row level security;
create index if not exists email_relay_setup_intents_owner_idx on private.email_relay_setup_intents(user_id,expires_at desc);
revoke all on table private.email_relay_setup_intents from public,anon,authenticated;
grant select,insert,update,delete on private.email_relay_setup_intents to service_role;

create table if not exists private.email_relay_link_tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  alias_id uuid not null references private.email_relay_aliases(id) on delete cascade,
  source_id uuid references private.email_relay_sources(id) on delete set null,
  provider text not null check (provider in ('gmail','outlook','proton','other')),
  challenge_hash text not null unique check (challenge_hash ~ '^[A-Za-z0-9_-]{43}$'),
  status text not null default 'pending' check (status in ('pending','received','expired','dismissed')),
  expires_at timestamptz not null,
  received_at timestamptz,
  delivery_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.email_relay_link_tests enable row level security;
create index if not exists email_relay_link_tests_owner_idx on private.email_relay_link_tests(user_id,status,expires_at desc);
revoke all on table private.email_relay_link_tests from public,anon,authenticated;
grant select,insert,update,delete on private.email_relay_link_tests to service_role;

create table if not exists private.email_relay_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  alias_id uuid not null references private.email_relay_aliases(id) on delete cascade,
  source_id uuid references private.email_relay_sources(id) on delete set null,
  provider_hint text not null check (provider_hint in ('gmail','outlook','proton','other')),
  provider_evidence text not null check (provider_evidence in ('strong','moderate','weak','unknown')),
  raw_sha256 text not null check (raw_sha256 ~ '^[a-f0-9]{64}$'),
  message_id_hash text,
  delivery_kind text not null check (delivery_kind in ('verification','link_test','financial','non_financial','inactive')),
  processing_result text not null,
  canonical_source_event_id uuid references public.source_events(id) on delete set null,
  received_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table private.email_relay_deliveries enable row level security;
create unique index if not exists email_relay_deliveries_retry_uidx on private.email_relay_deliveries(alias_id,raw_sha256,provider_hint);
create index if not exists email_relay_deliveries_source_idx on private.email_relay_deliveries(source_id,received_at desc);
revoke all on table private.email_relay_deliveries from public,anon,authenticated;
grant select,insert,update,delete on private.email_relay_deliveries to service_role;

alter table private.email_relay_sources
  add column if not exists source_email text,
  add column if not exists last_delivery_at timestamptz,
  add column if not exists last_link_test_at timestamptz,
  add column if not exists last_error_code text;
alter table private.email_relay_sources drop constraint if exists email_relay_sources_source_email_format;
alter table private.email_relay_sources add constraint email_relay_sources_source_email_format
  check (source_email is null or (char_length(source_email)<=320 and source_email=lower(btrim(source_email)) and source_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));
drop index if exists private.email_relay_sources_active_label_uidx;
create unique index if not exists email_relay_sources_one_provider_uidx on private.email_relay_sources(alias_id,provider) where revoked_at is null;

drop function if exists public.service_match_email_relay_source(uuid,text);
drop function if exists public.service_list_email_relay_sources(uuid);
create function public.service_list_email_relay_sources(p_user_id uuid)
returns table(source_id uuid,alias_id uuid,provider text,label text,source_email text,status text,last_received_at timestamptz,last_financial_event_at timestamptz,last_delivery_at timestamptz,last_link_test_at timestamptz,created_at timestamptz,updated_at timestamptz)
language sql stable security invoker set search_path='' as $$
  select s.id,s.alias_id,s.provider,s.label,s.source_email,s.status,s.last_received_at,s.last_financial_event_at,s.last_delivery_at,s.last_link_test_at,s.created_at,s.updated_at
  from private.email_relay_sources s join private.email_relay_aliases a on a.id=s.alias_id and a.user_id=s.user_id
  where s.user_id=p_user_id and s.revoked_at is null and a.revoked_at is null order by s.created_at,s.id
$$;
revoke all on function public.service_list_email_relay_sources(uuid) from public,anon,authenticated;
grant execute on function public.service_list_email_relay_sources(uuid) to service_role;

create or replace function public.service_create_email_relay_setup_intent(p_user_id uuid,p_provider text)
returns table(setup_intent_id uuid,provider text,expires_at timestamptz)
language plpgsql security invoker set search_path='' as $$$
declare v_alias uuid; v_id uuid; v_expires timestamptz := now()+interval '24 hours';
begin
  if p_provider not in ('gmail','outlook','proton','other') then raise exception 'invalid_email_relay_source_provider' using errcode='22023'; end if;
  select id into v_alias from private.email_relay_aliases where user_id=p_user_id and revoked_at is null order by created_at desc limit 1;
  if v_alias is null then raise exception 'email_relay_alias_required' using errcode='P0001'; end if;
  delete from private.email_relay_setup_intents where expires_at < now();
  insert into private.email_relay_setup_intents(user_id,alias_id,provider,expires_at) values(p_user_id,v_alias,p_provider,v_expires) returning id into v_id;
  return query select v_id,p_provider,v_expires;
end $$;

create or replace function public.service_match_email_relay_source(p_alias_id uuid,p_provider text,p_source_email text default null)
returns table(source_id uuid,match_status text)
language plpgsql stable security invoker set search_path='' as $$$
declare v_count integer; v_source uuid; v_email text:=nullif(lower(btrim(p_source_email)), '');
begin
  if p_provider not in ('gmail','outlook','proton','other') then return query select null::uuid,'invalid_provider'::text; return; end if;
  if v_email is not null then
    select id into v_source from private.email_relay_sources where alias_id=p_alias_id and provider=p_provider and source_email=v_email and revoked_at is null limit 1;
    if v_source is not null then return query select v_source,'matched'::text; return; end if;
  end if;
  select count(*) into v_count from private.email_relay_sources where alias_id=p_alias_id and provider=p_provider and revoked_at is null;
  if v_count=1 then select id into v_source from private.email_relay_sources where alias_id=p_alias_id and provider=p_provider and revoked_at is null limit 1; return query select v_source,'matched_unambiguous'::text;
  elsif v_count>1 then return query select null::uuid,'ambiguous'::text;
  else return query select null::uuid,'unconfigured'::text; end if;
end $$;

create or replace function public.service_upsert_email_relay_source_from_inbound(p_user_id uuid,p_alias_id uuid,p_provider text,p_source_email text)
returns table(source_id uuid,match_status text)
language plpgsql security invoker set search_path='' as $$$
declare v_email text:=nullif(lower(btrim(p_source_email)), ''); v_source uuid; v_count integer;
begin
  if p_provider not in ('gmail','outlook','proton','other') then raise exception 'invalid_email_relay_source_provider' using errcode='22023'; end if;
  if v_email is not null and (char_length(v_email)>320 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'invalid_email_relay_source_email' using errcode='22023'; end if;
  if v_email is not null then
    select id into v_source from private.email_relay_sources where alias_id=p_alias_id and provider=p_provider and source_email=v_email and revoked_at is null;
    if v_source is not null then update private.email_relay_sources set last_delivery_at=now(),updated_at=now() where id=v_source; return query select v_source,'matched'::text; return; end if;
  end if;
  select count(*) into v_count from private.email_relay_sources where alias_id=p_alias_id and provider=p_provider and revoked_at is null;
  if v_count=0 then
    insert into private.email_relay_sources(alias_id,user_id,provider,label,status,source_email,last_delivery_at) values(p_alias_id,p_user_id,p_provider,coalesce(v_email,initcap(p_provider)),'pending',v_email,now()) returning id into v_source;
    return query select v_source,'created_from_authenticated_inbound'::text; return;
  end if;
  if v_count=1 then
    select id into v_source from private.email_relay_sources where alias_id=p_alias_id and provider=p_provider and revoked_at is null;
    update private.email_relay_sources set source_email=coalesce(source_email,v_email),last_delivery_at=now(),updated_at=now() where id=v_source;
    return query select v_source,'matched_unambiguous'::text; return;
  end if;
  return query select null::uuid,'ambiguous'::text;
end $$;

create or replace function public.service_create_email_relay_forwarding_verification(p_user_id uuid,p_alias_id uuid,p_source_id uuid,p_source_event_id uuid,p_provider text,p_sender text,p_subject text,p_excerpt text,p_url text,p_code text,p_received_at timestamptz)
returns uuid language plpgsql security invoker set search_path='' as $$$
declare v_id uuid;
begin
  if p_provider not in ('gmail','outlook','proton','other') then raise exception 'invalid_verification_provider' using errcode='22023'; end if;
  if p_url is not null and (char_length(p_url)>2048 or p_url !~ '^https://') then raise exception 'invalid_verification_url' using errcode='22023'; end if;
  if p_code is not null and (char_length(p_code)<6 or char_length(p_code)>32) then raise exception 'invalid_verification_code' using errcode='22023'; end if;
  select id into v_id from private.email_relay_forwarding_verifications where source_event_id=p_source_event_id;
  if v_id is not null then update private.email_relay_forwarding_verifications set updated_at=now() where id=v_id; return v_id; end if;
  update private.email_relay_forwarding_verifications set status='dismissed',dismissed_at=now(),verification_url=null,verification_code=null,message_excerpt=null,updated_at=now()
    where user_id=p_user_id and alias_id=p_alias_id and provider=p_provider and coalesce(source_id,'00000000-0000-0000-0000-000000000000')=coalesce(p_source_id,'00000000-0000-0000-0000-000000000000') and status in ('pending','opened');
  insert into private.email_relay_forwarding_verifications(user_id,alias_id,source_id,source_event_id,provider,sender_sanitized,subject_sanitized,message_excerpt,verification_url,verification_code,received_at,expires_at)
    values(p_user_id,p_alias_id,p_source_id,p_source_event_id,p_provider,left(p_sender,320),left(p_subject,998),left(p_excerpt,1000),p_url,p_code,p_received_at,now()+interval '7 days') returning id into v_id;
  return v_id;
end $$;

create or replace function public.service_purge_email_relay_v4()
returns void language plpgsql security invoker set search_path='' as $$$
begin
  update private.email_relay_forwarding_verifications set status='expired',verification_url=null,verification_code=null,message_excerpt=null,updated_at=now() where status in ('pending','opened') and expires_at<=now();
  update private.email_relay_link_tests set status='expired',updated_at=now() where status='pending' and expires_at<=now();
  delete from private.email_relay_setup_intents where expires_at<=now();
  delete from private.email_relay_replays where expires_at<=now();
  delete from private.email_relay_deliveries where received_at < now()-interval '30 days';
end $$;

create or replace function public.service_create_email_relay_link_test(p_user_id uuid,p_source_id uuid,p_challenge_hash text)
returns table(link_test_id uuid,expires_at timestamptz)
language plpgsql security invoker set search_path='' as $$$
declare v_alias uuid; v_provider text; v_id uuid; v_expires timestamptz:=now()+interval '30 minutes';
begin
  if p_challenge_hash !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'invalid_link_test_hash' using errcode='22023'; end if;
  select alias_id,provider into v_alias,v_provider from private.email_relay_sources where id=p_source_id and user_id=p_user_id and revoked_at is null;
  if v_alias is null then raise exception 'email_relay_source_not_found' using errcode='P0001'; end if;
  update private.email_relay_link_tests set status='dismissed',updated_at=now() where source_id=p_source_id and status='pending';
  insert into private.email_relay_link_tests(user_id,alias_id,source_id,provider,challenge_hash,expires_at) values(p_user_id,v_alias,p_source_id,v_provider,p_challenge_hash,v_expires) returning id into v_id;
  return query select v_id,v_expires;
end $$;

create or replace function public.service_complete_email_relay_link_test(p_alias_id uuid,p_provider text,p_challenge_hash text)
returns uuid language plpgsql security invoker set search_path='' as $$$
declare v_source uuid; v_test uuid;
begin
  update private.email_relay_link_tests set status='received',received_at=now(),updated_at=now() where alias_id=p_alias_id and provider=p_provider and challenge_hash=p_challenge_hash and status='pending' and expires_at>now() returning id,source_id into v_test,v_source;
  if v_test is null or v_source is null then return null; end if;
  update private.email_relay_sources set status='active',last_delivery_at=now(),last_link_test_at=now(),updated_at=now() where id=v_source and revoked_at is null;
  update private.email_relay_aliases set status='active',last_received_at=now(),updated_at=now() where id=p_alias_id and revoked_at is null;
  update public.source_connections set status='active',last_sync_at=now(),updated_at=now() where id=(select connection_id from private.email_relay_aliases where id=p_alias_id);
  update private.email_relay_forwarding_verifications set status='resolved',resolved_at=now(),verification_url=null,verification_code=null,message_excerpt=null,updated_at=now() where source_id=v_source and status in ('pending','opened');
  return v_test;
end $$;

revoke all on function public.service_create_email_relay_setup_intent(uuid,text),public.service_match_email_relay_source(uuid,text,text),public.service_upsert_email_relay_source_from_inbound(uuid,uuid,text,text),public.service_create_email_relay_forwarding_verification(uuid,uuid,uuid,uuid,text,text,text,text,text,text,timestamptz),public.service_purge_email_relay_v4(),public.service_create_email_relay_link_test(uuid,uuid,text),public.service_complete_email_relay_link_test(uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_create_email_relay_setup_intent(uuid,text),public.service_match_email_relay_source(uuid,text,text),public.service_upsert_email_relay_source_from_inbound(uuid,uuid,text,text),public.service_create_email_relay_forwarding_verification(uuid,uuid,uuid,uuid,text,text,text,text,text,text,timestamptz),public.service_purge_email_relay_v4(),public.service_create_email_relay_link_test(uuid,uuid,text),public.service_complete_email_relay_link_test(uuid,text,text) to service_role;
