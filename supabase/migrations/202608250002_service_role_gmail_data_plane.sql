begin;

-- Gmail ingestion data-plane permissions.
-- service_role is backend-only.
--
-- Keep privileges limited to the operations actually performed by
-- ingestion.ts and automation.ts.

grant select, insert, update
on table public.transaction_candidates
to service_role;

grant select, insert
on table public.source_events
to service_role;

grant select
on table
  public.onboarding_state,
  public.financial_preferences,
  public.account_assignment_rules,
  public.accounts,
  public.categorization_rules,
  public.categories
to service_role;

notify pgrst, 'reload schema';

commit;
