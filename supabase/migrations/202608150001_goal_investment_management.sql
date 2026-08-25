begin;

-- Every goal should be represented in the user's category catalogue when the
-- user did not explicitly choose another goal/mixed category. This backfills
-- existing goals and keeps future inserts consistent even when they come from
-- another client.
insert into public.categories (user_id, name, kind, is_system)
select distinct g.user_id, g.name, 'goal', false
from public.goals g
where g.category_id is null
on conflict do nothing;

update public.goals g
set category_id = c.id
from public.categories c
where g.category_id is null
  and c.user_id = g.user_id
  and c.kind = 'goal'
  and c.is_archived = false
  and lower(c.name) = lower(g.name);

create or replace function private.ensure_goal_category()
returns trigger
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_category_id uuid;
begin
  if new.category_id is not null then
    return new;
  end if;

  select c.id into v_category_id
  from public.categories c
  where c.user_id = new.user_id
    and c.kind = 'goal'
    and c.is_archived = false
    and lower(c.name) = lower(new.name)
  order by c.created_at
  limit 1;

  if v_category_id is null then
    insert into public.categories (user_id, name, kind, is_system)
    values (new.user_id, new.name, 'goal', false)
    returning id into v_category_id;
  end if;

  new.category_id := v_category_id;
  return new;
end;
$$;

drop trigger if exists ensure_goal_category_on_write on public.goals;
create trigger ensure_goal_category_on_write
before insert or update of category_id on public.goals
for each row
execute function private.ensure_goal_category();

-- A contribution/withdrawal changes both invested capital and the portfolio's
-- cash value. Recording the paired transaction and valuation atomically avoids
-- artificial losses/gains caused by updating only one side of the investment.
create or replace function public.record_investment_cashflow(
  p_investment_id uuid,
  p_kind text,
  p_amount_minor bigint,
  p_occurred_at timestamptz default now(),
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_investment public.investments%rowtype;
  v_current_value bigint := 0;
  v_new_value bigint;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not private.user_has_active_subscription(v_user_id) then
    raise exception 'active_subscription_required' using errcode = '42501';
  end if;
  if p_kind not in ('contribution', 'withdrawal') then
    raise exception 'invalid_investment_cashflow_kind' using errcode = '22023';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor > 9007199254740991 then
    raise exception 'invalid_investment_amount' using errcode = '22023';
  end if;

  select * into v_investment
  from public.investments
  where id = p_investment_id
    and user_id = v_user_id
    and is_archived = false
  for update;

  if not found then
    raise exception 'investment_not_found' using errcode = 'P0002';
  end if;

  select iv.value_minor into v_current_value
  from public.investment_valuations iv
  where iv.investment_id = p_investment_id
    and iv.user_id = v_user_id
  order by iv.valued_at desc, iv.created_at desc
  limit 1;

  v_current_value := coalesce(v_current_value, 0);

  insert into public.investment_transactions (
    user_id, investment_id, kind, amount_minor, occurred_at, note
  ) values (
    v_user_id, p_investment_id, p_kind, p_amount_minor, coalesce(p_occurred_at, now()), p_note
  );

  if p_kind = 'contribution' then
    v_new_value := v_current_value + p_amount_minor;
  else
    v_new_value := greatest(v_current_value - p_amount_minor, 0);
  end if;

  insert into public.investment_valuations (
    user_id, investment_id, value_minor, valued_at, note
  ) values (
    v_user_id,
    p_investment_id,
    v_new_value,
    coalesce(p_occurred_at, now()),
    case when p_note is null or btrim(p_note) = '' then
      case when p_kind = 'contribution' then 'Valor ajustado por aporte' else 'Valor ajustado por retiro' end
    else p_note end
  );

  return jsonb_build_object(
    'investmentId', p_investment_id,
    'kind', p_kind,
    'amountMinor', p_amount_minor,
    'currentValueMinor', v_new_value
  );
end;
$$;

revoke all on function public.record_investment_cashflow(uuid, text, bigint, timestamptz, text) from public, anon;
grant execute on function public.record_investment_cashflow(uuid, text, bigint, timestamptz, text) to authenticated;

commit;
