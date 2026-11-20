import { NextResponse } from 'next/server';
import { audit } from '@/lib/audit';
import { getSessionUser } from '@/lib/auth';
import { UUID } from '@/lib/renter/data';
import { BUCKETS, signedUrl } from '@/lib/storage';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const notFound = () => new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

/**
 * Signed agreement PDF. The renter and the admin both receive the one stored
 * file that was generated at signing, through a 60-second link.
 */
export async function GET(_request: Request, { params }: RouteContext<'/api/agreements/[id]/pdf'>) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user || !UUID.test(id)) return notFound();

  const db = createServiceClient();
  const { data: agreement } = await db.from('agreements').select('id, booking_id, version, status, signed_at, pdf_path').eq('id', id).maybeSingle();
  // A superseded agreement that was signed stays downloadable as a record.
  if (!agreement || !agreement.pdf_path || !agreement.signed_at) return notFound();

  const { data: booking } = await db.from('bookings').select('renter_id, reference').eq('id', agreement.booking_id).maybeSingle();
  if (!booking) return notFound();
  if (user.role !== 'admin' && booking.renter_id !== user.id) return notFound();

  const url = await signedUrl(BUCKETS.agreements, agreement.pdf_path, `${booking.reference}-agreement-v${agreement.version}.pdf`);
  if (!url) return notFound();
  await audit({ actor: user, action: 'agreement.downloaded', bookingId: agreement.booking_id, entityType: 'agreement', entityId: agreement.id, metadata: { version: agreement.version } });
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
