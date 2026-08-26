begin;

create table private.rate_limit_windows (
  scope text not null,
  subject text not null,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 1),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, subject, window_started_at)
);

create index rate_limit_windows_expiry_idx
  on private.rate_limit_windows (expires_at);

alter table private.rate_limit_windows enable row level security;

revoke all on table private.rate_limit_windows from public, anon, authenticated, service_role;

create or replace function public.service_take_rate_limit(
  p_scope text,
  p_subject text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_count integer;
begin
  if p_scope is null or p_scope !~ '^[a-z0-9_.:-]{1,80}$' then
    raise exception 'invalid_rate_limit_scope' using errcode = '22023';
  end if;
  if p_subject is null or length(p_subject) < 1 or length(p_subject) > 160 then
    raise exception 'invalid_rate_limit_subject' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'invalid_rate_limit_limit' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid_rate_limit_window' using errcode = '22023';
  end if;

  v_window_start := to_timestamp(
    (floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds)::double precision
  );
  v_window_end := v_window_start + make_interval(secs => p_window_seconds);

  delete from private.rate_limit_windows
  where scope = p_scope
    and subject = p_subject
    and expires_at < v_now;

  insert into private.rate_limit_windows as existing (
    scope,
    subject,
    window_started_at,
    request_count,
    expires_at,
    updated_at
  ) values (
    p_scope,
    p_subject,
    v_window_start,
    1,
    v_window_end + interval '1 day',
    v_now
  )
  on conflict (scope, subject, window_started_at) do update set
    request_count = least(existing.request_count + 1, p_limit + 1),
    expires_at = excluded.expires_at,
    updated_at = v_now
  returning request_count into v_count;

  return query
  select
    v_count <= p_limit,
    greatest(p_limit - v_count, 0),
    greatest(1, ceil(extract(epoch from (v_window_end - v_now)))::integer);
end;
$function$;

alter function public.service_take_rate_limit(text,text,integer,integer) owner to postgres;
revoke all on function public.service_take_rate_limit(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.service_take_rate_limit(text,text,integer,integer) to service_role;

notify pgrst, 'reload schema';

commit;
