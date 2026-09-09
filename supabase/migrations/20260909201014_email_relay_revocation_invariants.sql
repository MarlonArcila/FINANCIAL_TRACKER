begin;

create or replace function public.service_create_email_relay_setup_intent(
  p_user_id uuid,
  p_provider text
)
returns table(setup_intent_id uuid, provider text, expires_at timestamptz)
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_alias uuid;
  v_id uuid;
  v_now timestamptz := clock_timestamp();
  v_expires timestamptz := v_now + interval '24 hours';
begin
  if p_provider not in ('gmail','outlook','proton','other') then
    raise exception 'invalid_email_relay_source_provider' using errcode='22023';
  end if;

  select a.id
    into v_alias
    from private.email_relay_aliases as a
   where a.user_id=p_user_id
     and a.revoked_at is null
     and a.status <> 'revoked'
   order by a.created_at desc
   limit 1
   for update;

  if v_alias is null then
    raise exception 'email_relay_alias_required' using errcode='P0001';
  end if;

  delete from private.email_relay_setup_intents as expired_intent
   where expired_intent.expires_at <= v_now;

  delete from private.email_relay_setup_intents as old_intent
   where old_intent.user_id=p_user_id
     and old_intent.alias_id=v_alias
     and old_intent.provider=p_provider;

  insert into private.email_relay_setup_intents as new_intent(
    user_id,alias_id,provider,created_at,updated_at,expires_at
  ) values (
    p_user_id,v_alias,p_provider,v_now,v_now,v_expires
  )
  returning new_intent.id into v_id;

  return query select v_id,p_provider,v_expires;
end
$$;

create or replace function public.service_match_email_relay_source(
  p_alias_id uuid,
  p_provider text,
  p_source_email text default null
)
returns table(source_id uuid, match_status text)
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_count integer;
  v_source uuid;
  v_email text := nullif(lower(btrim(p_source_email)), '');
  v_revoked integer;
begin
  if p_provider not in ('gmail','outlook','proton','other') then
    return query select null::uuid,'invalid_provider'::text;
    return;
  end if;

  if v_email is not null then
    select s.id
      into v_source
      from private.email_relay_sources as s
     where s.alias_id=p_alias_id
       and s.provider=p_provider
       and s.source_email=v_email
       and s.revoked_at is null
       and s.status <> 'revoked'
     limit 1;

    if v_source is not null then
      return query select v_source,'matched'::text;
      return;
    end if;
  end if;

  select count(*)
    into v_count
    from private.email_relay_sources as s
   where s.alias_id=p_alias_id
     and s.provider=p_provider
     and s.revoked_at is null
     and s.status <> 'revoked';

  if v_count=1 then
    select s.id
      into v_source
      from private.email_relay_sources as s
     where s.alias_id=p_alias_id
       and s.provider=p_provider
       and s.revoked_at is null
       and s.status <> 'revoked'
     limit 1;

    return query select v_source,'matched_unambiguous'::text;
    return;
  elsif v_count>1 then
    return query select null::uuid,'ambiguous'::text;
    return;
  end if;

  select count(*)
    into v_revoked
    from private.email_relay_sources as s
   where s.alias_id=p_alias_id
     and s.provider=p_provider
     and (s.revoked_at is not null or s.status='revoked');

  if v_revoked>0 then
    return query select null::uuid,'revoked'::text;
  else
    return query select null::uuid,'unconfigured'::text;
  end if;
end
$$;

create or replace function public.service_upsert_email_relay_source_from_inbound(
  p_user_id uuid,
  p_alias_id uuid,
  p_provider text,
  p_source_email text
)
returns table(source_id uuid, match_status text)
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_email text := nullif(lower(btrim(p_source_email)), '');
  v_source uuid;
  v_count integer;
  v_intent uuid;
  v_last_revoked timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  if p_provider not in ('gmail','outlook','proton','other') then
    raise exception 'invalid_email_relay_source_provider' using errcode='22023';
  end if;

  if v_email is not null and (
    char_length(v_email)>320 or
    v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ) then
    raise exception 'invalid_email_relay_source_email' using errcode='22023';
  end if;

  perform 1
    from private.email_relay_aliases as a
   where a.id=p_alias_id
     and a.user_id=p_user_id
     and a.revoked_at is null
     and a.status <> 'revoked'
   for update;

  if not found then
    return query select null::uuid,'alias_revoked_or_not_owned'::text;
    return;
  end if;

  if v_email is not null then
    select s.id
      into v_source
      from private.email_relay_sources as s
     where s.alias_id=p_alias_id
       and s.user_id=p_user_id
       and s.provider=p_provider
       and s.source_email=v_email
       and s.revoked_at is null
       and s.status <> 'revoked'
     limit 1
     for update;

    if v_source is not null then
      update private.email_relay_sources as matched_source
         set last_delivery_at=v_now,
             updated_at=v_now
       where matched_source.id=v_source;

      return query select v_source,'matched'::text;
      return;
    end if;
  end if;

  select count(*)
    into v_count
    from private.email_relay_sources as s
   where s.alias_id=p_alias_id
     and s.user_id=p_user_id
     and s.provider=p_provider
     and s.revoked_at is null
     and s.status <> 'revoked';

  if v_count=1 then
    select s.id
      into v_source
      from private.email_relay_sources as s
     where s.alias_id=p_alias_id
       and s.user_id=p_user_id
       and s.provider=p_provider
       and s.revoked_at is null
       and s.status <> 'revoked'
     limit 1
     for update;

    update private.email_relay_sources as matched_source
       set source_email=coalesce(matched_source.source_email,v_email),
           last_delivery_at=v_now,
           updated_at=v_now
     where matched_source.id=v_source;

    return query select v_source,'matched_unambiguous'::text;
    return;
  elsif v_count>1 then
    return query select null::uuid,'ambiguous'::text;
    return;
  end if;

  select max(coalesce(s.revoked_at,s.updated_at))
    into v_last_revoked
    from private.email_relay_sources as s
   where s.alias_id=p_alias_id
     and s.user_id=p_user_id
     and s.provider=p_provider
     and (s.revoked_at is not null or s.status='revoked');

  select intent.id
    into v_intent
    from private.email_relay_setup_intents as intent
   where intent.user_id=p_user_id
     and intent.alias_id=p_alias_id
     and intent.provider=p_provider
     and intent.expires_at>v_now
     and (v_last_revoked is null or intent.created_at>v_last_revoked)
   order by intent.created_at desc,intent.id
   limit 1
   for update;

  if v_intent is null then
    return query select null::uuid,'setup_intent_required'::text;
    return;
  end if;

  insert into private.email_relay_sources as new_source(
    alias_id,user_id,provider,label,status,source_email,last_delivery_at,created_at,updated_at
  ) values (
    p_alias_id,p_user_id,p_provider,
    coalesce(v_email,case p_provider
      when 'gmail' then 'Gmail'
      when 'outlook' then 'Outlook / Hotmail'
      when 'proton' then 'Proton Mail'
      else 'Otro correo'
    end),
    'pending',v_email,v_now,v_now,v_now
  )
  returning new_source.id into v_source;

  delete from private.email_relay_setup_intents as consumed_intent
   where consumed_intent.id=v_intent;

  return query select v_source,'created_from_setup_intent'::text;
end
$$;

create or replace function public.service_revoke_email_relay_source(
  p_user_id uuid,
  p_source_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_alias uuid;
  v_provider text;
  v_now timestamptz := clock_timestamp();
begin
  select s.alias_id,s.provider
    into v_alias,v_provider
    from private.email_relay_sources as s
   where s.id=p_source_id
     and s.user_id=p_user_id
     and s.revoked_at is null
     and s.status <> 'revoked'
   for update;

  if v_alias is null then return false; end if;

  perform 1
    from private.email_relay_aliases as a
   where a.id=v_alias
     and a.user_id=p_user_id
   for update;

  update private.email_relay_sources as target_source
     set status='revoked',
         revoked_at=v_now,
         updated_at=v_now
   where target_source.id=p_source_id;

  update private.email_relay_link_tests as target_test
     set status='dismissed',
         updated_at=v_now
   where target_test.source_id=p_source_id
     and target_test.user_id=p_user_id
     and target_test.status='pending';

  update private.email_relay_forwarding_verifications as target_verification
     set status='dismissed',
         dismissed_at=coalesce(target_verification.dismissed_at,v_now),
         verification_url=null,
         verification_code=null,
         message_excerpt=null,
         updated_at=v_now
   where target_verification.source_id=p_source_id
     and target_verification.user_id=p_user_id
     and target_verification.status in ('pending','opened');

  delete from private.email_relay_setup_intents as old_intent
   where old_intent.user_id=p_user_id
     and old_intent.alias_id=v_alias
     and old_intent.provider=v_provider;

  return true;
end
$$;

create or replace function public.service_revoke_email_relay_alias(
  p_user_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_alias uuid;
  v_connection uuid;
  v_now timestamptz := clock_timestamp();
begin
  select a.id,a.connection_id
    into v_alias,v_connection
    from private.email_relay_aliases as a
   where a.user_id=p_user_id
     and a.revoked_at is null
     and a.status <> 'revoked'
   order by a.created_at desc
   limit 1
   for update;

  if v_alias is null then return false; end if;

  update private.email_relay_sources as source_row
     set status='revoked',
         revoked_at=coalesce(source_row.revoked_at,v_now),
         updated_at=v_now
   where source_row.alias_id=v_alias
     and source_row.user_id=p_user_id
     and source_row.revoked_at is null;

  update private.email_relay_link_tests as test_row
     set status='dismissed',
         updated_at=v_now
   where test_row.alias_id=v_alias
     and test_row.user_id=p_user_id
     and test_row.status='pending';

  update private.email_relay_forwarding_verifications as verification_row
     set status='dismissed',
         dismissed_at=coalesce(verification_row.dismissed_at,v_now),
         verification_url=null,
         verification_code=null,
         message_excerpt=null,
         updated_at=v_now
   where verification_row.alias_id=v_alias
     and verification_row.user_id=p_user_id
     and verification_row.status in ('pending','opened');

  delete from private.email_relay_setup_intents as intent_row
   where intent_row.alias_id=v_alias
     and intent_row.user_id=p_user_id;

  update private.email_relay_aliases as alias_row
     set status='revoked',
         revoked_at=v_now,
         updated_at=v_now
   where alias_row.id=v_alias;

  update public.source_connections as connection_row
     set status='revoked',
         updated_at=v_now
   where connection_row.id=v_connection
     and connection_row.user_id=p_user_id
     and connection_row.provider='email_relay';

  return true;
end
$$;

create or replace function public.service_create_or_rotate_email_relay_alias(
  p_user_id uuid,
  p_token_hash text,
  p_alias_hint text
)
returns table(alias_id uuid, connection_id uuid, status text)
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_connection uuid;
  v_alias uuid;
  v_old_alias uuid;
  v_now timestamptz := clock_timestamp();
begin
  select current_alias.id
    into v_old_alias
    from private.email_relay_aliases as current_alias
   where current_alias.user_id=p_user_id
     and current_alias.revoked_at is null
     and current_alias.status <> 'revoked'
   order by current_alias.created_at desc
   limit 1
   for update;

  if v_old_alias is not null then
    update private.email_relay_sources as old_source
       set status='revoked',
           revoked_at=coalesce(old_source.revoked_at,v_now),
           updated_at=v_now
     where old_source.alias_id=v_old_alias
       and old_source.user_id=p_user_id
       and old_source.revoked_at is null;

    update private.email_relay_link_tests as old_test
       set status='dismissed',
           updated_at=v_now
     where old_test.alias_id=v_old_alias
       and old_test.user_id=p_user_id
       and old_test.status='pending';

    update private.email_relay_forwarding_verifications as old_verification
       set status='dismissed',
           dismissed_at=coalesce(old_verification.dismissed_at,v_now),
           verification_url=null,
           verification_code=null,
           message_excerpt=null,
           updated_at=v_now
     where old_verification.alias_id=v_old_alias
       and old_verification.user_id=p_user_id
       and old_verification.status in ('pending','opened');

    delete from private.email_relay_setup_intents as old_intent
     where old_intent.alias_id=v_old_alias
       and old_intent.user_id=p_user_id;

    update private.email_relay_aliases as old_alias
       set status='revoked',
           revoked_at=v_now,
           updated_at=v_now
     where old_alias.id=v_old_alias;
  end if;

  insert into public.source_connections as connection_row(user_id,provider,status)
    values (p_user_id,'email_relay','pending')
  on conflict (user_id,provider) do update
    set status='pending',
        last_error=null,
        updated_at=v_now
  returning connection_row.id into v_connection;

  insert into private.email_relay_aliases as new_alias(
    user_id,connection_id,token_hash,alias_hint,status,created_at,updated_at
  ) values (
    p_user_id,v_connection,p_token_hash,p_alias_hint,'pending',v_now,v_now
  )
  returning new_alias.id into v_alias;

  return query select v_alias,v_connection,'pending'::text;
end
$$;

create or replace function public.service_complete_email_relay_link_test(
  p_alias_id uuid,
  p_provider text,
  p_challenge_hash text
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_test uuid;
  v_source uuid;
  v_user uuid;
  v_connection uuid;
  v_now timestamptz := clock_timestamp();
begin
  select test_row.id,test_row.source_id,test_row.user_id,alias_row.connection_id
    into v_test,v_source,v_user,v_connection
    from private.email_relay_link_tests as test_row
    join private.email_relay_sources as source_row
      on source_row.id=test_row.source_id
     and source_row.user_id=test_row.user_id
     and source_row.alias_id=test_row.alias_id
     and source_row.provider=test_row.provider
    join private.email_relay_aliases as alias_row
      on alias_row.id=test_row.alias_id
     and alias_row.user_id=test_row.user_id
    join public.source_connections as connection_row
      on connection_row.id=alias_row.connection_id
     and connection_row.user_id=test_row.user_id
     and connection_row.provider='email_relay'
   where test_row.alias_id=p_alias_id
     and test_row.provider=p_provider
     and test_row.challenge_hash=p_challenge_hash
     and test_row.status='pending'
     and test_row.expires_at>v_now
     and source_row.revoked_at is null
     and source_row.status <> 'revoked'
     and alias_row.revoked_at is null
     and alias_row.status <> 'revoked'
     and connection_row.status <> 'revoked'
   limit 1
   for update of test_row,source_row,alias_row,connection_row;

  if v_test is null or v_source is null then return null; end if;

  update private.email_relay_link_tests as consumed_test
     set status='received',
         received_at=v_now,
         updated_at=v_now
   where consumed_test.id=v_test
     and consumed_test.status='pending';

  if not found then return null; end if;

  update private.email_relay_sources as active_source
     set status='active',
         last_delivery_at=v_now,
         last_link_test_at=v_now,
         updated_at=v_now
   where active_source.id=v_source
     and active_source.user_id=v_user
     and active_source.revoked_at is null
     and active_source.status <> 'revoked';

  if not found then
    raise exception 'email_relay_source_revoked_during_link_test' using errcode='P0001';
  end if;

  update private.email_relay_aliases as active_alias
     set status='active',
         last_received_at=v_now,
         updated_at=v_now
   where active_alias.id=p_alias_id
     and active_alias.user_id=v_user
     and active_alias.revoked_at is null
     and active_alias.status <> 'revoked';

  if not found then
    raise exception 'email_relay_alias_revoked_during_link_test' using errcode='P0001';
  end if;

  update public.source_connections as active_connection
     set status='active',
         last_sync_at=v_now,
         updated_at=v_now
   where active_connection.id=v_connection
     and active_connection.user_id=v_user
     and active_connection.provider='email_relay'
     and active_connection.status <> 'revoked';

  if not found then
    raise exception 'email_relay_connection_revoked_during_link_test' using errcode='P0001';
  end if;

  update private.email_relay_forwarding_verifications as resolved_verification
     set status='resolved',
         resolved_at=v_now,
         verification_url=null,
         verification_code=null,
         message_excerpt=null,
         updated_at=v_now
   where resolved_verification.source_id=v_source
     and resolved_verification.user_id=v_user
     and resolved_verification.status in ('pending','opened');

  return v_test;
end
$$;

revoke all on function public.service_create_email_relay_setup_intent(uuid,text) from public,anon,authenticated;
revoke all on function public.service_match_email_relay_source(uuid,text,text) from public,anon,authenticated;
revoke all on function public.service_upsert_email_relay_source_from_inbound(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.service_revoke_email_relay_source(uuid,uuid) from public,anon,authenticated;
revoke all on function public.service_revoke_email_relay_alias(uuid) from public,anon,authenticated;
revoke all on function public.service_create_or_rotate_email_relay_alias(uuid,text,text) from public,anon,authenticated;
revoke all on function public.service_complete_email_relay_link_test(uuid,text,text) from public,anon,authenticated;

grant execute on function public.service_create_email_relay_setup_intent(uuid,text) to service_role;
grant execute on function public.service_match_email_relay_source(uuid,text,text) to service_role;
grant execute on function public.service_upsert_email_relay_source_from_inbound(uuid,uuid,text,text) to service_role;
grant execute on function public.service_revoke_email_relay_source(uuid,uuid) to service_role;
grant execute on function public.service_revoke_email_relay_alias(uuid) to service_role;
grant execute on function public.service_create_or_rotate_email_relay_alias(uuid,text,text) to service_role;
grant execute on function public.service_complete_email_relay_link_test(uuid,text,text) to service_role;

notify pgrst, 'reload schema';

commit;
