alter table private.email_relay_sources add column if not exists source_email text;
alter table private.email_relay_sources add constraint email_relay_sources_source_email_format check (source_email is null or (char_length(source_email)<=320 and source_email=lower(trim(source_email)) and source_email !~ '[<>]'));
create unique index if not exists email_relay_sources_active_email_uidx on private.email_relay_sources(alias_id,provider,source_email) where revoked_at is null and source_email is not null;

create or replace function public.service_upsert_email_relay_source_from_inbound(p_user_id uuid,p_alias_id uuid,p_provider text,p_source_email text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_email text:=nullif(lower(trim(p_source_email)),'');
begin
 if p_provider not in ('gmail','outlook','proton','other') then raise exception 'invalid_provider' using errcode='22023'; end if;
 if v_email is not null and (char_length(v_email)>320 or v_email !~ '^[^@[:space:]<>]+@[^@[:space:]<>]+\.[^@[:space:]<>]+$') then raise exception 'invalid_source_email' using errcode='22023'; end if;
 select id into v_id from private.email_relay_sources where alias_id=p_alias_id and provider=p_provider and revoked_at is null and (source_email=v_email or v_email is null) order by created_at desc limit 1;
 if v_id is null then insert into private.email_relay_sources(alias_id,user_id,provider,label,status,source_email) values(p_alias_id,p_user_id,p_provider,case when v_email is null then initcap(p_provider) else v_email end,'pending',v_email) returning id into v_id;
 else update private.email_relay_sources set source_email=coalesce(source_email,v_email),status=case when status='revoked' then status else 'pending' end,updated_at=now() where id=v_id; end if;
 return v_id;
end $$;

create or replace function public.service_create_email_relay_forwarding_verification(p_user_id uuid,p_alias_id uuid,p_source_id uuid,p_source_event_id uuid,p_provider text,p_sender text,p_subject text,p_excerpt text,p_url text,p_code text,p_received_at timestamptz)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
 perform public.service_purge_email_relay_verifications();
 update private.email_relay_forwarding_verifications set status='dismissed',dismissed_at=now(),verification_url=null,verification_code=null,message_excerpt=null,updated_at=now() where user_id=p_user_id and alias_id=p_alias_id and provider=p_provider and coalesce(source_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(p_source_id,'00000000-0000-0000-0000-000000000000'::uuid) and status in ('pending','opened');
 insert into private.email_relay_forwarding_verifications(user_id,alias_id,source_id,source_event_id,provider,sender_sanitized,subject_sanitized,message_excerpt,verification_url,verification_code,received_at,expires_at) values(p_user_id,p_alias_id,p_source_id,p_source_event_id,p_provider,left(p_sender,320),left(p_subject,998),left(p_excerpt,1000),p_url,p_code,p_received_at,now()+interval '7 days') on conflict(source_event_id) do update set updated_at=now() returning id into v_id; return v_id;
end $$;
revoke all on function public.service_upsert_email_relay_source_from_inbound(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_upsert_email_relay_source_from_inbound(uuid,uuid,text,text) to service_role;
