begin;

select plan(13);

-- First prove the production trigger still provisions a normal new user.
insert into auth.users(id, email)
values ('00000000-0000-4000-8000-000000009302', 'category-future@example.invalid');
select is(
  (select count(*)::integer from public.categories
   where user_id = '00000000-0000-4000-8000-000000009302' and is_system),
  9,
  'new-user trigger provisions the nine canonical defaults'
);

-- Simulate a legacy user created before category provisioning existed. Replacing
-- the trigger function is transaction-local because the test rolls back; unlike
-- ALTER TABLE auth.users, this does not require ownership of the Auth table.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $fixture$
begin
  return new;
end;
$fixture$;

insert into auth.users(id, email)
values ('00000000-0000-4000-8000-000000009301', 'category-recovery@example.invalid');

select is(
  (select count(*)::integer from public.categories
   where user_id = '00000000-0000-4000-8000-000000009301'),
  0,
  'legacy fixture starts without default categories'
);

select is(
  private.ensure_default_system_categories('00000000-0000-4000-8000-000000009301'),
  9,
  'recovery inserts the nine canonical default categories'
);

select is(
  (select count(*)::integer from public.categories
   where user_id = '00000000-0000-4000-8000-000000009301'),
  9,
  'recovered user has nine categories'
);
select is(
  (select count(*)::integer from public.categories
   where user_id = '00000000-0000-4000-8000-000000009301' and is_system),
  9,
  'all recovered defaults are system categories'
);
select is(
  (select count(*)::integer from public.categories
   where user_id = '00000000-0000-4000-8000-000000009301' and kind = 'expense'),
  6,
  'six expense defaults are restored'
);
select is(
  (select count(*)::integer from public.categories
   where user_id = '00000000-0000-4000-8000-000000009301' and kind = 'income'),
  2,
  'two income defaults are restored'
);
select is(
  (select count(*)::integer from public.categories
   where user_id = '00000000-0000-4000-8000-000000009301' and kind = 'mixed'),
  1,
  'one mixed default is restored'
);
select is(
  (select count(*)::integer from public.categories
   where user_id = '00000000-0000-4000-8000-000000009301'
     and (
       name = any(array['Salario','Otros ingresos','Vivienda','Transporte','Salud','Entretenimiento','Otros'])
       or name like 'Alimentaci%'
       or name like 'Educaci%'
     )),
  9,
  'canonical default names are present'
);

select is(
  private.ensure_default_system_categories('00000000-0000-4000-8000-000000009301'),
  0,
  'recovery is idempotent'
);

select ok(
  not has_function_privilege('authenticated', 'private.ensure_default_system_categories(uuid)', 'EXECUTE'),
  'authenticated cannot execute recovery helper'
);
select ok(
  not has_function_privilege('service_role', 'private.ensure_default_system_categories(uuid)', 'EXECUTE'),
  'service_role cannot execute recovery helper'
);

select throws_ok(
  $$update public.categories set name = 'mutated' where id = (
      select id from public.categories
      where user_id = '00000000-0000-4000-8000-000000009301' and is_system limit 1
    )$$,
  '42501',
  'SYSTEM_CATEGORY_IMMUTABLE',
  'recovered system categories remain immutable'
);

select * from finish();
rollback;
