begin;

select plan(8);

select ok(
  has_table_privilege('service_role', 'public.onboarding_state', 'SELECT'),
  'service_role can read onboarding review progress'
);
select ok(
  has_table_privilege('service_role', 'public.onboarding_state', 'UPDATE'),
  'service_role can update onboarding review progress'
);
select ok(
  not has_table_privilege('service_role', 'public.onboarding_state', 'INSERT'),
  'service_role cannot insert onboarding state rows'
);
select ok(
  not has_table_privilege('service_role', 'public.onboarding_state', 'DELETE'),
  'service_role cannot delete onboarding state rows'
);

select ok(
  has_table_privilege('authenticated', 'public.onboarding_state', 'SELECT'),
  'authenticated retains onboarding state SELECT'
);
select ok(
  has_table_privilege('authenticated', 'public.onboarding_state', 'INSERT'),
  'authenticated retains onboarding state INSERT'
);
select ok(
  has_table_privilege('authenticated', 'public.onboarding_state', 'UPDATE'),
  'authenticated retains onboarding state UPDATE'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.onboarding_state'::regclass),
  'onboarding_state keeps RLS enabled'
);

select * from finish();
rollback;
