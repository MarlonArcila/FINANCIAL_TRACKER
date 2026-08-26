create or replace function public.service_record_export_audit_event(
  p_user_id uuid,
  p_entity_id text,
  p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into private.audit_events (
    user_id,
    actor,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    p_user_id,
    'user',
    'data.exported',
    'account',
    p_entity_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$function$;

revoke execute on function
  public.service_record_export_audit_event(uuid,text,jsonb)
from public, anon, authenticated;

grant execute on function
  public.service_record_export_audit_event(uuid,text,jsonb)
to service_role;
