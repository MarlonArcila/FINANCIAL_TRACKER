begin;
select plan(12);
insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-000000000091', 'watch-a@example.invalid'),
  ('00000000-0000-4000-8000-000000000092', 'watch-b@example.invalid'),
  ('00000000-0000-4000-8000-000000000093', 'watch-c@example.invalid');
insert into public.source_connections(id, user_id, provider, status, watch_expires_at) values
  ('00000000-0000-4000-8000-000000000191', '00000000-0000-4000-8000-000000000091', 'gmail', 'active', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-000000000192', '00000000-0000-4000-8000-000000000092', 'outlook', 'active', now() + interval '3 days'),
  ('00000000-0000-4000-8000-000000000193', '00000000-0000-4000-8000-000000000093', 'gmail', 'revoked', NULL);

set local role service_role;
select is((select count(*)::integer from public.claim_mail_watch_connections(10, 300)), 1, 'eligible connection is claimed');
reset role;
select ok((select lease_token is not null from private.mail_watch_renewal_leases where connection_id = '00000000-0000-4000-8000-000000000191'), 'watch lease token generated');
select ok((select claimed_at is not null from private.mail_watch_renewal_leases where connection_id = '00000000-0000-4000-8000-000000000191'), 'watch claimed_at exists');
select ok((select lease_expires_at > now() from private.mail_watch_renewal_leases where connection_id = '00000000-0000-4000-8000-000000000191'), 'watch lease expires in future');
set local role service_role;
select is((select count(*)::integer from public.claim_mail_watch_connections(10, 300)), 0, 'active watch lease is not stolen');
select ok(not public.release_mail_watch_lease('00000000-0000-4000-8000-000000000191', gen_random_uuid()), 'wrong token does not release watch');
reset role;
select set_config('test.watch_token', (select lease_token::text from private.mail_watch_renewal_leases where connection_id = '00000000-0000-4000-8000-000000000191'), true);
set local role service_role;
select set_config('test.watch_release', public.release_mail_watch_lease('00000000-0000-4000-8000-000000000191', current_setting('test.watch_token')::uuid)::text, true);
reset role;
select ok(current_setting('test.watch_release') = 'true' and not exists (select 1 from private.mail_watch_renewal_leases where connection_id = '00000000-0000-4000-8000-000000000191'), 'correct token releases watch');
set local role service_role;
select is((select count(*)::integer from public.claim_mail_watch_connections(10, 300)), 1, 'released connection can be claimed again');
reset role;
update private.mail_watch_renewal_leases set lease_expires_at = now() - interval '1 second' where connection_id = '00000000-0000-4000-8000-000000000191';
set local role service_role;
select is((select count(*)::integer from public.claim_mail_watch_connections(10, 300)), 1, 'expired watch lease is recoverable');
reset role;
select ok(not exists (select 1 from private.mail_watch_renewal_leases where connection_id = '00000000-0000-4000-8000-000000000192'), 'future watch is not eligible');
select set_config('test.watch_token', (select lease_token::text from private.mail_watch_renewal_leases where connection_id = '00000000-0000-4000-8000-000000000191'), true);
set local role service_role;
select set_config('test.watch_release', public.release_mail_watch_lease('00000000-0000-4000-8000-000000000191', current_setting('test.watch_token')::uuid)::text, true);
reset role;
select ok(current_setting('test.watch_release') = 'true' and not exists (select 1 from private.mail_watch_renewal_leases where connection_id = '00000000-0000-4000-8000-000000000191'), 'recovered watch can be released');
update public.source_connections set status = 'revoked' where id in ('00000000-0000-4000-8000-000000000191','00000000-0000-4000-8000-000000000192','00000000-0000-4000-8000-000000000193');
set local role service_role;
select is((select count(*)::integer from public.claim_mail_watch_connections(10,300)),0,'no eligible connections return zero claims');
reset role;
select * from finish();
rollback;
