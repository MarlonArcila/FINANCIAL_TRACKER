begin;

-- Personal categories may be renamed or removed by their owner, but system
-- categories are immutable. Changing a category kind or deleting a category
-- that is already referenced could corrupt the meaning of historical data, so
-- those destructive operations are rejected until the user reassigns the data.
create or replace function private.protect_category_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if old.is_system then
    raise exception 'SYSTEM_CATEGORY_IMMUTABLE'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id or new.is_system is distinct from old.is_system then
      raise exception 'CATEGORY_OWNERSHIP_IMMUTABLE'
        using errcode = '42501';
    end if;

    if new.kind is distinct from old.kind and (
      exists (select 1 from public.transactions t where t.category_id = old.id)
      or exists (select 1 from public.goals g where g.category_id = old.id)
      or exists (select 1 from public.investments i where i.category_id = old.id)
      or exists (select 1 from public.categorization_rules r where r.category_id = old.id)
      or exists (select 1 from public.budget_items b where b.category_id = old.id)
    ) then
      raise exception 'CATEGORY_KIND_IN_USE'
        using errcode = 'P0001';
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    if exists (select 1 from public.transactions t where t.category_id = old.id)
      or exists (select 1 from public.goals g where g.category_id = old.id)
      or exists (select 1 from public.investments i where i.category_id = old.id)
      or exists (select 1 from public.categorization_rules r where r.category_id = old.id)
      or exists (select 1 from public.budget_items b where b.category_id = old.id)
    then
      raise exception 'CATEGORY_IN_USE'
        using errcode = 'P0001';
    end if;

    return old;
  end if;

  return old;
end;
$$;

revoke all on function private.protect_category_mutation() from public, anon, authenticated;
grant execute on function private.protect_category_mutation() to service_role;

drop trigger if exists protect_category_mutation_on_write on public.categories;
create trigger protect_category_mutation_on_write
before update or delete on public.categories
for each row
execute function private.protect_category_mutation();

commit;
