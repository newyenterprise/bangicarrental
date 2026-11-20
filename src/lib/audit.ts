import 'server-only';
import { createServiceClient } from './supabase/server';
import type { SessionUser } from './auth';

type AuditInput = {
  actor?: SessionUser | null;
  action: string;
  bookingId?: string | null;
  entityType?: string;
  entityId?: string;
  /** Never put identity numbers, document contents, signatures or signed URLs in here. */
  metadata?: Record<string, unknown>;
};

/** Best effort: an audit failure is logged but never breaks the action itself. */
export async function audit(input: AuditInput): Promise<void> {
  const { error } = await createServiceClient().from('audit_log').insert({
    actor_id: input.actor?.id ?? null,
    actor_role: input.actor?.role ?? 'system',
    action: input.action,
    booking_id: input.bookingId ?? null,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    metadata: input.metadata ?? {},
  });
  if (error) console.error('[audit] failed to record', input.action, error.code);
}
