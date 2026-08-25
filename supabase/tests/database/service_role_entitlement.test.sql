begin;

select plan(8);

select ok(
  has_column_privilege(
    'service_role',
    'public.subscriptions',
    'id',
    'SELECT'
  ),
  'service_role can read subscription id'
);

select ok(
  has_column_privilege(
    'service_role',
    'public.subscriptions',
    'user_id',
    'SELECT'
  ),
  'service_role can read subscription user_id'
);

select ok(
  has_column_privilege(
    'service_role',
    'public.subscriptions',
    'status',
    'SELECT'
  ),
  'service_role can read subscription status'
);

select ok(
  has_column_privilege(
    'service_role',
    'public.subscriptions',
    'interval',
    'SELECT'
  ),
  'service_role can read subscription interval'
);

select ok(
  has_column_privilege(
    'service_role',
    'public.subscriptions',
    'current_period_end',
    'SELECT'
  ),
  'service_role can read subscription current_period_end'
);

select ok(
  has_column_privilege(
    'service_role',
    'public.subscriptions',
    'updated_at',
    'SELECT'
  ),
  'service_role can read subscription updated_at'
);

select ok(
  has_column_privilege(
    'authenticated',
    'public.subscriptions',
    'status',
    'SELECT'
  ),
  'authenticated entitlement access remains intact'
);

select ok(
  not has_table_privilege(
    'anon',
    'public.subscriptions',
    'SELECT'
  ),
  'anon does not gain subscription table access'
);

select * from finish();

rollback;
