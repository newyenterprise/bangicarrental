import 'server-only';
import { audit } from './audit';
import type { SessionUser } from './auth';
import { BUCKETS, removeObjects } from './storage';
import { createServiceClient } from './supabase/server';

/** Deletes a booking's identity documents from storage and marks the rows deleted. */
export async function deleteBookingDocuments(bookingId: string, actor: SessionUser | null, reason: string): Promise<number> {
  const db = createServiceClient();
  const { data: docs } = await db.from('documents').select('id, storage_path').eq('booking_id', bookingId).neq('status', 'deleted');
  if (!docs?.length) return 0;
  await removeObjects(BUCKETS.documents, docs.map((d) => d.storage_path));
  await db
    .from('documents')
    .update({ status: 'deleted', deleted_at: new Date().toISOString() })
    .in('id', docs.map((d) => d.id));
  await audit({ actor, action: 'documents.deleted', bookingId, entityType: 'booking', entityId: bookingId, metadata: { count: docs.length, reason } });
  return docs.length;
}

/**
 * Removes identity documents once the configured retention period after the
 * rental has passed. Signed agreements are kept as the rental record.
 */
export async function purgeExpiredDocuments(): Promise<{ bookings: number; documents: number }> {
  const db = createServiceClient();
  const { data: settings } = await db.from('app_settings').select('document_retention_days').eq('id', 1).single();
  const days = settings?.document_retention_days ?? 0;
  if (days <= 0) return { bookings: 0, documents: 0 };
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data: rows } = await db
    .from('documents')
    .select('booking_id, bookings!inner(ends_at, rental_status, status)')
    .neq('status', 'deleted')
    .lt('bookings.ends_at', cutoff)
    .neq('bookings.rental_status', 'picked_up')
    .limit(200);
  const ids = [...new Set((rows ?? []).map((r) => r.booking_id))];
  let documents = 0;
  for (const id of ids) documents += await deleteBookingDocuments(id, null, 'retention_period_elapsed');
  return { bookings: ids.length, documents };
}
