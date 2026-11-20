import { NextResponse } from 'next/server';
import { audit } from '@/lib/audit';
import { getSessionUser } from '@/lib/auth';
import { UUID } from '@/lib/renter/data';
import { BUCKETS, signedUrl } from '@/lib/storage';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const notFound = () => new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

/**
 * Opens an identity / licence document. Only the renter who owns the booking
 * or an admin gets through; everyone else sees 404 (not 403, so the existence
 * of a document is not revealed). The response is a redirect to a link that
 * expires after 60 seconds.
 */
export async function GET(_request: Request, { params }: RouteContext<'/api/documents/[id]'>) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user || !UUID.test(id)) return notFound();

  const db = createServiceClient();
  const { data: doc } = await db.from('documents').select('id, booking_id, storage_path, status').eq('id', id).maybeSingle();
  if (!doc || doc.status !== 'active') return notFound();

  if (user.role !== 'admin') {
    const { data: booking } = await db.from('bookings').select('renter_id').eq('id', doc.booking_id).maybeSingle();
    if (!booking || booking.renter_id !== user.id) return notFound();
  }

  const url = await signedUrl(BUCKETS.documents, doc.storage_path);
  if (!url) return notFound();
  if (user.role === 'admin') {
    await audit({ actor: user, action: 'document.viewed', bookingId: doc.booking_id, entityType: 'document', entityId: doc.id });
  }
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
