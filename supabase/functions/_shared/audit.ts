import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface AuditEvent {
  userId: string | null;
  actor: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAuditEvent(
  service: SupabaseClient,
  event: AuditEvent,
): Promise<void> {
  const { error } = await service.rpc("service_record_audit_event_v2", {
    p_user_id: event.userId,
    p_actor: event.actor,
    p_action: event.action,
    p_entity_type: event.entityType,
    p_entity_id: event.entityId,
    p_metadata: event.metadata ?? {},
  });

  if (error) throw error;
}
