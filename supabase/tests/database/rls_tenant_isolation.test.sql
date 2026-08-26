begin;

select plan(7);

insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-000000001301', 'rls-a@example.invalid'),
  ('00000000-0000-4000-8000-000000001302', 'rls-b@example.invalid');

insert into public.subscriptions(user_id, provider, provider_membership_id, interval, status, current_period_end)
values
  ('00000000-0000-4000-8000-000000001301', 'whop', 'rls-a', 'weekly', 'active', now() + interval '1 day'),
  ('00000000-0000-4000-8000-000000001302', 'whop', 'rls-b', 'weekly', 'active', now() + interval '1 day');

insert into public.accounts(id, user_id, name, type, currency) values
  ('00000000-0000-4000-8000-000000001311', '00000000-0000-4000-8000-000000001301', 'A account', 'checking', 'COP'),
  ('00000000-0000-4000-8000-000000001312', '00000000-0000-4000-8000-000000001302', 'B account', 'checking', 'COP');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001301', true);

select is(
  (select count(*)::integer from public.accounts where id = '00000000-0000-4000-8000-000000001311'),
  1,
  'tenant A can read its own account'
);

select is(
  (select count(*)::integer from public.accounts where id = '00000000-0000-4000-8000-000000001312'),
  0,
  'tenant A cannot read tenant B account'
);

select is(
  (with changed as (
    update public.accounts set name = 'blocked cross-tenant update'
    where id = '00000000-0000-4000-8000-000000001312' returning 1
  ) select count(*)::integer from changed),
  0,
  'tenant A cannot update tenant B account'
);

select is(
  (with deleted as (
    delete from public.accounts
    where id = '00000000-0000-4000-8000-000000001312' returning 1
  ) select count(*)::integer from deleted),
  0,
  'tenant A cannot delete tenant B account'
);

select throws_ok(
  $$
    insert into public.accounts(user_id, name, type, currency)
    values ('00000000-0000-4000-8000-000000001302', 'forbidden insert', 'checking', 'COP')
  $$,
  '42501',
  'new row violates row-level security policy for table "accounts"',
  'tenant A cannot insert a row owned by tenant B'
);

select lives_ok(
  $$
    insert into public.accounts(user_id, name, type, currency)
    values ('00000000-0000-4000-8000-000000001301', 'allowed insert', 'checking', 'COP')
  $$,
  'tenant A can insert its own account with an active subscription'
);

select is(
  (select count(*)::integer from public.profiles where id = '00000000-0000-4000-8000-000000001302'),
  0,
  'tenant A cannot read tenant B profile'
);

select * from finish();
rollback;
