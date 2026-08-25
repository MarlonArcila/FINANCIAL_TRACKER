begin;

select plan(18);

insert into auth.users(id, email)
values (
  '95000000-0000-4000-8000-000000000001',
  'oauth-state-creation@example.invalid'
);

-- ============================================================
-- Mail OAuth RPC
-- ============================================================

select ok(
  to_regprocedure(
    'public.create_mail_oauth_state(text,uuid,text,text,timestamptz)'
  ) is not null,
  'mail OAuth creation RPC exists'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid =
      'public.create_mail_oauth_state(text,uuid,text,text,timestamptz)'
        ::regprocedure
  ),
  'mail OAuth creation RPC is security definer'
);

select ok(
  exists (
    select 1
    from pg_proc p
    cross join lateral
      unnest(
        coalesce(
          p.proconfig,
          '{}'::text[]
        )
      ) as function_config(value)
    where p.oid =
      'public.create_mail_oauth_state(text,uuid,text,text,timestamptz)'
        ::regprocedure
      and function_config.value
        ~ '^search_path=("")?$'
  ),
  'mail OAuth creation RPC has empty search_path'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.create_mail_oauth_state(text,uuid,text,text,timestamptz)',
    'EXECUTE'
  ),
  'service_role can create mail OAuth state'
);

select ok(
  not has_function_privilege(
    'public',
    'public.create_mail_oauth_state(text,uuid,text,text,timestamptz)',
    'EXECUTE'
  ),
  'PUBLIC cannot create mail OAuth state'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_mail_oauth_state(text,uuid,text,text,timestamptz)',
    'EXECUTE'
  ),
  'anon cannot create mail OAuth state'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_mail_oauth_state(text,uuid,text,text,timestamptz)',
    'EXECUTE'
  ),
  'authenticated cannot create mail OAuth state'
);

-- ============================================================
-- Storage OAuth RPC
-- ============================================================

select ok(
  to_regprocedure(
    'public.create_storage_oauth_state(text,uuid,text,text,timestamptz)'
  ) is not null,
  'storage OAuth creation RPC exists'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid =
      'public.create_storage_oauth_state(text,uuid,text,text,timestamptz)'
        ::regprocedure
  ),
  'storage OAuth creation RPC is security definer'
);

select ok(
  exists (
    select 1
    from pg_proc p
    cross join lateral
      unnest(
        coalesce(
          p.proconfig,
          '{}'::text[]
        )
      ) as function_config(value)
    where p.oid =
      'public.create_storage_oauth_state(text,uuid,text,text,timestamptz)'
        ::regprocedure
      and function_config.value
        ~ '^search_path=("")?$'
  ),
  'storage OAuth creation RPC has empty search_path'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.create_storage_oauth_state(text,uuid,text,text,timestamptz)',
    'EXECUTE'
  ),
  'service_role can create storage OAuth state'
);

select ok(
  not has_function_privilege(
    'public',
    'public.create_storage_oauth_state(text,uuid,text,text,timestamptz)',
    'EXECUTE'
  ),
  'PUBLIC cannot create storage OAuth state'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_storage_oauth_state(text,uuid,text,text,timestamptz)',
    'EXECUTE'
  ),
  'anon cannot create storage OAuth state'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_storage_oauth_state(text,uuid,text,text,timestamptz)',
    'EXECUTE'
  ),
  'authenticated cannot create storage OAuth state'
);

-- ============================================================
-- Functional persistence checks
-- ============================================================

select lives_ok(
  $$
  select public.create_mail_oauth_state(
    repeat('a', 43),
    '95000000-0000-4000-8000-000000000001',
    repeat('b', 64),
    'http://localhost:5173/#/integrations',
    now() + interval '10 minutes'
  )
  $$,
  'mail OAuth state can be created'
);

select ok(
  exists (
    select 1
    from private.oauth_states
    where state_hash = repeat('a', 43)
      and user_id =
        '95000000-0000-4000-8000-000000000001'
      and provider = 'gmail'
      and used_at is null
      and expires_at > now()
  ),
  'mail OAuth state was persisted privately'
);

select lives_ok(
  $$
  select public.create_storage_oauth_state(
    repeat('c', 43),
    '95000000-0000-4000-8000-000000000001',
    repeat('d', 64),
    'http://localhost:5173/#/data',
    now() + interval '10 minutes'
  )
  $$,
  'storage OAuth state can be created'
);

select ok(
  exists (
    select 1
    from private.storage_oauth_states
    where state_hash = repeat('c', 43)
      and user_id =
        '95000000-0000-4000-8000-000000000001'
      and provider = 'google_drive'
      and used_at is null
      and expires_at > now()
  ),
  'storage OAuth state was persisted privately'
);

select * from finish();

rollback;
