begin;

select plan(2);

select ok(
  has_column_privilege(
    'service_role',
    'public.profiles',
    'id',
    'SELECT'
  ),
  'service_role can read profile id'
);

select ok(
  has_column_privilege(
    'service_role',
    'public.profiles',
    'base_currency',
    'SELECT'
  ),
  'service_role can read profile base currency'
);

select * from finish();

rollback;
