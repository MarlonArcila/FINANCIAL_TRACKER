-- CapitalFlow: allow transaction-confirm's backend service client to maintain
-- onboarding review progress without granting broader onboarding-state writes.
-- Required operations in recordOnboardingAssociation(): SELECT + UPDATE only.

begin;

grant select, update
on table public.onboarding_state
  to service_role;

revoke insert, delete
on table public.onboarding_state
  from service_role;

notify pgrst, 'reload schema';

commit;
