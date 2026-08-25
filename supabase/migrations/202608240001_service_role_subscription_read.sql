begin;

-- CapitalFlow server-side Edge Functions must validate entitlement.
-- The service_role credential is never exposed to the client.
--
-- Only the columns required by assertEntitled() and
-- assertAnnualEntitled() are granted.

grant select (
  id,
  user_id,
  status,
  interval,
  current_period_end,
  updated_at
)
on table public.subscriptions
to service_role;

notify pgrst, 'reload schema';

commit;
