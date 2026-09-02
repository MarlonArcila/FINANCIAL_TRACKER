begin;

select plan(13);

select ok(
  has_table_privilege('service_role', 'public.account_assignment_rules', 'SELECT'),
  'service_role can read account assignment rules'
);
select ok(
  has_table_privilege('service_role', 'public.account_assignment_rules', 'INSERT'),
  'service_role can insert learned account assignment rules'
);
select ok(
  has_table_privilege('service_role', 'public.account_assignment_rules', 'UPDATE'),
  'service_role can update learned account assignment rules'
);
select ok(
  not has_table_privilege('service_role', 'public.account_assignment_rules', 'DELETE'),
  'service_role cannot delete account assignment rules'
);

select ok(
  has_table_privilege('service_role', 'public.categorization_rules', 'SELECT'),
  'service_role can read categorization rules'
);
select ok(
  has_table_privilege('service_role', 'public.categorization_rules', 'INSERT'),
  'service_role can insert learned categorization rules'
);
select ok(
  has_table_privilege('service_role', 'public.categorization_rules', 'UPDATE'),
  'service_role can update learned categorization rules'
);
select ok(
  not has_table_privilege('service_role', 'public.categorization_rules', 'DELETE'),
  'service_role cannot delete categorization rules'
);

select ok(
  (select prosecdef from pg_proc where oid = 'public.accept_transaction_candidate(uuid,uuid,uuid,jsonb)'::regprocedure),
  'accept_transaction_candidate remains SECURITY DEFINER'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.accept_transaction_candidate(uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'authenticated can execute accept_transaction_candidate'
);
select ok(
  strpos(
    pg_get_functiondef('public.accept_transaction_candidate(uuid,uuid,uuid,jsonb)'::regprocedure),
    'v_candidate.status <> ''pending'''
  ) > 0,
  'accept RPC explicitly handles resolved candidates'
);
select ok(
  strpos(
    pg_get_functiondef('public.accept_transaction_candidate(uuid,uuid,uuid,jsonb)'::regprocedure),
    'source_candidate_id = p_candidate_id'
  ) > 0,
  'accept RPC can recover the transaction created by a previous successful attempt'
);
select ok(
  strpos(
    pg_get_functiondef('public.accept_transaction_candidate(uuid,uuid,uuid,jsonb)'::regprocedure),
    'return v_transaction_id'
  ) > 0,
  'accept RPC returns the existing transaction id on an idempotent retry'
);

select * from finish();
rollback;
