begin;

-- Server-side Gmail integration lifecycle.
-- service_role is only available inside trusted backend functions.
-- OAuth tokens remain in private.oauth_credentials.

grant select, insert, update, delete
on table public.source_connections
to service_role;

notify pgrst, 'reload schema';

commit;
