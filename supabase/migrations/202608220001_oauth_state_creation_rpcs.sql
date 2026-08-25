begin;

-- ============================================================
-- Gmail OAuth state creation
-- ============================================================

create or replace function public.create_mail_oauth_state(
  p_state_hash text,
  p_user_id uuid,
  p_code_verifier text,
  p_return_url text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_user_id is null then
    raise exception 'OAUTH_USER_REQUIRED'
      using errcode = '22023';
  end if;

  if p_state_hash is null
    or p_state_hash !~ '^[A-Za-z0-9_-]{43}$'
  then
    raise exception 'INVALID_OAUTH_STATE_HASH'
      using errcode = '22023';
  end if;

  if p_code_verifier is null
    or char_length(p_code_verifier) not between 43 and 128
  then
    raise exception 'INVALID_OAUTH_CODE_VERIFIER'
      using errcode = '22023';
  end if;

  if p_return_url is null
    or char_length(trim(p_return_url)) = 0
    or char_length(p_return_url) > 2048
  then
    raise exception 'INVALID_OAUTH_RETURN_URL'
      using errcode = '22023';
  end if;

  if p_expires_at is null
    or p_expires_at <= now()
    or p_expires_at > now() + interval '15 minutes'
  then
    raise exception 'INVALID_OAUTH_EXPIRATION'
      using errcode = '22023';
  end if;

  insert into private.oauth_states(
    state_hash,
    user_id,
    provider,
    code_verifier,
    return_url,
    expires_at
  )
  values (
    p_state_hash,
    p_user_id,
    'gmail',
    p_code_verifier,
    p_return_url,
    p_expires_at
  );
end;
$function$;

comment on function public.create_mail_oauth_state(
  text,
  uuid,
  text,
  text,
  timestamptz
)
is
  'Creates a short-lived Gmail OAuth state. '
  'Executable only by service_role.';

revoke all
on function public.create_mail_oauth_state(
  text,
  uuid,
  text,
  text,
  timestamptz
)
from public, anon, authenticated;

grant execute
on function public.create_mail_oauth_state(
  text,
  uuid,
  text,
  text,
  timestamptz
)
to service_role;


-- ============================================================
-- Google Drive OAuth state creation
-- ============================================================

create or replace function public.create_storage_oauth_state(
  p_state_hash text,
  p_user_id uuid,
  p_code_verifier text,
  p_return_url text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_user_id is null then
    raise exception 'STORAGE_OAUTH_USER_REQUIRED'
      using errcode = '22023';
  end if;

  if p_state_hash is null
    or p_state_hash !~ '^[A-Za-z0-9_-]{43}$'
  then
    raise exception 'INVALID_STORAGE_OAUTH_STATE_HASH'
      using errcode = '22023';
  end if;

  if p_code_verifier is null
    or char_length(p_code_verifier) not between 43 and 128
  then
    raise exception 'INVALID_STORAGE_OAUTH_CODE_VERIFIER'
      using errcode = '22023';
  end if;

  if p_return_url is null
    or char_length(trim(p_return_url)) = 0
    or char_length(p_return_url) > 2048
  then
    raise exception 'INVALID_STORAGE_OAUTH_RETURN_URL'
      using errcode = '22023';
  end if;

  if p_expires_at is null
    or p_expires_at <= now()
    or p_expires_at > now() + interval '15 minutes'
  then
    raise exception 'INVALID_STORAGE_OAUTH_EXPIRATION'
      using errcode = '22023';
  end if;

  insert into private.storage_oauth_states(
    state_hash,
    user_id,
    provider,
    code_verifier,
    return_url,
    expires_at
  )
  values (
    p_state_hash,
    p_user_id,
    'google_drive',
    p_code_verifier,
    p_return_url,
    p_expires_at
  );
end;
$function$;

comment on function public.create_storage_oauth_state(
  text,
  uuid,
  text,
  text,
  timestamptz
)
is
  'Creates a short-lived Google Drive OAuth state. '
  'Executable only by service_role.';

revoke all
on function public.create_storage_oauth_state(
  text,
  uuid,
  text,
  text,
  timestamptz
)
from public, anon, authenticated;

grant execute
on function public.create_storage_oauth_state(
  text,
  uuid,
  text,
  text,
  timestamptz
)
to service_role;

notify pgrst, 'reload schema';

commit;
