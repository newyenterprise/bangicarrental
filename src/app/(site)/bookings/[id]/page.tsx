import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteChrome';
import { DriverStatusTag, StatusTags } from '@/components/renter/StatusTags';
import { requireUser } from '@/lib/auth';
import { computeBookingState, type NextAction } from '@/lib/booking-state';
import { fmt } from '@/lib/i18n/config';
import { getI18n } from '@/lib/i18n/server';
import type { Dict } from '@/lib/i18n/ms';
import { formatRM } from '@/lib/money';
import { UUID } from '@/lib/renter/data';
import { getSettings, localized } from '@/lib/settings';
import { createServiceClient, createUserClient } from '@/lib/supabase/server';
import { formatDate, formatDateTime, toKlLocal } from '@/lib/time';
import type { Agreement, Booking, BookingRequest, DepositTransaction, DocumentRow, Driver, Payment, Refund } from '@/lib/types';
import { addDriver, removeDriver } from './actions';
import { RequestForms } from './RequestForms';

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: d.bookings.details, robots: { index: false } };
}

function nextCopy(d: Dict, next: NextAction): { title: string; body: string; cta?: string; tone: 'action' | 'wait' | 'done' | 'alert' } {
  const n = d.next;
  switch (next) {
    case 'payment_attention': return { title: n.paymentAttentionTitle, body: n.paymentAttentionBody, tone: 'alert' };
    case 'unpaid': return { title: n.unpaidTitle, body: n.unpaidBody, tone: 'wait' };
    case 'cancelled': return { title: n.cancelledTitle, body: n.cancelledBody, tone: 'wait' };
    case 'details': return { title: n.detailsTitle, body: n.detailsBody, cta: n.detailsCta, tone: 'action' };
    case 'upload': return { title: n.uploadTitle, body: n.uploadBody, cta: n.uploadCta, tone: 'action' };
    case 'correct': return { title: n.correctTitle, body: n.correctBody, cta: n.correctCta, tone: 'alert' };
    case 'review': return { title: n.reviewTitle, body: n.reviewBody, tone: 'wait' };
    case 'agreement_pending': return { title: n.agreementPendingTitle, body: n.agreementPendingBody, tone: 'wait' };
    case 'sign': return { title: n.signTitle, body: n.signBody, cta: n.signCta, tone: 'action' };
    case 'ready': return { title: n.readyTitle, body: n.readyBody, cta: n.readyCta, tone: 'done' };
    case 'active': return { title: n.activeTitle, body: n.activeBody, tone: 'done' };
    case 'completed': return { title: n.completedTitle, body: n.completedBody, tone: 'done' };
  }
}

export default async function BookingPage({ params }: PageProps<'/bookings/[id]'>) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requireUser(`/bookings/${id}`);
  const { locale, d } = await getI18n();

  // Everything below is read with the renter's own session: RLS returns nothing for other people's bookings.
  const supabase = await createUserClient();
  const { data: bookingRow } = await supabase.from('bookings').select('*, vehicle_models(name, seats, transmission)').eq('id', id).maybeSingle();
  if (!bookingRow || bookingRow.renter_id !== user.id) notFound();
  const booking = bookingRow as Booking & { vehicle_models: { name: string; seats: number; transmission: string } | null };

  const [drivers, documents, agreements, payments, refunds, requests, deposits, settings] = await Promise.all([
    supabase.from('drivers').select('*').eq('booking_id', id).order('is_primary', { ascending: false }).order('created_at').then((r) => (r.data ?? []) as Driver[]),
    supabase.from('documents').select('*').eq('booking_id', id).eq('status', 'active').then((r) => (r.data ?? []) as DocumentRow[]),
    supabase.from('agreements').select('*').eq('booking_id', id).order('version', { ascending: false }).then((r) => (r.data ?? []) as Agreement[]),
    supabase.from('payments').select('*').eq('booking_id', id).eq('status', 'succeeded').order('paid_at').then((r) => (r.data ?? []) as Payment[]),
    supabase.from('refunds').select('*').eq('booking_id', id).order('created_at').then((r) => (r.data ?? []) as Refund[]),
    supabase.from('booking_requests').select('*').eq('booking_id', id).order('created_at', { ascending: false }).then((r) => (r.data ?? []) as BookingRequest[]),
    supabase.from('deposit_transactions').select('*').eq('booking_id', id).order('created_at').then((r) => (r.data ?? []) as DepositTransaction[]),
    getSettings(),
  ]);

  const agreement = agreements.find((a) => a.status !== 'superseded') ?? null;
  const state = computeBookingState({ booking, drivers, documents, agreement });
  const copy = nextCopy(d, state.next);
  const base = `/bookings/${id}`;
  const ctaHref =
    state.next === 'sign' ? `${base}/agreement` : state.next === 'ready' ? '#pickup' : state.driverId ? `${base}/drivers/${state.driverId}` : null;
  const open = booking.status === 'confirmed' && booking.rental_status === 'not_started';
  const deadline = new Date(new Date(booking.starts_at).getTime() - settings.verification_deadline_hours * 3600_000);
  const paid = booking.payment_status === 'paid' || booking.payment_status === 'partially_refunded' || booking.payment_status === 'refunded';

  // Unit details are private; fetched with the service role only now that ownership is established.
  let registration = '';
  if (state.readyForPickup || booking.rental_status !== 'not_started') {
    const { data: vehicle } = await createServiceClient().from('vehicles').select('registration_no').eq('id', booking.vehicle_id).maybeSingle();
    registration = vehicle?.registration_no ?? '';
  }
  const instructions = localized(settings, 'pickup_instructions', locale);
  const hours = localized(settings, 'operating_hours', locale);

  const toneClass = { action: 'bg-sage', wait: 'bg-mist', done: 'bg-live', alert: 'bg-warn-soft' }[copy.tone];
  const steps: [string, 'done' | 'todo' | 'waiting'][] = [
    [d.bookings.stepPayment, paid ? 'done' : 'todo'],
    [d.bookings.stepDrivers, state.driversComplete && drivers.every((x) => x.status !== 'draft' && x.status !== 'correction_requested') ? 'done' : 'todo'],
    [d.bookings.stepVerification, state.allApproved ? 'done' : drivers.some((x) => x.status === 'submitted') ? 'waiting' : 'todo'],
    [d.bookings.stepAgreement, state.agreementSigned ? 'done' : 'todo'],
    [d.bookings.stepPickup, booking.rental_status !== 'not_started' ? 'done' : state.readyForPickup ? 'waiting' : 'todo'],
  ];
  const stepLabel = { done: d.bookings.done, todo: d.bookings.todo, waiting: d.bookings.waiting };
  const sum = (kind: DepositTransaction['kind']) => deposits.filter((x) => x.kind === kind).reduce((a, x) => a + x.amount_sen, 0);
  const depositLabel = {
    due: d.bookings.depositDue,
    collected: d.bookings.depositCollected,
    settled: d.bookings.depositSettled,
    not_required: d.bookings.depositNotRequired,
  }[booking.deposit_status];
  const requestStatus = { pending: d.request.pending, approved: d.request.approved, declined: d.request.declined };

  return (
    <>
      <SiteHeader />
      <main className="container-narrow space-y-5 py-4">
        <Link href="/bookings" className="btn-plain -ml-2 text-sm">
          <span aria-hidden>←</span>&nbsp;{d.bookings.title}
        </Link>

        <header>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h1 className="h-display text-3xl sm:text-4xl">{booking.vehicle_models?.name}</h1>
            <StatusTags booking={booking} d={d} ready={state.readyForPickup} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {d.bookings.reference}: <strong className="text-ink" data-testid="reference">{booking.reference}</strong>
          </p>
        </header>

        <section className={`rounded-[20px] p-5 ${toneClass}`} aria-labelledby="next-title" data-testid={`next-${state.next}`}>
          <p className="text-xs font-bold tracking-[0.08em] uppercase">{d.bookings.nextStep}</p>
          <h2 id="next-title" className="h-display mt-1 text-2xl">{copy.title}</h2>
          <p className="mt-2 leading-relaxed">{fmt(copy.body, { time: formatDateTime(booking.ends_at, locale) })}</p>
          {open && !state.readyForPickup && state.next !== 'payment_attention' && (
            <p className="mt-2 text-sm font-semibold">{fmt(d.bookings.deadline, { deadline: formatDateTime(deadline, locale) })}</p>
          )}
          {copy.cta && ctaHref && (
            <Link href={ctaHref} className="btn mt-4 w-full sm:w-auto">
              {copy.cta} <span aria-hidden>→</span>
            </Link>
          )}
        </section>

        {booking.status === 'confirmed' && (
          <section className="card" aria-labelledby="progress-title">
            <h2 id="progress-title" className="text-lg font-bold">{d.bookings.progress}</h2>
            <ol className="mt-1">
              {steps.map(([label, status]) => (
                <li key={label} className="row-line last:border-b-0">
                  <span>{label}</span>
                  <span className={`tag ${status === 'done' ? 'tag-live' : status === 'waiting' ? 'tag-warn' : ''}`}>{stepLabel[status]}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="card" aria-labelledby="details-title">
          <h2 id="details-title" className="text-lg font-bold">{d.bookings.details}</h2>
          <dl className="mt-1">
            <div className="row-line"><dt>{d.bookings.vehicle}</dt><dd>{booking.vehicle_models?.name}</dd></div>
            <div className="row-line"><dt>{d.book.pickupAt}</dt><dd>{formatDateTime(booking.starts_at, locale)}</dd></div>
            <div className="row-line"><dt>{d.book.returnAt}</dt><dd>{formatDateTime(booking.ends_at, locale)}</dd></div>
            <div className="row-line border-b-0"><dt>{d.book.period}</dt><dd>{booking.days} {d.common.days}</dd></div>
          </dl>
        </section>

        <section className="card" aria-labelledby="charges-title">
          <h2 id="charges-title" className="text-lg font-bold">{d.bookings.charges}</h2>
          <dl className="mt-1">
            <div className="row-line">
              <dt>
                {d.bookings.rentalCharge}
                <span className="block text-sm text-muted">
                  {paid && booking.paid_at ? fmt(d.bookings.paidOn, { date: formatDate(booking.paid_at, locale) }) : d.statuses.payment[booking.payment_status]}
                </span>
                {payments.filter((p) => p.receipt_url).map((p) => (
                  <a key={p.id} href={p.receipt_url!} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold underline">
                    {d.bookings.receipt}
                  </a>
                ))}
              </dt>
              <dd>{formatRM(booking.rental_total_sen)}</dd>
            </div>
            {refunds.map((r) => (
              <div key={r.id} className="row-line">
                <dt className="text-sm">
                  {fmt(r.status === 'succeeded' ? d.request.refundDone : r.status === 'failed' ? d.request.refundFailed : d.request.refundPending, { amount: formatRM(r.amount_sen) })}
                  <span className="block text-muted">{formatDate(r.created_at, locale)}</span>
                </dt>
                <dd>{r.status === 'succeeded' ? `-${formatRM(r.amount_sen)}` : ''}</dd>
              </div>
            ))}
            <div className="row-line border-b-0">
              <dt>
                {d.bookings.deposit}
                <span className="block text-sm text-muted">{depositLabel}</span>
                {sum('deduction') > 0 && <span className="block text-sm text-muted">{fmt(d.bookings.depositDeducted, { amount: formatRM(sum('deduction')) })}</span>}
                {sum('returned') > 0 && <span className="block text-sm text-muted">{fmt(d.bookings.depositReturned, { amount: formatRM(sum('returned')) })}</span>}
              </dt>
              <dd data-testid="deposit-amount">{formatRM(booking.deposit_sen)}</dd>
            </div>
          </dl>
          {deposits.filter((x) => x.kind === 'deduction' && x.reason).length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-muted">
              {deposits.filter((x) => x.kind === 'deduction' && x.reason).map((x) => (
                <li key={x.id}>{formatRM(x.amount_sen)} · {x.reason}</li>
              ))}
            </ul>
          )}
        </section>

        {booking.status === 'confirmed' && (
          <section className="card" aria-labelledby="drivers-title">
            <h2 id="drivers-title" className="text-lg font-bold">{d.bookings.drivers}</h2>
            <ul className="mt-2 space-y-3">
              {drivers.map((driver) => {
                const editable = open && (driver.status === 'draft' || driver.status === 'correction_requested');
                return (
                  <li key={driver.id} className="rounded-xl border border-line-soft p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p>
                        <strong>{driver.full_name || (driver.is_primary ? d.bookings.primaryDriver : d.bookings.additionalDriver)}</strong>
                        <span className="block text-sm text-muted">{driver.is_primary ? d.bookings.primaryDriver : d.bookings.additionalDriver}</span>
                      </p>
                      <DriverStatusTag status={driver.status} d={d} />
                    </div>
                    {driver.status === 'correction_requested' && driver.correction_reason && (
                      <p className="notice notice-danger mt-2 text-sm whitespace-pre-line">{driver.correction_reason}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link href={`${base}/drivers/${driver.id}`} className={`btn btn-sm ${editable ? '' : 'btn-secondary'}`}>
                        {editable ? d.bookings.editDriver : d.bookings.viewDriver}
                      </Link>
                      {editable && !driver.is_primary && (
                        <form action={removeDriver.bind(null, driver.id)}>
                          <button type="submit" className="btn btn-sm btn-secondary">{d.bookings.removeDriver}</button>
                        </form>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {open && drivers.length < 4 && (
              <form action={addDriver.bind(null, id)} className="mt-4">
                <button type="submit" className="btn btn-secondary w-full sm:w-auto">+ {d.bookings.addDriver}</button>
                <p className="field-hint">{d.bookings.addDriverNote}</p>
              </form>
            )}
          </section>
        )}

        {agreement && (
          <section className="card" aria-labelledby="agreement-title">
            <h2 id="agreement-title" className="text-lg font-bold">{d.bookings.agreement}</h2>
            {agreement.status === 'signed' ? (
              <>
                <p className="mt-1 text-sm text-muted">
                  {fmt(d.agreement.version, { n: agreement.version })} · {fmt(d.bookings.agreementSigned, { date: formatDateTime(agreement.signed_at!, locale) })}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a href={`/api/agreements/${agreement.id}/pdf`} className="btn btn-sm">{d.bookings.downloadAgreement}</a>
                  <Link href={`${base}/agreement`} className="btn btn-sm btn-secondary">{d.bookings.viewDriver}</Link>
                </div>
              </>
            ) : (
              <Link href={`${base}/agreement`} className="btn mt-3 w-full sm:w-auto">{d.next.signCta}</Link>
            )}
          </section>
        )}

        <section id="pickup" className="card scroll-mt-4" aria-labelledby="pickup-title">
          <h2 id="pickup-title" className="text-lg font-bold">{d.bookings.pickupTitle}</h2>
          {state.readyForPickup || booking.rental_status !== 'not_started' ? (
            <>
              <dl className="mt-1">
                <div className="row-line"><dt>{d.book.pickupAt}</dt><dd>{formatDateTime(booking.starts_at, locale)}</dd></div>
                {registration && <div className="row-line"><dt>{d.bookings.registration}</dt><dd>{registration}</dd></div>}
                {booking.deposit_sen > 0 && booking.deposit_status === 'due' && (
                  <div className="row-line"><dt>{d.bookings.deposit}<span className="block text-sm text-muted">{d.bookings.depositDue}</span></dt><dd>{formatRM(booking.deposit_sen)}</dd></div>
                )}
              </dl>
              <p className="mt-3 leading-relaxed whitespace-pre-line">{instructions || d.bookings.pickupNone}</p>
            </>
          ) : (
            <p className="mt-2 leading-relaxed text-muted">{d.bookings.pickupLocked}</p>
          )}
          {hours && (
            <p className="mt-3 text-sm">
              <strong>{d.bookings.hours}:</strong> <span className="whitespace-pre-line">{hours}</span>
            </p>
          )}
          {(settings.contact_phone || settings.contact_email) && (
            <p className="mt-2 text-sm">
              <strong>{d.bookings.contact}:</strong>{' '}
              {settings.contact_phone && <a className="underline" href={`tel:${settings.contact_phone.replace(/[^+\d]/g, '')}`}>{settings.contact_phone}</a>}
              {settings.contact_phone && settings.contact_email && ' · '}
              {settings.contact_email && <a className="underline" href={`mailto:${settings.contact_email}`}>{settings.contact_email}</a>}
            </p>
          )}
        </section>

        {(open || requests.length > 0) && (
          <section className="card" aria-labelledby="requests-title">
            <h2 id="requests-title" className="text-lg font-bold">{d.bookings.requests}</h2>
            {open && (
              <>
                <p className="mt-1 mb-3 text-sm leading-relaxed text-muted">{d.bookings.requestsNote}</p>
                <RequestForms
                  bookingId={id}
                  min={toKlLocal(new Date())}
                  from={toKlLocal(booking.starts_at)}
                  to={toKlLocal(booking.ends_at)}
                  pendingKinds={requests.filter((r) => r.status === 'pending').map((r) => r.kind)}
                />
              </>
            )}
            {requests.length > 0 && (
              <>
                <h3 className="mt-4 font-bold">{d.bookings.history}</h3>
                <ul className="mt-2 space-y-3">
                  {requests.map((r) => (
                    <li key={r.id} className="rounded-xl border border-line-soft p-3 text-sm" data-testid={`request-${r.status}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <strong>{r.kind === 'cancellation' ? d.request.kindCancellation : d.request.kindDateChange}</strong>
                        <span className={`tag ${r.status === 'approved' ? 'tag-live' : r.status === 'pending' ? 'tag-warn' : ''}`}>{requestStatus[r.status]}</span>
                      </div>
                      <p className="text-muted">{formatDate(r.created_at, locale)}</p>
                      {r.requested_starts_at && r.requested_ends_at && (
                        <p className="mt-1">{formatDateTime(r.requested_starts_at, locale)} – {formatDateTime(r.requested_ends_at, locale)}</p>
                      )}
                      {r.message && <p className="mt-1 whitespace-pre-line">{r.message}</p>}
                      {r.admin_response && (
                        <p className="notice mt-2 whitespace-pre-line">
                          <strong>{d.request.ownerReply}:</strong> {r.admin_response}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </main>
    </>
  );
}
