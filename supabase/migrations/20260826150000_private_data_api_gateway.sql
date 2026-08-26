begin;

-- Keep private data outside PostgREST while exposing only narrow backend-only
-- capabilities to Edge Functions through the public schema.

create or replace function public.service_record_audit_event_v2(
  p_user_id uuid,
  p_actor text,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if nullif(btrim(p_actor), '') is null or nullif(btrim(p_action), '') is null then
    raise exception 'invalid_audit_event' using errcode = '22023';
  end if;

  insert into private.audit_events (
    user_id, actor, action, entity_type, entity_id, metadata
  ) values (
    p_user_id,
    p_actor,
    p_action,
    nullif(btrim(p_entity_type), ''),
    nullif(btrim(p_entity_id), ''),
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$function$;

create or replace function public.service_get_storage_oauth_credentials(
  p_connection_id uuid
)
returns table (
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_expires_at timestamptz
)
language sql
security definer
set search_path = ''
as $function$
  select
    c.encrypted_access_token,
    c.encrypted_refresh_token,
    c.token_expires_at
  from private.storage_oauth_credentials c
  where c.connection_id = p_connection_id;
$function$;

create or replace function public.service_save_storage_oauth_credentials(
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
  if p_connection_id is null or nullif(p_encrypted_access_token, '') is null then
    raise exception 'invalid_storage_oauth_credentials' using errcode = '22023';
  end if;

  insert into private.storage_oauth_credentials as existing (
    connection_id,
    encrypted_access_token,
    encrypted_refresh_token,
    token_expires_at,
    updated_at
  ) values (
    p_connection_id,
    p_encrypted_access_token,
    p_encrypted_refresh_token,
    p_token_expires_at,
    now()
  )
  on conflict (connection_id) do update set
    encrypted_access_token = excluded.encrypted_access_token,
    encrypted_refresh_token = coalesce(
      excluded.encrypted_refresh_token,
      existing.encrypted_refresh_token
    ),
    token_expires_at = excluded.token_expires_at,
    updated_at = now();
end;
$function$;

create or replace function public.service_delete_storage_oauth_credentials(
  p_connection_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $function$
  delete from private.storage_oauth_credentials
  where connection_id = p_connection_id;
$function$;

create or replace function public.service_claim_webhook_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claimed boolean := false;
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_event_id), '') is null then
    raise exception 'invalid_webhook_identity' using errcode = '22023';
  end if;

  insert into private.webhook_events as existing (
    provider,
    event_id,
    event_type,
    payload,
    status,
    attempts,
    last_error,
    received_at,
    processed_at
  ) values (
    p_provider,
    p_event_id,
    p_event_type,
    coalesce(p_payload, '{}'::jsonb),
    'received',
    1,
    null,
    now(),
    null
  )
  on conflict (provider, event_id) do update set
    event_type = excluded.event_type,
    payload = excluded.payload,
    status = 'received',
    attempts = existing.attempts + 1,
    last_error = null,
    received_at = now(),
    processed_at = null
  where existing.status = 'failed'
     or (existing.status = 'received' and existing.received_at < now() - interval '10 minutes')
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$function$;

create or replace function public.service_mark_webhook_event(
  p_provider text,
  p_event_id text,
  p_status text,
  p_last_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rows integer;
begin
  if p_status not in ('processed', 'ignored', 'failed') then
    raise exception 'invalid_webhook_status' using errcode = '22023';
  end if;

  update private.webhook_events
  set
    status = p_status,
    last_error = case
      when p_status = 'failed' then left(coalesce(p_last_error, 'unknown'), 1000)
      else null
    end,
    processed_at = case
      when p_status in ('processed', 'ignored') then now()
      else null
    end
  where provider = p_provider
    and event_id = p_event_id;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'webhook_event_not_found' using errcode = 'P0002';
  end if;
end;
$function$;

create or replace function public.service_restore_user_backup(
  p_user_id uuid,
  p_payload jsonb,
  p_backup_id text,
  p_safety_backup_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  v_result := private.restore_user_backup(p_user_id, p_payload);

  insert into private.audit_events (
    user_id, actor, action, entity_type, entity_id, metadata
  ) values (
    p_user_id,
    'user',
    'cloud_backup.restored',
    'cloud_backup',
    p_backup_id,
    jsonb_build_object('safety_backup', p_safety_backup_id)
  );

  return v_result;
end;
$function$;

alter function public.service_record_audit_event_v2(uuid,text,text,text,text,jsonb) owner to postgres;
alter function public.service_get_storage_oauth_credentials(uuid) owner to postgres;
alter function public.service_save_storage_oauth_credentials(uuid,text,text,timestamptz) owner to postgres;
alter function public.service_delete_storage_oauth_credentials(uuid) owner to postgres;
alter function public.service_claim_webhook_event(text,text,text,jsonb) owner to postgres;
alter function public.service_mark_webhook_event(text,text,text,text) owner to postgres;
alter function public.service_restore_user_backup(uuid,jsonb,text,text) owner to postgres;

revoke all on function public.service_record_audit_event_v2(uuid,text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.service_get_storage_oauth_credentials(uuid) from public, anon, authenticated;
revoke all on function public.service_save_storage_oauth_credentials(uuid,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.service_delete_storage_oauth_credentials(uuid) from public, anon, authenticated;
revoke all on function public.service_claim_webhook_event(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.service_mark_webhook_event(text,text,text,text) from public, anon, authenticated;
revoke all on function public.service_restore_user_backup(uuid,jsonb,text,text) from public, anon, authenticated;

grant execute on function public.service_record_audit_event_v2(uuid,text,text,text,text,jsonb) to service_role;
grant execute on function public.service_get_storage_oauth_credentials(uuid) to service_role;
grant execute on function public.service_save_storage_oauth_credentials(uuid,text,text,timestamptz) to service_role;
grant execute on function public.service_delete_storage_oauth_credentials(uuid) to service_role;
grant execute on function public.service_claim_webhook_event(text,text,text,jsonb) to service_role;
grant execute on function public.service_mark_webhook_event(text,text,text,text) to service_role;
grant execute on function public.service_restore_user_backup(uuid,jsonb,text,text) to service_role;

notify pgrst, 'reload schema';

commit;
