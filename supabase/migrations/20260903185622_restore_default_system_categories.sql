begin;

create or replace function private.ensure_default_system_categories(p_user_id uuid)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  v_inserted integer := 0;
begin
  insert into public.categories(user_id, name, kind, icon, is_system)
  values
    (p_user_id, 'Salario', 'income', '↗', true),
    (p_user_id, 'Otros ingresos', 'income', '+', true),
    (p_user_id, 'Alimentación', 'expense', '◉', true),
    (p_user_id, 'Vivienda', 'expense', '⌂', true),
    (p_user_id, 'Transporte', 'expense', '→', true),
    (p_user_id, 'Salud', 'expense', '+', true),
    (p_user_id, 'Educación', 'expense', '□', true),
    (p_user_id, 'Entretenimiento', 'expense', '◇', true),
    (p_user_id, 'Otros', 'mixed', '•', true)
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

alter function private.ensure_default_system_categories(uuid) owner to postgres;
revoke all on function private.ensure_default_system_categories(uuid) from public, anon, authenticated, service_role;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $function$
begin
  insert into public.profiles(id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;

  insert into public.financial_preferences(user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  perform private.ensure_default_system_categories(new.id);
  return new;
end;
$function$;

alter function private.handle_new_user() owner to postgres;
revoke all on function private.handle_new_user() from public, anon, authenticated, service_role;

select private.ensure_default_system_categories(u.id)
from auth.users u;

notify pgrst, 'reload schema';
commit;
