begin;

-- The ingestion worker uses service_role, so this RPC accepts an explicit owner
-- and makes posting the ledger entry and accepting its candidate indivisible.
create or replace function public.auto_post_transaction_candidate(
  p_user_id uuid,
  p_candidate_id uuid,
  p_account_id uuid,
  p_category_id uuid,
  p_automation_score numeric,
  p_metadata jsonb default '{}'::jsonb,
  p_base_currency text default null,
  p_base_amount_minor bigint default null,
  p_fx_rate numeric default null,
  p_fx_source text default null,
  p_fx_rate_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_candidate public.transaction_candidates%rowtype;
  v_account public.accounts%rowtype;
  v_category public.categories%rowtype;
  v_transaction_id uuid;
begin
  select * into v_candidate
  from public.transaction_candidates
  where id = p_candidate_id and user_id = p_user_id
  for update;

  if not found then
    select id into v_transaction_id
    from public.transactions
    where user_id = p_user_id and source_candidate_id = p_candidate_id;
    if found then return v_transaction_id; end if;
    raise exception 'candidate_not_found' using errcode = 'P0002';
  end if;

  if v_candidate.status <> 'pending' then
    select id into v_transaction_id
    from public.transactions
    where user_id = p_user_id and source_candidate_id = p_candidate_id;
    if found then return v_transaction_id; end if;
    raise exception 'candidate_not_pending' using errcode = 'P0002';
  end if;

  select * into v_account
  from public.accounts
  where id = p_account_id and user_id = p_user_id and is_archived = false;
  if not found then raise exception 'account_not_found' using errcode = 'P0002'; end if;
  if v_account.currency <> v_candidate.currency then
    raise exception 'account_currency_mismatch' using errcode = '22023';
  end if;

  if p_category_id is not null then
    select * into v_category
    from public.categories
    where id = p_category_id and user_id = p_user_id and is_archived = false;
    if not found then raise exception 'category_not_found' using errcode = 'P0002'; end if;
    if v_category.kind not in (v_candidate.proposed_kind, 'mixed') then
      raise exception 'category_kind_mismatch' using errcode = '22023';
    end if;
  end if;

  insert into public.transactions (
    user_id, account_id, category_id, kind, amount_minor, currency,
    merchant, description, occurred_at, source, source_candidate_id,
    auto_posted, base_currency, base_amount_minor, fx_rate, fx_source, fx_rate_at, metadata
  ) values (
    p_user_id, p_account_id, p_category_id, v_candidate.proposed_kind, v_candidate.amount_minor, v_candidate.currency,
    v_candidate.merchant, v_candidate.description, v_candidate.occurred_at, v_candidate.provider, v_candidate.id,
    true, p_base_currency, p_base_amount_minor, p_fx_rate, p_fx_source, p_fx_rate_at, p_metadata
  ) returning id into v_transaction_id;

  update public.transaction_candidates
  set status = 'accepted', auto_decision = true, review_reason = null,
      resolved_account_id = p_account_id, resolved_category_id = p_category_id,
      automation_score = p_automation_score, automation_metadata = p_metadata,
      reviewed_at = now()
  where id = v_candidate.id;

  return v_transaction_id;
end;
$$;

revoke all on function public.auto_post_transaction_candidate(uuid, uuid, uuid, uuid, numeric, jsonb, text, bigint, numeric, text, timestamptz) from public, anon, authenticated;
grant execute on function public.auto_post_transaction_candidate(uuid, uuid, uuid, uuid, numeric, jsonb, text, bigint, numeric, text, timestamptz) to service_role;

commit;
