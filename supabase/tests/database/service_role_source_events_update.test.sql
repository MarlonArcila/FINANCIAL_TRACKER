begin;

select plan(2);

select ok(
  has_table_privilege(
    'service_role',
    'public.source_events',
    'UPDATE'
  ),
  'service_role can update source events for upsert'
);

select ok(
  not has_table_privilege(
    'service_role',
    'public.source_events',
    'DELETE'
  ),
  'service_role still cannot delete source events'
);

select * from finish();

rollback;
