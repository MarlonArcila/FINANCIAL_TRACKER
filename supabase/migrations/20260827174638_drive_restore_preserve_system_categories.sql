begin;

-- Restore must preserve immutable seed/system categories. The backup contains
-- those rows for referential stability, but they are provisioned by the platform
-- and guarded against deletion/mutation. Only user-created categories are
-- replaced during restore; system-category IDs remain stable for references.
create or replace function private.restore_user_backup(p_user_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  d jsonb;
  profile_rows jsonb;
  restored_transactions integer := 0;
begin
  if p_payload->>'format' <> 'capitalflow-backup-v2' then
    raise exception 'unsupported_backup_format' using errcode = '22023';
  end if;
  d := p_payload->'data';
  if d is null or jsonb_typeof(d) <> 'object' then
    raise exception 'invalid_backup_payload' using errcode = '22023';
  end if;

  delete from public.goal_contributions where user_id = p_user_id;
  delete from public.investment_transactions where user_id = p_user_id;
  delete from public.investment_valuations where user_id = p_user_id;
  delete from public.categorization_rules where user_id = p_user_id;
  delete from public.account_assignment_rules where user_id = p_user_id;
  delete from public.budget_items where user_id = p_user_id;
  delete from public.goals where user_id = p_user_id;
  delete from public.investments where user_id = p_user_id;
  delete from public.transactions where user_id = p_user_id;
  delete from public.categories where user_id = p_user_id and is_system = false;
  delete from public.accounts where user_id = p_user_id;
  delete from public.financial_preferences where user_id = p_user_id;

  profile_rows := jsonb_build_array(jsonb_set(coalesce(d->'profile', '{}'::jsonb), '{id}', to_jsonb(p_user_id::text), true));
  update public.profiles p set
    full_name = r.full_name,
    base_currency = r.base_currency,
    locale = r.locale,
    timezone = r.timezone,
    onboarding_completed = r.onboarding_completed,
    privacy_version = r.privacy_version,
    privacy_accepted_at = r.privacy_accepted_at,
    enabled_currencies = r.enabled_currencies,
    updated_at = now()
  from jsonb_populate_recordset(null::public.profiles, profile_rows) r
  where p.id = p_user_id;

  insert into public.accounts
    select * from jsonb_populate_recordset(null::public.accounts, private.rebind_backup_owner(d->'accounts','user_id',p_user_id));

  insert into public.categories
    select c.*
    from jsonb_populate_recordset(
      null::public.categories,
      private.rebind_backup_owner(d->'categories','user_id',p_user_id)
    ) c
    where c.is_system = false;

  insert into public.transactions
    select * from jsonb_populate_recordset(null::public.transactions, private.rebind_backup_owner(d->'transactions','user_id',p_user_id));
  get diagnostics restored_transactions = row_count;
  insert into public.goals select * from jsonb_populate_recordset(null::public.goals, private.rebind_backup_owner(d->'goals','user_id',p_user_id));
  insert into public.investments select * from jsonb_populate_recordset(null::public.investments, private.rebind_backup_owner(d->'investments','user_id',p_user_id));
  insert into public.goal_contributions select * from jsonb_populate_recordset(null::public.goal_contributions, private.rebind_backup_owner(d->'goal_contributions','user_id',p_user_id));
  insert into public.investment_transactions select * from jsonb_populate_recordset(null::public.investment_transactions, private.rebind_backup_owner(d->'investment_transactions','user_id',p_user_id));
  insert into public.investment_valuations select * from jsonb_populate_recordset(null::public.investment_valuations, private.rebind_backup_owner(d->'investment_valuations','user_id',p_user_id));
  insert into public.categorization_rules select * from jsonb_populate_recordset(null::public.categorization_rules, private.rebind_backup_owner(d->'categorization_rules','user_id',p_user_id));
  insert into public.account_assignment_rules select * from jsonb_populate_recordset(null::public.account_assignment_rules, private.rebind_backup_owner(d->'account_assignment_rules','user_id',p_user_id));
  insert into public.budget_items select * from jsonb_populate_recordset(null::public.budget_items, private.rebind_backup_owner(d->'budget_items','user_id',p_user_id));
  insert into public.financial_preferences select * from jsonb_populate_recordset(null::public.financial_preferences, private.rebind_backup_owner(d->'financial_preferences','user_id',p_user_id));

  return jsonb_build_object('restored', true, 'transactions', restored_transactions);
end;
$$;

alter function private.restore_user_backup(uuid,jsonb) owner to postgres;
revoke all on function private.restore_user_backup(uuid,jsonb) from public, anon, authenticated;
grant execute on function private.restore_user_backup(uuid,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
