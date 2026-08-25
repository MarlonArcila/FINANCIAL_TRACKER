begin;

-- Required by Gmail ingestion because source_events uses
-- INSERT ... ON CONFLICT DO UPDATE through PostgREST upsert.
--
-- service_role remains backend-only.
-- DELETE remains intentionally denied.

grant update
on table public.source_events
to service_role;

notify pgrst, 'reload schema';

commit;
