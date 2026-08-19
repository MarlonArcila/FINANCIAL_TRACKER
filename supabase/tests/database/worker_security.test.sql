begin;
select plan(51);

select ok(to_regprocedure('public.claim_mail_sync_jobs(integer,uuid,integer)') is not null,'claim mail RPC exists');
select ok((select prosecdef from pg_proc where oid='public.claim_mail_sync_jobs(integer,uuid,integer)'::regprocedure),'claim mail is security definer');
select ok((select proconfig @> ARRAY['search_path=pg_catalog, public, private'] from pg_proc where oid='public.claim_mail_sync_jobs(integer,uuid,integer)'::regprocedure),'claim mail has fixed search_path');
select ok(has_function_privilege('service_role','public.claim_mail_sync_jobs(integer,uuid,integer)','EXECUTE'),'service_role can execute claim mail');
select ok(not has_function_privilege('public','public.claim_mail_sync_jobs(integer,uuid,integer)','EXECUTE'),'PUBLIC cannot execute claim mail');
select ok(not has_function_privilege('anon','public.claim_mail_sync_jobs(integer,uuid,integer)','EXECUTE'),'anon cannot execute claim mail');
select ok(not has_function_privilege('authenticated','public.claim_mail_sync_jobs(integer,uuid,integer)','EXECUTE'),'authenticated cannot execute claim mail');

select ok(to_regprocedure('public.finish_mail_sync_job(uuid,uuid,text,text,integer,integer,integer,text)') is not null,'finish mail RPC exists');
select ok((select prosecdef from pg_proc where oid='public.finish_mail_sync_job(uuid,uuid,text,text,integer,integer,integer,text)'::regprocedure),'finish mail is security definer');
select ok((select proconfig @> ARRAY['search_path=pg_catalog, public, private'] from pg_proc where oid='public.finish_mail_sync_job(uuid,uuid,text,text,integer,integer,integer,text)'::regprocedure),'finish mail has fixed search_path');
select ok(has_function_privilege('service_role','public.finish_mail_sync_job(uuid,uuid,text,text,integer,integer,integer,text)','EXECUTE'),'service_role can execute finish mail');
select ok(not has_function_privilege('public','public.finish_mail_sync_job(uuid,uuid,text,text,integer,integer,integer,text)','EXECUTE'),'PUBLIC cannot execute finish mail');
select ok(not has_function_privilege('anon','public.finish_mail_sync_job(uuid,uuid,text,text,integer,integer,integer,text)','EXECUTE'),'anon cannot execute finish mail');
select ok(not has_function_privilege('authenticated','public.finish_mail_sync_job(uuid,uuid,text,text,integer,integer,integer,text)','EXECUTE'),'authenticated cannot execute finish mail');

select ok(to_regprocedure('public.claim_mail_watch_connections(integer,integer)') is not null,'claim watch RPC exists');
select ok((select prosecdef from pg_proc where oid='public.claim_mail_watch_connections(integer,integer)'::regprocedure),'claim watch is security definer');
select ok((select proconfig @> ARRAY['search_path=pg_catalog, public, private'] from pg_proc where oid='public.claim_mail_watch_connections(integer,integer)'::regprocedure),'claim watch has fixed search_path');
select ok(has_function_privilege('service_role','public.claim_mail_watch_connections(integer,integer)','EXECUTE'),'service_role can execute claim watch');
select ok(not has_function_privilege('public','public.claim_mail_watch_connections(integer,integer)','EXECUTE'),'PUBLIC cannot execute claim watch');
select ok(not has_function_privilege('anon','public.claim_mail_watch_connections(integer,integer)','EXECUTE'),'anon cannot execute claim watch');
select ok(not has_function_privilege('authenticated','public.claim_mail_watch_connections(integer,integer)','EXECUTE'),'authenticated cannot execute claim watch');

select ok(to_regprocedure('public.release_mail_watch_lease(uuid,uuid)') is not null,'release watch RPC exists');
select ok((select prosecdef from pg_proc where oid='public.release_mail_watch_lease(uuid,uuid)'::regprocedure),'release watch is security definer');
select ok((select proconfig @> ARRAY['search_path=pg_catalog, public, private'] from pg_proc where oid='public.release_mail_watch_lease(uuid,uuid)'::regprocedure),'release watch has fixed search_path');
select ok(has_function_privilege('service_role','public.release_mail_watch_lease(uuid,uuid)','EXECUTE'),'service_role can execute release watch');
select ok(not has_function_privilege('public','public.release_mail_watch_lease(uuid,uuid)','EXECUTE'),'PUBLIC cannot execute release watch');
select ok(not has_function_privilege('anon','public.release_mail_watch_lease(uuid,uuid)','EXECUTE'),'anon cannot execute release watch');
select ok(not has_function_privilege('authenticated','public.release_mail_watch_lease(uuid,uuid)','EXECUTE'),'authenticated cannot execute release watch');

select ok(to_regprocedure('public.claim_cloud_backup_runs(integer,integer)') is not null,'claim backup RPC exists');
select ok((select prosecdef from pg_proc where oid='public.claim_cloud_backup_runs(integer,integer)'::regprocedure),'claim backup is security definer');
select ok((select proconfig @> ARRAY['search_path=pg_catalog, public, private'] from pg_proc where oid='public.claim_cloud_backup_runs(integer,integer)'::regprocedure),'claim backup has fixed search_path');
select ok(has_function_privilege('service_role','public.claim_cloud_backup_runs(integer,integer)','EXECUTE'),'service_role can execute claim backup');
select ok(not has_function_privilege('public','public.claim_cloud_backup_runs(integer,integer)','EXECUTE'),'PUBLIC cannot execute claim backup');
select ok(not has_function_privilege('anon','public.claim_cloud_backup_runs(integer,integer)','EXECUTE'),'anon cannot execute claim backup');
select ok(not has_function_privilege('authenticated','public.claim_cloud_backup_runs(integer,integer)','EXECUTE'),'authenticated cannot execute claim backup');

select ok(to_regprocedure('public.finish_cloud_backup_run(uuid,uuid,text,text,text,text,timestamptz)') is not null,'finish backup RPC exists');
select ok((select prosecdef from pg_proc where oid='public.finish_cloud_backup_run(uuid,uuid,text,text,text,text,timestamptz)'::regprocedure),'finish backup is security definer');
select ok((select proconfig @> ARRAY['search_path=pg_catalog, public, private'] from pg_proc where oid='public.finish_cloud_backup_run(uuid,uuid,text,text,text,text,timestamptz)'::regprocedure),'finish backup has fixed search_path');
select ok(has_function_privilege('service_role','public.finish_cloud_backup_run(uuid,uuid,text,text,text,text,timestamptz)','EXECUTE'),'service_role can execute finish backup');
select ok(not has_function_privilege('public','public.finish_cloud_backup_run(uuid,uuid,text,text,text,text,timestamptz)','EXECUTE'),'PUBLIC cannot execute finish backup');
select ok(not has_function_privilege('anon','public.finish_cloud_backup_run(uuid,uuid,text,text,text,text,timestamptz)','EXECUTE'),'anon cannot execute finish backup');
select ok(not has_function_privilege('authenticated','public.finish_cloud_backup_run(uuid,uuid,text,text,text,text,timestamptz)','EXECUTE'),'authenticated cannot execute finish backup');

select ok(not has_schema_privilege('anon','private','USAGE'),'anon cannot use private schema');
select ok(not has_schema_privilege('authenticated','private','USAGE'),'authenticated cannot use private schema');
select ok(not has_table_privilege('anon','private.backup_runs','SELECT'),'anon has no direct backup_runs select');
select ok(not has_table_privilege('authenticated','private.backup_runs','SELECT'),'authenticated has no direct backup_runs select');
select ok(not has_table_privilege('anon','private.mail_watch_renewal_leases','SELECT'),'anon has no direct watch lease select');
select ok(not has_table_privilege('authenticated','private.mail_watch_renewal_leases','SELECT'),'authenticated has no direct watch lease select');
select ok(exists(select 1 from pg_constraint c where c.conrelid='public.cloud_backups'::regclass and c.contype='u' and c.conkey=ARRAY[(select attnum from pg_attribute where attrelid='public.cloud_backups'::regclass and attname='backup_run_id')]::smallint[]),'cloud backup run id has unique constraint');
select ok(exists(select 1 from pg_indexes where schemaname='private' and tablename='sync_jobs' and indexname='sync_jobs_lease_idx'),'sync lease index exists');
select ok(exists(select 1 from pg_indexes where schemaname='private' and tablename='backup_runs' and indexname='backup_runs_claim_idx'),'backup claim index exists');
select * from finish();
rollback;
