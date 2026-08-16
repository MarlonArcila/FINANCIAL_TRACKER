begin;

create or replace function public.consume_oauth_state(
  p_state_hash text,
  p_provider text
)
returns table(user_id uuid, provider text, code_verifier text, return_url text)
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  with consumed as (
    update private.oauth_states
    set used_at = now()
    where state_hash = p_state_hash
      and provider = p_provider
      and used_at is null
      and expires_at > now()
    returning user_id, provider, code_verifier, return_url
  )
  select user_id, provider, code_verifier, return_url from consumed;
$$;

create or replace function public.consume_storage_oauth_state(
  p_state_hash text
)
returns table(user_id uuid, provider text, code_verifier text, return_url text)
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  with consumed as (
    update private.storage_oauth_states
    set used_at = now()
    where state_hash = p_state_hash
      and used_at is null
      and expires_at > now()
    returning user_id, provider, code_verifier, return_url
  )
  select user_id, provider, code_verifier, return_url from consumed;
$$;

revoke all on function public.consume_oauth_state(text, text) from public, anon, authenticated;
revoke all on function public.consume_storage_oauth_state(text) from public, anon, authenticated;
grant execute on function public.consume_oauth_state(text, text) to service_role;
grant execute on function public.consume_storage_oauth_state(text) to service_role;

commit;
