begin;
select plan(17);

insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000009201','relay-v6@example.invalid');

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);

select lives_ok(
  $$select * from public.service_create_or_rotate_email_relay_alias(
    '00000000-0000-4000-8000-000000009201',
    'rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr',
    'rrrr...rrrr'
  )$$,
  'fresh relay alias can be created'
);

select lives_ok(
  $$select * from public.service_create_email_relay_source(
    '00000000-0000-4000-8000-000000009201','gmail','Gmail fixture'
  )$$,
  'fixture source can be created'
);

select lives_ok(
  $$select * from public.service_create_email_relay_link_test(
    '00000000-0000-4000-8000-000000009201',
    (select source_id from public.service_list_email_relay_sources(
      '00000000-0000-4000-8000-000000009201'
    ) where provider='gmail' limit 1),
    'hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh'
  )$$,
  'link challenge exists before revocation'
);

select ok(
  public.service_revoke_email_relay_source(
    '00000000-0000-4000-8000-000000009201',
    (select id from private.email_relay_sources
      where user_id='00000000-0000-4000-8000-000000009201'
        and provider='gmail'
      order by created_at desc limit 1)
  ),
  'source revocation succeeds'
);

select is(
  (select status from private.email_relay_link_tests
    where user_id='00000000-0000-4000-8000-000000009201'
    order by created_at desc limit 1),
  'dismissed',
  'source revoke dismisses pending challenge'
);

select is(
  public.service_complete_email_relay_link_test(
    (select id from private.email_relay_aliases
      where user_id='00000000-0000-4000-8000-000000009201'
        and revoked_at is null limit 1),
    'gmail',
    'hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh'
  ),
  null::uuid,
  'revoked challenge cannot complete'
);

select isnt(
  (select status from private.email_relay_aliases
    where user_id='00000000-0000-4000-8000-000000009201'
      and revoked_at is null limit 1),
  'active',
  'revoked challenge cannot activate alias'
);

select isnt(
  (select status from public.source_connections
    where user_id='00000000-0000-4000-8000-000000009201'
      and provider='email_relay'),
  'active',
  'revoked challenge cannot activate connection'
);

select is(
  (select match_status from public.service_upsert_email_relay_source_from_inbound(
    '00000000-0000-4000-8000-000000009201',
    (select id from private.email_relay_aliases
      where user_id='00000000-0000-4000-8000-000000009201'
        and revoked_at is null limit 1),
    'gmail',
    'relay-v6@gmail.com'
  )),
  'setup_intent_required',
  'inbound cannot recreate revoked provider without new setup intent'
);

select is(
  (select count(*)::integer from private.email_relay_sources
    where user_id='00000000-0000-4000-8000-000000009201'
      and provider='gmail' and revoked_at is null),
  0,
  'no non-revoked source was recreated'
);

select lives_ok(
  $$select * from public.service_create_email_relay_setup_intent(
    '00000000-0000-4000-8000-000000009201','gmail'
  )$$,
  'explicit post-revocation setup intent can be created'
);

select is(
  (select match_status from public.service_upsert_email_relay_source_from_inbound(
    '00000000-0000-4000-8000-000000009201',
    (select id from private.email_relay_aliases
      where user_id='00000000-0000-4000-8000-000000009201'
        and revoked_at is null limit 1),
    'gmail',
    'relay-v6@gmail.com'
  )),
  'created_from_setup_intent',
  'explicit post-revocation intent creates a NEW source'
);

select is(
  (select count(*)::integer from private.email_relay_setup_intents
    where user_id='00000000-0000-4000-8000-000000009201'
      and provider='gmail'),
  0,
  'setup intent is consumed after source creation'
);

select is(
  (select count(*)::integer from private.email_relay_sources
    where user_id='00000000-0000-4000-8000-000000009201'
      and provider='gmail' and revoked_at is not null),
  1,
  'old source remains a revoked tombstone'
);

select is(
  (select count(*)::integer from private.email_relay_sources
    where user_id='00000000-0000-4000-8000-000000009201'
      and provider='gmail' and revoked_at is null),
  1,
  'new relink source is distinct and current'
);

select lives_ok(
  $$select * from public.service_create_or_rotate_email_relay_alias(
    '00000000-0000-4000-8000-000000009201',
    'sssssssssssssssssssssssssssssssssssssssssss',
    'ssss...ssss'
  )$$,
  'rotation succeeds after relink'
);

select is(
  (select count(*)::integer from public.service_resolve_email_relay_alias(
    'rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr'
  )),
  0,
  'old alias is permanently non-resolvable after rotation'
);

select * from finish();
rollback;
