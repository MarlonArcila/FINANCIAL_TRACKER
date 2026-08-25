begin;

-- ============================================================
-- 1. OAuth credentials: SAVE
-- ============================================================

create or replace function public.service_save_oauth_credentials(
  p_connection_id uuid,
  p_encrypted_access_token text,
  p_encrypted_refresh_token text,
  p_token_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_connection_id is null
     or p_encrypted_access_token is null
     or length(p_encrypted_access_token) = 0
  then
    raise exception 'INVALID_OAUTH_CREDENTIAL_INPUT';
  end if;

  if not exists (
    select 1
    from public.source_connections sc
    where sc.id = p_connection_id
  ) then
    raise exception 'SOURCE_CONNECTION_NOT_FOUND';
  end if;

  insert into private.oauth_credentials (
    connection_id,
    encrypted_access_token,
    encrypted_refresh_token,
    token_expires_at
  )
  values (
    p_connection_id,
    p_encrypted_access_token,
    p_encrypted_refresh_token,
    p_token_expires_at
  )
  on conflict (connection_id)
  do update set
    encrypted_access_token =
      excluded.encrypted_access_token,
    encrypted_refresh_token =
      coalesce(
        excluded.encrypted_refresh_token,
        private.oauth_credentials.encrypted_refresh_token
      ),
    token_expires_at =
      excluded.token_expires_at;
end;
$function$;

revoke execute on function
  public.service_save_oauth_credentials(
    uuid,
    text,
    text,
    timestamptz
  )
from public, anon, authenticated;

grant execute on function
  public.service_save_oauth_credentials(
    uuid,
    text,
    text,
    timestamptz
  )
to service_role;


-- ============================================================
-- 2. OAuth credentials: LOAD
-- ============================================================

create or replace function public.service_get_oauth_credentials(
  p_connection_id uuid
)
returns table (
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    oc.encrypted_access_token,
    oc.encrypted_refresh_token,
    oc.token_expires_at
  from private.oauth_credentials oc
  where oc.connection_id = p_connection_id
  limit 1
$function$;

revoke execute on function
  public.service_get_oauth_credentials(uuid)
from public, anon, authenticated;

grant execute on function
  public.service_get_oauth_credentials(uuid)
to service_role;


-- ============================================================
-- 3. Mail synchronization queue
-- ============================================================

create or replace function public.service_enqueue_mail_sync(
  p_connection_id uuid,
  p_provider text,
  p_cursor_before text
)
returns table (
  queued boolean,
  job_id text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing_id text;
  v_new_id text;
begin
  if p_provider <> 'gmail' then
    raise exception 'UNSUPPORTED_MAIL_PROVIDER';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_connection_id::text,
      0
    )
  );

  select j.id::text
  into v_existing_id
  from private.sync_jobs j
  where j.connection_id = p_connection_id
    and j.status in ('queued', 'running')
  limit 1;

  if v_existing_id is not null then
    return query
    select false, v_existing_id;

    return;
  end if;

  insert into private.sync_jobs (
    connection_id,
    provider,
    cursor_before
  )
  values (
    p_connection_id,
    p_provider,
    p_cursor_before
  )
  returning id::text
  into v_new_id;

  return query
  select true, v_new_id;
end;
$function$;

revoke execute on function
  public.service_enqueue_mail_sync(
    uuid,
    text,
    text
  )
from public, anon, authenticated;

grant execute on function
  public.service_enqueue_mail_sync(
    uuid,
    text,
    text
  )
to service_role;


-- ============================================================
-- 4. Server audit event
-- ============================================================

create or replace function public.service_record_audit_event(
  p_user_id uuid,
  p_actor text,
  p_action text,
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into private.audit_events (
    user_id,
    actor,
    action,
    entity_type,
    entity_id
  )
  values (
    p_user_id,
    p_actor,
    p_action,
    p_entity_type,
    p_entity_id
  );
end;
$function$;

revoke execute on function
  public.service_record_audit_event(
    uuid,
    text,
    text,
    text,
    uuid
  )
from public, anon, authenticated;

grant execute on function
  public.service_record_audit_event(
    uuid,
    text,
    text,
    text,
    uuid
  )
to service_role;

notify pgrst, 'reload schema';

commit;
