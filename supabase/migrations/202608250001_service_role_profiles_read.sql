begin;

-- Required by mail-sync-worker to resolve the user's base currency.
-- service_role remains backend-only.

grant select (
  id,
  base_currency
)
on table public.profiles
to service_role;

notify pgrst, 'reload schema';

commit;
