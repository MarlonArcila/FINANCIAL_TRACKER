begin;
select plan(25);

insert into auth.users(id, email) values
 ('00000000-0000-4000-8000-000000000082','backup-active@example.invalid'),
 ('00000000-0000-4000-8000-000000000083','backup-trial@example.invalid'),
 ('00000000-0000-4000-8000-000000000084','backup-weekly@example.invalid'),
 ('00000000-0000-4000-8000-000000000085','backup-canceled@example.invalid'),
 ('00000000-0000-4000-8000-000000000086','backup-expired@example.invalid');
insert into public.subscriptions(id,user_id,interval,status,current_period_end) values
 ('00000000-0000-4000-8000-000000000382','00000000-0000-4000-8000-000000000082','annual','active',now()+interval '1 day'),
 ('00000000-0000-4000-8000-000000000383','00000000-0000-4000-8000-000000000083','annual','trialing',now()+interval '1 day'),
 ('00000000-0000-4000-8000-000000000384','00000000-0000-4000-8000-000000000084','weekly','active',now()+interval '1 day'),
 ('00000000-0000-4000-8000-000000000385','00000000-0000-4000-8000-000000000085','annual','canceled',now()+interval '1 day'),
 ('00000000-0000-4000-8000-000000000386','00000000-0000-4000-8000-000000000086','annual','active',now()-interval '1 second');
insert into public.storage_connections(id,user_id,provider,status,backup_frequency,next_backup_at) values
 ('00000000-0000-4000-8000-000000000482','00000000-0000-4000-8000-000000000082','google_drive','active','weekly',now()-interval '1 hour'),
 ('00000000-0000-4000-8000-000000000483','00000000-0000-4000-8000-000000000083','google_drive','active','daily',now()-interval '2 hours'),
 ('00000000-0000-4000-8000-000000000484','00000000-0000-4000-8000-000000000084','google_drive','active','weekly',now()-interval '3 hours'),
 ('00000000-0000-4000-8000-000000000485','00000000-0000-4000-8000-000000000085','google_drive','active','weekly',now()-interval '4 hours'),
 ('00000000-0000-4000-8000-000000000486','00000000-0000-4000-8000-000000000086','google_drive','active','weekly',now()-interval '5 hours');

set local role service_role;
select is((select count(*)::integer from public.claim_cloud_backup_runs(5,600)),2,'annual active and trialing claims');
reset role;
select ok(exists(select 1 from private.backup_runs where storage_connection_id='00000000-0000-4000-8000-000000000482'),'annual active run exists');
select ok(exists(select 1 from private.backup_runs where storage_connection_id='00000000-0000-4000-8000-000000000483'),'annual trialing run exists');
select ok(not exists(select 1 from private.backup_runs where storage_connection_id in ('00000000-0000-4000-8000-000000000484','00000000-0000-4000-8000-000000000485','00000000-0000-4000-8000-000000000486')),'weekly canceled and expired do not claim');

select ok((select count(*)=2 from private.backup_runs),'backup runs are created');
select ok((select id::text ~ '^[0-9a-f-]{36}$' from private.backup_runs where storage_connection_id='00000000-0000-4000-8000-000000000482'),'run id is UUID-shaped');
select ok((select scheduled_for=(select next_backup_at from public.storage_connections where id='00000000-0000-4000-8000-000000000482') from private.backup_runs where storage_connection_id='00000000-0000-4000-8000-000000000482'),'scheduled_for preserves logical period');
select ok((select lease_expires_at > claimed_at + interval '9 minutes' and lease_expires_at <= claimed_at + interval '11 minutes' from private.backup_runs where storage_connection_id='00000000-0000-4000-8000-000000000482'),'lease is approximately 600 seconds');
set local role service_role;
select is((select count(*)::integer from public.claim_cloud_backup_runs(5,600)),0,'active backup leases are not stolen');
reset role;
update private.backup_runs set lease_expires_at=now()-interval '1 second' where storage_connection_id='00000000-0000-4000-8000-000000000482';
set local role service_role;
select is((select count(*)::integer from public.claim_cloud_backup_runs(5,600)),1,'expired backup lease is recoverable');
reset role;
select ok((select count(*)=1 from private.backup_runs where storage_connection_id='00000000-0000-4000-8000-000000000482'),'retry reuses one logical run');
select ok((select count(*)=1 from private.backup_runs where storage_connection_id='00000000-0000-4000-8000-000000000482' and scheduled_for=(select next_backup_at from public.storage_connections where id='00000000-0000-4000-8000-000000000482')),'same connection and schedule do not create second run');
reset role;
select set_config('test.backup_run_id',(select id::text from private.backup_runs where storage_connection_id='00000000-0000-4000-8000-000000000482'),true);
set local role service_role;
select ok(not public.finish_cloud_backup_run(current_setting('test.backup_run_id')::uuid,gen_random_uuid(),'succeeded',null,null,null,now()+interval '7 days'),'wrong token cannot finish');
reset role;
select set_config('test.backup_run_id',(select id::text from private.backup_runs where storage_connection_id='00000000-0000-4000-8000-000000000482'),true);
select set_config('test.backup_token',(select lease_token::text from private.backup_runs where storage_connection_id='00000000-0000-4000-8000-000000000482'),true);
select set_config('test.backup_next_before',(select next_backup_at::text from public.storage_connections where id='00000000-0000-4000-8000-000000000482'),true);
select set_config('test.backup_last_before',coalesce((select last_backup_at::text from public.storage_connections where id='00000000-0000-4000-8000-000000000482'),''),true);
set local role service_role;
select set_config('test.backup_failed',public.finish_cloud_backup_run(current_setting('test.backup_run_id')::uuid,current_setting('test.backup_token')::uuid,'failed',null,null,'upload_failed',null)::text,true);
reset role;
select ok(current_setting('test.backup_failed')='true','failed finish works');
select ok((select status='failed' from private.backup_runs where storage_connection_id='00000000-0000-4000-8000-000000000482'),'failed status persists');
select ok((select lease_token is null and lease_expires_at is null from private.backup_runs where storage_connection_id='00000000-0000-4000-8000-000000000482'),'failed lease is clean');
select ok((select next_backup_at from public.storage_connections where id='00000000-0000-4000-8000-000000000482') = current_setting('test.backup_next_before')::timestamptz,'failed finish does not advance schedule');
select ok(coalesce((select last_backup_at::text from public.storage_connections where id='00000000-0000-4000-8000-000000000482'),'') = current_setting('test.backup_last_before'),'failed finish does not mark success');
set local role service_role;
select is((select count(*)::integer from public.claim_cloud_backup_runs(5,600)),1,'failed run is retryable');
reset role;
select set_config('test.backup_run_id',(select id::text from private.backup_runs where storage_connection_id='00000000-0000-4000-8000-000000000482'),true);
select set_config('test.backup_token',(select lease_token::text from private.backup_runs where storage_connection_id='00000000-0000-4000-8000-000000000482'),true);
select set_config('test.backup_next_before_success',(select next_backup_at::text from public.storage_connections where id='00000000-0000-4000-8000-000000000482'),true);
set local role service_role;
select set_config('test.backup_success',public.finish_cloud_backup_run(current_setting('test.backup_run_id')::uuid,current_setting('test.backup_token')::uuid,'succeeded','remote-id','remote-name',null,now()+interval '7 days')::text,true);
reset role;
select ok(current_setting('test.backup_success')='true','successful finish works');
select set_config('test.backup_next_after_success',(select next_backup_at::text from public.storage_connections where id='00000000-0000-4000-8000-000000000482'),true);
select ok((select next_backup_at from public.storage_connections where id='00000000-0000-4000-8000-000000000482') > current_setting('test.backup_next_before_success')::timestamptz,'success advances schedule');
select ok((select last_backup_at is not null from public.storage_connections where id='00000000-0000-4000-8000-000000000482'),'success updates last_backup_at');
set local role service_role;
select ok(not public.finish_cloud_backup_run(current_setting('test.backup_run_id')::uuid,gen_random_uuid(),'succeeded','other','other',null,now()+interval '14 days'),'second finish is rejected');
reset role;
select ok((select next_backup_at from public.storage_connections where id='00000000-0000-4000-8000-000000000482') = current_setting('test.backup_next_after_success')::timestamptz,'second finish does not advance schedule');
select ok(exists(select 1 from pg_constraint c where c.conrelid='public.cloud_backups'::regclass and c.contype='u' and c.conkey=ARRAY[(select attnum from pg_attribute where attrelid='public.cloud_backups'::regclass and attname='backup_run_id')]::smallint[]),'backup_run_id has structural uniqueness');
select * from finish();
rollback;
