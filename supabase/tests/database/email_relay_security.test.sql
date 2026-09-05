begin;
select plan(48);
select has_table('private','email_relay_aliases','private alias registry exists');
select has_table('private','email_relay_sources','private multi-source registry exists');
select has_table('private','email_relay_replays','private replay registry exists');
select has_table('private','email_relay_rate_limits','private relay rate limit exists');
select has_table('private','financial_sender_catalog','private sender catalog exists');
select has_column('public','source_events','raw_sha256','source event lineage has raw hash');
select has_column('public','source_events','parser_version','source event lineage has parser version');
select has_column('public','source_events','recipient_alias_id','source event lineage has alias id');
select has_column('public','source_events','recipient_source_id','source event lineage has source id');
select has_column('public','source_events','forwarding_provider_hint','source event lineage has provider hint');
select has_column('public','source_events','candidate_id','source event lineage has candidate id');
select has_column('public','source_events','transaction_id','source event lineage has transaction id');
select has_index('public','source_events','source_events_email_relay_message_uidx','Message-ID dedup index exists');
select has_index('public','source_events','source_events_email_relay_raw_uidx','raw hash dedup index exists');
select ok(not has_function_privilege('anon','public.service_resolve_email_relay_alias(text)','execute'),'anon cannot resolve relay alias');
select ok(not has_function_privilege('authenticated','public.service_resolve_email_relay_alias(text)','execute'),'authenticated cannot resolve relay alias');
select ok(has_function_privilege('service_role','public.service_resolve_email_relay_alias(text)','execute'),'service role can resolve relay alias');
select ok(has_function_privilege('service_role','public.service_list_email_relay_sources(uuid)','execute'),'service role can list relay sources');
select ok(has_function_privilege('service_role','public.service_match_email_relay_source(uuid,text)','execute'),'service role can match a relay source');
select ok(has_function_privilege('service_role','public.service_claim_email_relay_replay(text,timestamp with time zone)','execute'),'service role can claim replay nonce');

insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000009101','relay-a@example.invalid'),
 ('00000000-0000-4000-8000-000000009102','relay-b@example.invalid');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$select * from public.service_create_or_rotate_email_relay_alias('00000000-0000-4000-8000-000000009101','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaa...aaaa')$$,'user A alias can be created');
select lives_ok($$select * from public.service_create_or_rotate_email_relay_alias('00000000-0000-4000-8000-000000009102','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','bbbb...bbbb')$$,'user B alias can be created');
select is((select user_id::text from public.service_resolve_email_relay_alias('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),'00000000-0000-4000-8000-000000009101','alias A resolves only to user A');
select is((select user_id::text from public.service_resolve_email_relay_alias('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')),'00000000-0000-4000-8000-000000009102','alias B resolves only to user B');
select lives_ok($$select * from public.service_create_email_relay_source('00000000-0000-4000-8000-000000009101','gmail','Gmail personal')$$,'Gmail source can share alias A');
select lives_ok($$select * from public.service_create_email_relay_source('00000000-0000-4000-8000-000000009101','outlook','Outlook personal')$$,'Outlook source can share alias A');
select lives_ok($$select * from public.service_create_email_relay_source('00000000-0000-4000-8000-000000009101','proton','Proton privado')$$,'Proton source can share alias A');
select is((select count(*)::integer from public.service_list_email_relay_sources('00000000-0000-4000-8000-000000009101')),3,'one user can configure three mail sources');
select is((select count(distinct alias_id)::integer from public.service_list_email_relay_sources('00000000-0000-4000-8000-000000009101')),1,'all three mail sources share one primary alias');
select is((select match_status from public.service_match_email_relay_source((select alias_id from public.service_resolve_email_relay_alias('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),'gmail')),'matched','Gmail maps to the shared alias source');
select is((select match_status from public.service_match_email_relay_source((select alias_id from public.service_resolve_email_relay_alias('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),'outlook')),'matched','Outlook maps to the shared alias source');
select is((select match_status from public.service_match_email_relay_source((select alias_id from public.service_resolve_email_relay_alias('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),'proton')),'matched','Proton maps to the shared alias source');
select is(public.service_claim_email_relay_replay('nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn',now()+interval '10 minutes'),true,'first relay nonce is accepted');
select is(public.service_claim_email_relay_replay('nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn',now()+interval '10 minutes'),false,'replayed relay nonce is rejected');
select lives_ok($$select * from public.service_create_or_rotate_email_relay_alias('00000000-0000-4000-8000-000000009101','ccccccccccccccccccccccccccccccccccccccccccc','cccc...cccc')$$,'user A alias can be rotated');
select is((select count(*)::integer from public.service_resolve_email_relay_alias('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),0,'rotated alias A is no longer resolvable');
select is((select user_id::text from public.service_resolve_email_relay_alias('ccccccccccccccccccccccccccccccccccccccccccc')),'00000000-0000-4000-8000-000000009101','new alias A resolves to user A');
select is((select count(*)::integer from public.service_list_email_relay_sources('00000000-0000-4000-8000-000000009101')),0,'rotation revokes old forwarding source registrations');
select lives_ok($$select * from public.service_create_email_relay_source('00000000-0000-4000-8000-000000009101','gmail','Gmail nuevo')$$,'new Gmail source can be registered after rotation');
select lives_ok($$select * from public.service_create_email_relay_source('00000000-0000-4000-8000-000000009101','outlook','Outlook nuevo')$$,'new Outlook source can be registered after rotation');
select lives_ok($$select public.service_revoke_email_relay_source('00000000-0000-4000-8000-000000009101',(select source_id from public.service_list_email_relay_sources('00000000-0000-4000-8000-000000009101') where provider='gmail' limit 1))$$,'one mail source can be revoked independently');
select is((select match_status from public.service_match_email_relay_source((select alias_id from public.service_resolve_email_relay_alias('ccccccccccccccccccccccccccccccccccccccccccc')),'gmail')),'revoked','revoked provider is distinguishable without revoking the shared alias');
select is((select count(*)::integer from public.service_resolve_email_relay_alias('ccccccccccccccccccccccccccccccccccccccccccc')),1,'revoking one source does not revoke the shared alias');
select is((select count(*)::integer from public.service_list_email_relay_sources('00000000-0000-4000-8000-000000009101') where provider='outlook'),1,'other sources remain active after one source is revoked');
select lives_ok($$select public.service_revoke_email_relay_alias('00000000-0000-4000-8000-000000009102')$$,'user B alias can be revoked');
select is((select count(*)::integer from public.service_resolve_email_relay_alias('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')),0,'revoked alias B is no longer resolvable');

reset role;
insert into public.source_events(user_id,connection_id,provider,external_id,occurred_at,fingerprint,recipient_alias_id,message_id,raw_sha256,processing_status)
select '00000000-0000-4000-8000-000000009101',a.connection_id,'email_relay','msg-1',now(),'relay-fp-1',a.id,'<same-message@example.invalid>',repeat('1',64),'received'
from private.email_relay_aliases a where a.user_id='00000000-0000-4000-8000-000000009101' and a.revoked_at is null;
with ins as (
  insert into public.source_events(user_id,connection_id,provider,external_id,occurred_at,fingerprint,recipient_alias_id,message_id,raw_sha256,processing_status)
  select '00000000-0000-4000-8000-000000009101',a.connection_id,'email_relay','msg-2',now(),'relay-fp-2',a.id,'<same-message@example.invalid>',repeat('2',64),'received'
  from private.email_relay_aliases a where a.user_id='00000000-0000-4000-8000-000000009101' and a.revoked_at is null
  on conflict do nothing returning 1
)
select is((select count(*)::integer from ins),0,'Message-ID duplicate across forwarding sources cannot create a second event');
with ins as (
  insert into public.source_events(user_id,connection_id,provider,external_id,occurred_at,fingerprint,recipient_alias_id,message_id,raw_sha256,processing_status)
  select '00000000-0000-4000-8000-000000009101',a.connection_id,'email_relay','msg-3',now(),'relay-fp-3',a.id,'<different-message@example.invalid>',repeat('1',64),'received'
  from private.email_relay_aliases a where a.user_id='00000000-0000-4000-8000-000000009101' and a.revoked_at is null
  on conflict do nothing returning 1
)
select is((select count(*)::integer from ins),0,'raw duplicate across forwarding sources cannot create a second event');
select * from finish();
rollback;
