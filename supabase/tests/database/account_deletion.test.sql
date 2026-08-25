begin;

select plan(9);

insert into auth.users(id, email)
values (
  '00000000-0000-4000-8000-000000000099',
  'account-deletion-cascade@example.invalid'
);

select ok(
  exists (
    select 1
    from auth.users u
    where u.id = '00000000-0000-4000-8000-000000000099'
  ),
  'fixture auth user exists'
);

select ok(
  exists (
    select 1
    from public.profiles p
    where p.id = '00000000-0000-4000-8000-000000000099'
  ),
  'profile was created for the fixture user'
);

select ok(
  exists (
    select 1
    from public.categories c
    where c.user_id = '00000000-0000-4000-8000-000000000099'
      and c.is_system = true
  ),
  'system categories were created for the fixture user'
);

select throws_ok(
  $$
    delete from public.categories
    where id = (
      select c.id
      from public.categories c
      where c.user_id = '00000000-0000-4000-8000-000000000099'
        and c.is_system = true
      order by c.id
      limit 1
    )
  $$,
  '42501',
  'SYSTEM_CATEGORY_IMMUTABLE',
  'direct deletion of a system category remains blocked'
);

select throws_ok(
  $$
    update public.categories
    set name = name
    where id = (
      select c.id
      from public.categories c
      where c.user_id = '00000000-0000-4000-8000-000000000099'
        and c.is_system = true
      order by c.id
      limit 1
    )
  $$,
  '42501',
  'SYSTEM_CATEGORY_IMMUTABLE',
  'direct update of a system category remains blocked'
);

select lives_ok(
  $$
    delete from auth.users
    where id = '00000000-0000-4000-8000-000000000099'
  $$,
  'deleting the auth user cascades through its protected categories'
);

select is(
  (
    select count(*)::integer
    from auth.users u
    where u.id = '00000000-0000-4000-8000-000000000099'
  ),
  0,
  'auth user was deleted'
);

select is(
  (
    select count(*)::integer
    from public.profiles p
    where p.id = '00000000-0000-4000-8000-000000000099'
  ),
  0,
  'profile was deleted by cascade'
);

select is(
  (
    select count(*)::integer
    from public.categories c
    where c.user_id = '00000000-0000-4000-8000-000000000099'
  ),
  0,
  'all user categories were deleted by cascade'
);

select * from finish();

rollback;
