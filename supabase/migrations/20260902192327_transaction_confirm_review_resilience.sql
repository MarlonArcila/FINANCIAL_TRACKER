-- CapitalFlow: make manual transaction-candidate review resilient.
-- 1) The Gmail review path learns categorization/account assignment rules using
--    the backend service client. Keep that privilege narrow: SELECT/INSERT/UPDATE,
--    never DELETE.
-- 2) Make accept_transaction_candidate idempotent for an already accepted
--    candidate when its transaction was committed before a retry.

begin;

grant select, insert, update
on table public.account_assignment_rules
  to service_role;

grant select, insert, update
on table public.categorization_rules
  to service_role;

revoke delete
on table public.account_assignment_rules
  from service_role;

revoke delete
on table public.categorization_rules
  from service_role;

create or replace function public.accept_transaction_candidate(
  p_candidate_id uuid,
  p_account_id uuid,
  p_category_id uuid default null,
  p_corrections jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private, auth
as $function$
declare
  v_user_id uuid := auth.uid();
  v_candidate public.transaction_candidates%rowtype;
  v_account public.accounts%rowtype;
  v_category public.categories%rowtype;
  v_kind text;
  v_amount bigint;
  v_currency text;
  v_merchant text;
  v_description text;
  v_transaction_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not private.user_has_active_subscription(v_user_id) then
    raise exception 'active_subscription_required' using errcode = '42501';
  end if;

  -- Lock the candidate independent of status. This lets a retry distinguish
  -- "already accepted" from a genuinely missing candidate.
  select * into v_candidate
  from public.transaction_candidates
  where id = p_candidate_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'candidate_not_found' using errcode = 'P0002';
  end if;

  if v_candidate.status <> 'pending' then
    if v_candidate.status = 'accepted' then
      select id into v_transaction_id
      from public.transactions
      where user_id = v_user_id
        and source_candidate_id = p_candidate_id;
      if found then
        return v_transaction_id;
      end if;
    end if;
    raise exception 'candidate_not_pending' using errcode = 'P0002';
  end if;

  select * into v_account
  from public.accounts
  where id = p_account_id and user_id = v_user_id and is_archived = false;
  if not found then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;

  if p_category_id is not null then
    select * into v_category
    from public.categories
    where id = p_category_id and user_id = v_user_id and is_archived = false;
    if not found then
      raise exception 'category_not_found' using errcode = 'P0002';
    end if;
  end if;

  v_kind := coalesce(nullif(p_corrections ->> 'kind', ''), v_candidate.proposed_kind);
  if v_kind not in ('income', 'expense') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;

  v_amount := case
    when p_corrections ? 'amountMinor' then (p_corrections ->> 'amountMinor')::bigint
    else v_candidate.amount_minor
  end;
  if v_amount <= 0 or v_amount > 9007199254740991 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  v_currency := upper(coalesce(nullif(p_corrections ->> 'currency', ''), v_candidate.currency));
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid_currency' using errcode = '22023';
  end if;
  if v_account.currency <> v_currency then
    raise exception 'account_currency_mismatch' using errcode = '22023';
  end if;

  if p_category_id is not null and v_category.kind not in (v_kind, 'mixed') then
    raise exception 'category_kind_mismatch' using errcode = '22023';
  end if;

  v_merchant := case
    when p_corrections ? 'merchant' then nullif(p_corrections ->> 'merchant', '')
    else v_candidate.merchant
  end;
  v_description := case
    when p_corrections ? 'description' then nullif(p_corrections ->> 'description', '')
    else v_candidate.description
  end;

  insert into public.transactions(
    user_id, account_id, category_id, kind, amount_minor, currency,
    merchant, description, occurred_at, source, source_candidate_id,
    metadata
  ) values (
    v_user_id, p_account_id, p_category_id, v_kind, v_amount, v_currency,
    v_merchant, v_description, v_candidate.occurred_at, v_candidate.provider,
    v_candidate.id,
    jsonb_build_object('parser_version', v_candidate.parser_version, 'confidence', v_candidate.confidence)
  ) returning id into v_transaction_id;

  update public.transaction_candidates
  set status = 'accepted', reviewed_at = now()
  where id = v_candidate.id;

  insert into private.audit_events(user_id, actor, action, entity_type, entity_id, metadata)
  values (
    v_user_id,
    'user',
    'candidate.accepted',
    'transaction',
    v_transaction_id::text,
    jsonb_build_object('candidate_id', v_candidate.id)
  );

  return v_transaction_id;
end;
$function$;

revoke all on function public.accept_transaction_candidate(uuid, uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.accept_transaction_candidate(uuid, uuid, uuid, jsonb)
  to authenticated;

notify pgrst, 'reload schema';

commit;
