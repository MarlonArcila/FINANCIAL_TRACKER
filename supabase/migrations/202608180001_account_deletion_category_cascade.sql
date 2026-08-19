begin;

-- Allow categories to be deleted only when their owning auth user is being
-- deleted. Direct mutation of system categories remains forbidden.
create or replace function private.protect_category_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  /*
   * During ON DELETE CASCADE from auth.users, the parent user has already
   * disappeared from auth.users when the child DELETE trigger runs.
   *
   * This narrowly permits the owner-deletion cascade without making system
   * categories directly deletable.
   */
  if tg_op = 'DELETE'
    and old.user_id is not null
    and not exists (
      select 1
      from auth.users u
      where u.id = old.user_id
    )
  then
    return old;
  end if;

  /*
   * System categories remain immutable while their owning user still exists.
   * This applies to direct DELETE and UPDATE operations.
   */
  if old.is_system then
    raise exception 'SYSTEM_CATEGORY_IMMUTABLE'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id
      or new.is_system is distinct from old.is_system
    then
      raise exception 'CATEGORY_OWNERSHIP_IMMUTABLE'
        using errcode = '42501';
    end if;

    if new.kind is distinct from old.kind and (
      exists (
        select 1
        from public.transactions t
        where t.category_id = old.id
      )
      or exists (
        select 1
        from public.goals g
        where g.category_id = old.id
      )
      or exists (
        select 1
        from public.investments i
        where i.category_id = old.id
      )
      or exists (
        select 1
        from public.categorization_rules r
        where r.category_id = old.id
      )
      or exists (
        select 1
        from public.budget_items b
        where b.category_id = old.id
      )
    ) then
      raise exception 'CATEGORY_KIND_IN_USE'
        using errcode = 'P0001';
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    if exists (
      select 1
      from public.transactions t
      where t.category_id = old.id
    )
      or exists (
        select 1
        from public.goals g
        where g.category_id = old.id
      )
      or exists (
        select 1
        from public.investments i
        where i.category_id = old.id
      )
      or exists (
        select 1
        from public.categorization_rules r
        where r.category_id = old.id
      )
      or exists (
        select 1
        from public.budget_items b
        where b.category_id = old.id
      )
    then
      raise exception 'CATEGORY_IN_USE'
        using errcode = 'P0001';
    end if;

    return old;
  end if;

  return old;
end;
$function$;

comment on function private.protect_category_mutation()
is
  'Protects category ownership and system categories while allowing deletion '
  'during the ON DELETE CASCADE of the owning auth user.';

commit;
