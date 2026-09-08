-- Temporary, service-only inbox for forwarding confirmations. Existing Gmail fields remain for compatibility.
create table private.email_relay_forwarding_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  alias_id uuid not null references private.email_relay_aliases(id) on delete cascade,
  source_id uuid references private.email_relay_sources(id) on delete set null,
  source_event_id uuid not null references public.source_events(id) on delete cascade,
  provider text not null check (provider in ('gmail','outlook','proton','other')),
  status text not null default 'pending' check (status in ('pending','opened','resolved','dismissed','expired')),
  sender_sanitized text check (sender_sanitized is null or char_length(sender_sanitized)<=320),
  subject_sanitized text check (subject_sanitized is null or char_length(subject_sanitized)<=998),
  message_excerpt text check (message_excerpt is null or char_length(message_excerpt)<=1000),
  verification_url text check (verification_url is null or char_length(verification_url)<=2048),
  verification_code text check (verification_code is null or char_length(verification_code)<=64),
  received_at timestamptz not null,
  expires_at timestamptz not null,
  opened_at timestamptz,
  resolved_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_event_id),
  check (status in ('resolved','dismissed','expired') or verification_url is not null or verification_code is not null or message_excerpt is not null)
);
alter table private.email_relay_forwarding_verifications enable row level security;
create index email_relay_verifications_user_status_received_idx on private.email_relay_forwarding_verifications(user_id,status,received_at desc);
create index email_relay_verifications_expiry_idx on private.email_relay_forwarding_verifications(expires_at);
revoke all on table private.email_relay_forwarding_verifications from public,anon,authenticated;
grant usage on schema private to service_role;
grant select,insert,update,delete on private.email_relay_forwarding_verifications to service_role;

create or replace function public.service_purge_email_relay_verifications()
returns void language sql security invoker set search_path='' as $$
  update private.email_relay_forwarding_verifications
  set status='expired', verification_url=null, verification_code=null, message_excerpt=null, updated_at=now()
  where status in ('pending','opened') and expires_at <= now();
$$;

create or replace function public.service_create_email_relay_forwarding_verification(
  p_user_id uuid,p_alias_id uuid,p_source_id uuid,p_source_event_id uuid,p_provider text,
  p_sender text,p_subject text,p_excerpt text,p_url text,p_code text,p_received_at timestamptz
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  if p_provider not in ('gmail','outlook','proton','other') then raise exception 'invalid_verification_provider' using errcode='22023'; end if;
  if p_url is not null and (p_url !~ '^https://' or char_length(p_url)>2048) then raise exception 'invalid_verification_url' using errcode='22023'; end if;
  if p_code is not null and (p_code !~ '^[A-Za-z0-9-]{1,64}$') then raise exception 'invalid_verification_code' using errcode='22023'; end if;
  perform public.service_purge_email_relay_verifications();
  insert into private.email_relay_forwarding_verifications(user_id,alias_id,source_id,source_event_id,provider,sender_sanitized,subject_sanitized,message_excerpt,verification_url,verification_code,received_at,expires_at)
  select p_user_id,p_alias_id,p_source_id,p_source_event_id,p_provider,left(p_sender,320),left(p_subject,998),left(p_excerpt,1000),p_url,p_code,p_received_at,now()+interval '7 days'
  where exists(select 1 from private.email_relay_aliases a where a.id=p_alias_id and a.user_id=p_user_id and a.revoked_at is null)
  on conflict(source_event_id) do update set updated_at=now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.service_update_email_relay_forwarding_verification(p_user_id uuid,p_verification_id uuid,p_action text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
  if p_action not in ('opened','resolved','dismissed') then raise exception 'invalid_verification_action' using errcode='22023'; end if;
  update private.email_relay_forwarding_verifications set status=p_action,
    opened_at=case when p_action='opened' then now() else opened_at end,
    resolved_at=case when p_action='resolved' then now() else resolved_at end,
    dismissed_at=case when p_action='dismissed' then now() else dismissed_at end,
    verification_url=case when p_action in ('resolved','dismissed') then null else verification_url end,
    verification_code=case when p_action in ('resolved','dismissed') then null else verification_code end,
    message_excerpt=case when p_action in ('resolved','dismissed') then null else message_excerpt end,updated_at=now()
  where id=p_verification_id and user_id=p_user_id and status in ('pending','opened');
  get diagnostics n=row_count; return n=1;
end $$;

-- Alias rotation/revocation invalidates pending secrets for old aliases.
create or replace function public.service_invalidate_email_relay_verifications(p_alias_id uuid)
returns void language sql security invoker set search_path='' as $$
  update private.email_relay_forwarding_verifications set status='dismissed',dismissed_at=coalesce(dismissed_at,now()),verification_url=null,verification_code=null,message_excerpt=null,updated_at=now()
  where alias_id=p_alias_id and status in ('pending','opened');
$$;
revoke all on function public.service_purge_email_relay_verifications(),public.service_create_email_relay_forwarding_verification(uuid,uuid,uuid,uuid,text,text,text,text,text,text,timestamptz),public.service_list_email_relay_forwarding_verifications(uuid),public.service_update_email_relay_forwarding_verification(uuid,uuid,text),public.service_invalidate_email_relay_verifications(uuid) from public,anon,authenticated;
grant execute on function public.service_purge_email_relay_verifications(),public.service_create_email_relay_forwarding_verification(uuid,uuid,uuid,uuid,text,text,text,text,text,text,timestamptz),public.service_list_email_relay_forwarding_verifications(uuid),public.service_update_email_relay_forwarding_verification(uuid,uuid,text),public.service_invalidate_email_relay_verifications(uuid) to service_role;

-- Clearing is automatic when an alias or individual source is revoked; no UI path can leave an actionable secret behind.
create or replace function private.invalidate_email_relay_verifications_on_alias_revoke()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.revoked_at is not null and old.revoked_at is null then
    update private.email_relay_forwarding_verifications
    set status='dismissed',dismissed_at=coalesce(dismissed_at,now()),verification_url=null,verification_code=null,message_excerpt=null,updated_at=now()
    where alias_id=new.id and status in ('pending','opened');
  end if;
  return new;
end $$;
create trigger email_relay_alias_verifications_invalidate
  after update of revoked_at on private.email_relay_aliases
  for each row execute function private.invalidate_email_relay_verifications_on_alias_revoke();

create or replace function private.invalidate_email_relay_verifications_on_source_revoke()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.revoked_at is not null and old.revoked_at is null then
    update private.email_relay_forwarding_verifications
    set status='dismissed',dismissed_at=coalesce(dismissed_at,now()),verification_url=null,verification_code=null,message_excerpt=null,updated_at=now()
    where source_id=new.id and status in ('pending','opened');
  end if;
  return new;
end $$;
create trigger email_relay_source_verifications_invalidate
  after update of revoked_at on private.email_relay_sources
  for each row execute function private.invalidate_email_relay_verifications_on_source_revoke();
revoke all on function private.invalidate_email_relay_verifications_on_alias_revoke(),private.invalidate_email_relay_verifications_on_source_revoke() from public,anon,authenticated;

create or replace function public.service_list_email_relay_forwarding_verifications(p_user_id uuid)
returns table(id uuid,source_id uuid,provider text,status text,sender text,subject text,excerpt text,verification_url text,verification_code text,received_at timestamptz,expires_at timestamptz,source_label text)
language sql security invoker set search_path='' as $$
  with purge as (select public.service_purge_email_relay_verifications())
  select v.id,v.source_id,v.provider,v.status,v.sender_sanitized,v.subject_sanitized,v.message_excerpt,v.verification_url,v.verification_code,v.received_at,v.expires_at,s.label
  from private.email_relay_forwarding_verifications v
  cross join purge
  join private.email_relay_aliases a on a.id=v.alias_id and a.revoked_at is null
  left join private.email_relay_sources s on s.id=v.source_id and s.revoked_at is null
  where v.user_id=p_user_id and v.status in ('pending','opened') and v.expires_at>now()
  order by v.received_at desc
$$;
