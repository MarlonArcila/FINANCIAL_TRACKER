begin;

select plan(3);

select ok(
  not exists (
    select 1
    from pg_constraint
    where lower(pg_get_constraintdef(oid)) like '%outlook%'
       or lower(pg_get_constraintdef(oid)) like '%onedrive%'
  ),
  'database constraints no longer permit Outlook or OneDrive'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.source_connections'::regclass
      and conname = 'source_connections_provider_check'
      and lower(pg_get_constraintdef(oid)) like '%gmail%'
      and lower(pg_get_constraintdef(oid)) not like '%outlook%'
  ),
  'source connections are Gmail-only'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.storage_connections'::regclass
      and conname = 'storage_connections_provider_check'
      and lower(pg_get_constraintdef(oid)) like '%google_drive%'
      and lower(pg_get_constraintdef(oid)) not like '%onedrive%'
  ),
  'storage connections are Google Drive-only'
);

select * from finish();

rollback;
