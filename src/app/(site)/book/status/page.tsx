import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteChrome';
import { fmt } from '@/lib/i18n/config';
import { getI18n } from '@/lib/i18n/server';
import { getStripe, syncCheckoutSession } from '@/lib/payments';
import { createServiceClient } from '@/lib/supabase/server';
import { formatTime } from '@/lib/time';
import { AutoRefresh } from './AutoRefresh';

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: d.status.metaTitle, robots: { index: false } };
}

type View = 'paid' | 'processing' | 'open' | 'expired' | 'needs_attention' | 'cancelled' | 'not_found';

/**
 * Where Stripe sends the customer back. The page never trusts the redirect
 * itself: it shows the server-side state, reconciling with Stripe first when
 * the booking is still pending. It deliberately shows only the payment state
 * and the reference; private booking details need a verified sign-in.
 */
export default async function StatusPage({ searchParams }: PageProps<'/book/status'>) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const db = createServiceClient();
  const sessionId = typeof params.session_id === 'string' && /^cs_[A-Za-z0-9_]+$/.test(params.session_id) ? params.session_id : null;
  const bookingParam = typeof params.b === 'string' && /^[0-9a-f-]{36}$/i.test(params.b) ? params.b : null;

  let bookingId = bookingParam;
  let knownSession = sessionId;
  if (sessionId) {
    const { data } = await db.from('payments').select('booking_id').eq('checkout_session_id', sessionId).maybeSingle();
    bookingId = data?.booking_id ?? null;
  } else if (bookingParam) {
    const { data } = await db
      .from('payments')
      .select('checkout_session_id')
      .eq('booking_id', bookingParam)
      .not('checkout_session_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    knownSession = data?.checkout_session_id ?? null;
  }

  const load = async () =>
    bookingId
      ? (await db.from('bookings').select('reference, customer_email, status, payment_status, hold_expires_at').eq('id', bookingId).maybeSingle()).data
      : null;
  let booking = await load();

  // Still pending on our side: ask Stripe for the real state before answering.
  if (booking && booking.status === 'pending_payment' && knownSession) {
    try {
      await syncCheckoutSession(knownSession);
      booking = await load();
    } catch {
      // Stripe unreachable: fall through and show what we know (processing/open).
    }
  }

  let view: View = 'not_found';
  let resumeUrl: string | null = null;
  if (booking) {
    if (booking.payment_status === 'needs_attention') view = 'needs_attention';
    else if (booking.status === 'confirmed') view = 'paid';
    else if (booking.status === 'cancelled') view = 'cancelled';
    else if (booking.status === 'expired') view = 'expired';
    else if (booking.payment_status === 'processing' || sessionId) view = 'processing';
    else view = 'open';
  }
  if (view === 'open' && knownSession) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(knownSession);
      resumeUrl = session.status === 'open' ? session.url : null;
    } catch {
      resumeUrl = null;
    }
  }

  const maskedEmail = booking ? booking.customer_email.replace(/^(.).*(@.*)$/, '$1•••$2') : '';
  const reference = booking && (
    <p className="my-4 rounded-xl bg-mist px-4 py-3 text-center text-2xl font-black tracking-wider" data-testid="booking-reference">
      {booking.reference}
    </p>
  );

  return (
    <>
      <SiteHeader />
      <main className="container-narrow py-6">
        <div className="card" data-testid={`payment-${view}`}>
          {view === 'paid' && (
            <>
              <span className="tag tag-live">{d.statuses.payment.paid}</span>
              <h1 className="h-display mt-3 text-3xl">{d.status.paidTitle}</h1>
              <p className="mt-3 leading-relaxed">{fmt(d.status.paidBody, { email: maskedEmail })}</p>
              {reference}
              <p className="leading-relaxed">{d.status.paidNext}</p>
              <Link href="/bookings" className="btn mt-5 w-full sm:w-auto">{d.status.openBookings}</Link>
            </>
          )}
          {view === 'processing' && (
            <>
              <span className="tag tag-warn">{d.statuses.payment.processing}</span>
              <h1 className="h-display mt-3 text-3xl">{d.status.processingTitle}</h1>
              <p className="mt-3 leading-relaxed" role="status">{d.status.processingBody}</p>
              {reference}
              <AutoRefresh seconds={5} />
            </>
          )}
          {view === 'open' && booking && (
            <>
              <span className="tag">{d.statuses.payment.unpaid}</span>
              <h1 className="h-display mt-3 text-3xl">{d.status.unpaidTitle}</h1>
              <p className="mt-3 leading-relaxed">
                {fmt(d.status.unpaidBody, { time: booking.hold_expires_at ? formatTime(booking.hold_expires_at, locale) : '' })}
              </p>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                {resumeUrl && <a href={resumeUrl} className="btn">{d.status.resume}</a>}
                <Link href="/" className="btn btn-secondary">{d.common.goHome}</Link>
              </div>
            </>
          )}
          {view === 'expired' && (
            <>
              <span className="tag">{d.statuses.booking.expired}</span>
              <h1 className="h-display mt-3 text-3xl">{d.status.expiredTitle}</h1>
              <p className="mt-3 leading-relaxed">{d.status.expiredBody}</p>
              <Link href="/" className="btn mt-5">{d.status.startAgain}</Link>
            </>
          )}
          {view === 'needs_attention' && (
            <>
              <span className="tag tag-warn">{d.statuses.payment.needs_attention}</span>
              <h1 className="h-display mt-3 text-3xl">{d.status.attentionTitle}</h1>
              <p className="mt-3 leading-relaxed">{d.status.attentionBody}</p>
              {reference}
            </>
          )}
          {view === 'cancelled' && (
            <>
              <h1 className="h-display text-3xl">{d.status.cancelledTitle}</h1>
              <p className="mt-3 leading-relaxed">{d.status.cancelledBody}</p>
              <Link href="/" className="btn mt-5">{d.common.goHome}</Link>
            </>
          )}
          {view === 'not_found' && (
            <>
              <h1 className="h-display text-3xl">{d.status.notFoundTitle}</h1>
              <p className="mt-3 leading-relaxed">{d.status.notFoundBody}</p>
              <Link href="/bookings" className="btn mt-5">{d.status.openBookings}</Link>
            </>
          )}
        </div>
      </main>
    </>
  );
}
