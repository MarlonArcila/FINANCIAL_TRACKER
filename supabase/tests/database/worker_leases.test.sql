begin;
select plan(21);

insert into auth.users(id, email) values
 ('00000000-0000-4000-8000-000000000081','lease-test@example.invalid'),
 ('00000000-0000-4000-8000-000000000082','lease-job2@example.invalid'),
 ('00000000-0000-4000-8000-000000000083','lease-old@example.invalid'),
 ('00000000-0000-4000-8000-000000000084','lease-recent@example.invalid'),
 ('00000000-0000-4000-8000-000000000085','lease-null@example.invalid');
insert into public.source_connections(id,user_id,provider,status) values
 ('00000000-0000-4000-8000-000000000181','00000000-0000-4000-8000-000000000081','gmail','active'),
 ('00000000-0000-4000-8000-000000000182','00000000-0000-4000-8000-000000000082','gmail','active'),
 ('00000000-0000-4000-8000-000000000183','00000000-0000-4000-8000-000000000083','gmail','active'),
 ('00000000-0000-4000-8000-000000000184','00000000-0000-4000-8000-000000000084','gmail','active'),
 ('00000000-0000-4000-8000-000000000185','00000000-0000-4000-8000-000000000085','gmail','active');
insert into private.sync_jobs(id,connection_id,provider,status) values
 ('00000000-0000-4000-8000-000000000281','00000000-0000-4000-8000-000000000181','gmail','queued');

set local role service_role;
select is((select count(*)::integer from public.claim_mail_sync_jobs(1,'00000000-0000-4000-8000-000000000181',300)),1,'queued job is claimed');
reset role;
select ok((select status='running' from private.sync_jobs where id='00000000-0000-4000-8000-000000000281'),'claim changes status');
select ok((select lease_token is not null from private.sync_jobs where id='00000000-0000-4000-8000-000000000281'),'claim creates token');
select ok((select claimed_at is not null from private.sync_jobs where id='00000000-0000-4000-8000-000000000281'),'claim sets claimed_at');
select ok((select lease_expires_at > now() from private.sync_jobs where id='00000000-0000-4000-8000-000000000281'),'claim sets future lease');
set local role service_role;
select is((select count(*)::integer from public.claim_mail_sync_jobs(1,'00000000-0000-4000-8000-000000000181',300)),0,'active lease is not stolen');
reset role;
update private.sync_jobs set lease_expires_at=now()-interval '1 second' where id='00000000-0000-4000-8000-000000000281';
set local role service_role;
select is((select count(*)::integer from public.claim_mail_sync_jobs(1,'00000000-0000-4000-8000-000000000181',300)),1,'expired lease is recoverable');
select ok(not public.finish_mail_sync_job('00000000-0000-4000-8000-000000000281',gen_random_uuid(),'succeeded'),'wrong token cannot finish');
reset role;
select set_config('test.worker_token',(select lease_token::text from private.sync_jobs where id='00000000-0000-4000-8000-000000000281'),true);
set local role service_role;
select ok(public.finish_mail_sync_job('00000000-0000-4000-8000-000000000281',current_setting('test.worker_token')::uuid,'succeeded'),'correct token finishes');
reset role;
select ok((select status='succeeded' and lease_token is null and lease_expires_at is null from private.sync_jobs where id='00000000-0000-4000-8000-000000000281'),'succeeded clears lease');
set local role service_role;
select ok(not public.finish_mail_sync_job('00000000-0000-4000-8000-000000000281',gen_random_uuid(),'failed'),'job cannot finish twice');
reset role;

insert into private.sync_jobs(id,connection_id,provider,status) values
 ('00000000-0000-4000-8000-000000000285','00000000-0000-4000-8000-000000000182','gmail','queued');
select ok(exists(select 1 from private.sync_jobs where id='00000000-0000-4000-8000-000000000285'),'independent queued job exists');
select ok((select status='queued' from private.sync_jobs where id='00000000-0000-4000-8000-000000000285'),'independent job starts queued');
set local role service_role;
select is((select count(*)::integer from public.claim_mail_sync_jobs(1,'00000000-0000-4000-8000-000000000182',300)),1,'independent queued job is claimed');
reset role;
select ok((select status='running' from private.sync_jobs where id='00000000-0000-4000-8000-000000000285'),'independent job becomes running');
select ok((select lease_token is not null from private.sync_jobs where id='00000000-0000-4000-8000-000000000285'),'independent job gets lease token');
select set_config('test.worker_token',(select lease_token::text from private.sync_jobs where id='00000000-0000-4000-8000-000000000285'),true);
set local role service_role;
select ok(public.finish_mail_sync_job('00000000-0000-4000-8000-000000000285',current_setting('test.worker_token')::uuid,'failed'),'failed job finishes');
reset role;
select ok((select status='failed' and lease_token is null and lease_expires_at is null from private.sync_jobs where id='00000000-0000-4000-8000-000000000285'),'failed clears lease');

insert into private.sync_jobs(id,connection_id,provider,status,started_at) values
 ('00000000-0000-4000-8000-000000000282','00000000-0000-4000-8000-000000000183','gmail','running',now()-interval '11 minutes'),
 ('00000000-0000-4000-8000-000000000283','00000000-0000-4000-8000-000000000184','gmail','running',now()-interval '1 minute'),
 ('00000000-0000-4000-8000-000000000284','00000000-0000-4000-8000-000000000185','gmail','running',NULL);
set local role service_role;
select is((select count(*)::integer from public.claim_mail_sync_jobs(3,'00000000-0000-4000-8000-000000000183',300)),1,'only old legacy running job is recovered');
reset role;
select ok((select status='running' from private.sync_jobs where id='00000000-0000-4000-8000-000000000283'),'recent legacy job remains running');
select ok((select status='running' and started_at is null from private.sync_jobs where id='00000000-0000-4000-8000-000000000284'),'untimestamped legacy job remains running');
select * from finish();
rollback;
