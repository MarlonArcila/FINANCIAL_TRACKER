begin;

select plan(11);

select ok(
  has_table_privilege(
    'service_role',
    'public.transaction_candidates',
    'SELECT'
  ),
  'service_role can select transaction candidates'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.transaction_candidates',
    'INSERT'
  ),
  'service_role can insert transaction candidates'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.transaction_candidates',
    'UPDATE'
  ),
  'service_role can update transaction candidates'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.source_events',
    'SELECT'
  ),
  'service_role can select source events'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.source_events',
    'INSERT'
  ),
  'service_role can insert source events'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.onboarding_state',
    'SELECT'
  ),
  'service_role can read onboarding state'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.financial_preferences',
    'SELECT'
  ),
  'service_role can read financial preferences'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.account_assignment_rules',
    'SELECT'
  ),
  'service_role can read account assignment rules'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.accounts',
    'SELECT'
  ),
  'service_role can read accounts'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.categorization_rules',
    'SELECT'
  ),
  'service_role can read categorization rules'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.categories',
    'SELECT'
  ),
  'service_role can read categories'
);

select * from finish();

rollback;
