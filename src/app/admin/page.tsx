import Link from 'next/link';
import { BookingLink, Empty, PageTitle, Section } from '@/components/admin/ui';
import { PAYMENT_STATUS, REQUEST_KIND } from '@/lib/admin/labels';
import { requireAdmin } from '@/lib/auth';
import { computeBookingState } from '@/lib/booking-state';
import { getLocale, pick } from '@/lib/i18n/server';
import { formatRM } from '@/lib/money';
import { getLaunchStatus, getSettings } from '@/lib/settings';
import { createServiceClient } from '@/lib/supabase/server';
import { formatDate, formatDateTime, formatTime, klDateKey, klDayStart } from '@/lib/time';
import type { Agreement, Booking, DocumentRow, Driver } from '@/lib/types';

type Joined<T> = T | T[] | null;
const one = <T,>(value: Joined<T>): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);
type Ref = { id: string; reference: string; customer_name: string };

export default async function AdminTodayPage() {
  await requireAdmin('/admin');
  const locale = await getLocale();
  const L = pick(locale);
  const db = createServiceClient();
  const [launch, settings] = await Promise.all([getLaunchStatus(), getSettings()]);

  const today = klDateKey(new Date());
  const dayStart = klDayStart(today);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const range = { from: dayStart.toISOString(), to: dayEnd.toISOString() };

  const [pickups, returns, awaiting, unsigned, attention, refundIssues, requests, failedEmails] = await Promise.all([
    db.from('bookings').select('*').eq('status', 'confirmed').eq('rental_status', 'not_started').gte('starts_at', range.from).lt('starts_at', range.to).order('starts_at'),
    db.from('bookings').select('*').eq('status', 'confirmed').neq('rental_status', 'returned').gte('ends_at', range.from).lt('ends_at', range.to).order('ends_at'),
    db.from('drivers').select('id, full_name, submitted_at, bookings!inner(id, reference, customer_name, status)').eq('status', 'submitted').eq('bookings.status', 'confirmed').order('submitted_at'),
    db.from('agreements').select('id, version, created_at, bookings!inner(id, reference, customer_name, starts_at, status)').eq('status', 'pending_signature').eq('bookings.status', 'confirmed').order('created_at'),
    db.from('bookings').select('id, reference, customer_name, payment_status, rental_total_sen').in('payment_status', ['needs_attention', 'processing']).order('updated_at', { ascending: false }),
    db.from('refunds').select('id, amount_sen, status, bookings!inner(id, reference, customer_name)').in('status', ['failed', 'pending']).order('created_at', { ascending: false }),
    db.from('booking_requests').select('id, kind, created_at, bookings!inner(id, reference, customer_name)').eq('status', 'pending').order('created_at'),
    db.from('email_outbox').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
  ]);

  // Ready-for-pickup needs drivers, documents and the current agreement for today's bookings.
  const todays = [...((pickups.data ?? []) as Booking[]), ...((returns.data ?? []) as Booking[])];
  const ids = [...new Set(todays.map((b) => b.id))];
  const [driverRows, documentRows, agreementRows] = ids.length
    ? await Promise.all([
        db.from('drivers').select('*').in('booking_id', ids),
        db.from('documents').select('*').in('booking_id', ids).eq('status', 'active'),
        db.from('agreements').select('*').in('booking_id', ids).in('status', ['pending_signature', 'signed']),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const ready = (booking: Booking) =>
    computeBookingState({
      booking,
      drivers: ((driverRows.data ?? []) as Driver[]).filter((d) => d.booking_id === booking.id),
      documents: ((documentRows.data ?? []) as DocumentRow[]).filter((d) => d.booking_id === booking.id),
      agreement: ((agreementRows.data ?? []) as Agreement[]).find((a) => a.booking_id === booking.id) ?? null,
    }).readyForPickup;

  const modeLabel = launch.paymentMode === 'live' ? 'LIVE' : launch.paymentMode === 'test' ? L('UJIAN', 'TEST') : L('Belum ditetapkan', 'Not configured');
  const failedCount = failedEmails.count ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageTitle title={L('Hari ini', 'Today')}>
        <span className="text-sm text-muted">{formatDate(new Date(), locale)}</span>
      </PageTitle>

      {(!launch.complete || launch.paymentMode !== 'live' || !settings.live_payments_enabled) && (
        <Section id="launch" title={L('Persediaan pelancaran', 'Launch readiness')}>
          <dl>
            <div className="row-line">
              <dt>{L('Mod bayaran Stripe', 'Stripe payment mode')}</dt>
              <dd><span className={launch.paymentMode === 'live' ? 'tag tag-live' : 'tag tag-warn'}>{modeLabel}</span></dd>
            </div>
            <div className="row-line">
              <dt>{L('Bayaran sebenar', 'Live payments')}</dt>
              <dd>
                <span className={settings.live_payments_enabled ? 'tag tag-live' : 'tag'}>{settings.live_payments_enabled ? L('Dihidupkan', 'Enabled') : L('Dimatikan', 'Disabled')}</span>
              </dd>
            </div>
            <div className="row-line">
              <dt>{L('Tempahan awam', 'Public bookings')}</dt>
              <dd><span className={launch.bookingsOpen ? 'tag tag-live' : 'tag tag-danger'}>{launch.bookingsOpen ? L('Dibuka', 'Open') : L('Ditutup', 'Closed')}</span></dd>
            </div>
          </dl>
          {!launch.complete && (
            <>
              <p className="mt-3 text-sm font-semibold">{L('Perkara yang perlu dilengkapkan sebelum bayaran sebenar:', 'To complete before taking real payments:')}</p>
              <ul className="mt-1">
                {launch.items.map((item) => (
                  <li key={item.key}>
                    <Link href={item.href} className="flex min-h-11 items-center gap-3 border-b border-line-soft py-2 last:border-b-0">
                      <span className={item.done ? 'tag tag-live' : 'tag tag-warn'} aria-hidden>{item.done ? '✓' : '•'}</span>
                      <span className={item.done ? 'text-muted line-through' : 'font-semibold'}>{L(item.ms, item.en)}</span>
                      <span className="sr-only">{item.done ? L('selesai', 'done') : L('belum', 'to do')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          {launch.complete && !settings.live_payments_enabled && (
            <p className="notice mt-3 text-sm">
              {L('Senarai semak lengkap. Hidupkan bayaran sebenar di Tetapan apabila kunci Stripe live dipasang.', 'Checklist complete. Enable live payments in Settings once live Stripe keys are installed.')}{' '}
              <Link href="/admin/settings#live" className="underline">{L('Buka Tetapan', 'Open Settings')}</Link>
            </p>
          )}
        </Section>
      )}

      <Section id="pickups" title={`${L('Ambil hari ini', 'Pickups today')} (${pickups.data?.length ?? 0})`}>
        {(pickups.data ?? []).length === 0 && <Empty>{L('Tiada kereta diambil hari ini.', 'No pickups today.')}</Empty>}
        {((pickups.data ?? []) as Booking[]).map((b) => {
          const isReady = ready(b);
          return (
            <BookingLink
              key={b.id}
              href={`/admin/bookings/${b.id}#handover`}
              title={`${formatTime(b.starts_at, locale)} · ${b.customer_name}`}
              meta={`${b.reference}${b.deposit_status === 'due' ? ` · ${L('deposit perlu dikutip', 'deposit to collect')} ${formatRM(b.deposit_sen)}` : ''}`}
              tags={<span className={isReady ? 'tag tag-live' : 'tag tag-danger'}>{isReady ? L('Sedia', 'Ready') : L('Belum sedia', 'Not ready')}</span>}
            />
          );
        })}
      </Section>

      <Section id="returns" title={`${L('Pulang hari ini', 'Returns today')} (${returns.data?.length ?? 0})`}>
        {(returns.data ?? []).length === 0 && <Empty>{L('Tiada pemulangan hari ini.', 'No returns today.')}</Empty>}
        {((returns.data ?? []) as Booking[]).map((b) => (
          <BookingLink
            key={b.id}
            href={`/admin/bookings/${b.id}#handover`}
            title={`${formatTime(b.ends_at, locale)} · ${b.customer_name}`}
            meta={b.reference}
            tags={<span className={b.rental_status === 'picked_up' ? 'tag tag-warn' : 'tag'}>{b.rental_status === 'picked_up' ? L('Sedang disewa', 'On rental') : L('Belum diambil', 'Not picked up')}</span>}
          />
        ))}
      </Section>

      <Section id="review" title={`${L('Dokumen menunggu semakan', 'Documents awaiting review')} (${awaiting.data?.length ?? 0})`}>
        {(awaiting.data ?? []).length === 0 && <Empty>{L('Tiada dokumen menunggu.', 'Nothing waiting for review.')}</Empty>}
        {(awaiting.data ?? []).map((row) => {
          const booking = one(row.bookings as Joined<Ref>);
          return booking ? (
            <BookingLink key={row.id} href={`/admin/bookings/${booking.id}#verification`} title={row.full_name || booking.customer_name} meta={`${booking.reference}${row.submitted_at ? ` · ${formatDateTime(row.submitted_at, locale)}` : ''}`} tags={<span className="tag tag-warn">{L('Semak', 'Review')}</span>} />
          ) : null;
        })}
      </Section>

      <Section id="unsigned" title={`${L('Perjanjian belum ditandatangani', 'Unsigned agreements')} (${unsigned.data?.length ?? 0})`}>
        {(unsigned.data ?? []).length === 0 && <Empty>{L('Tiada perjanjian tertunggak.', 'No agreements outstanding.')}</Empty>}
        {(unsigned.data ?? []).map((row) => {
          const booking = one(row.bookings as Joined<Ref & { starts_at: string }>);
          return booking ? (
            <BookingLink key={row.id} href={`/admin/bookings/${booking.id}#agreement`} title={booking.customer_name} meta={`${booking.reference} · ${L('ambil', 'pickup')} ${formatDateTime(booking.starts_at, locale)}`} tags={<span className="tag tag-warn">v{row.version}</span>} />
          ) : null;
        })}
      </Section>

      <Section id="payments" title={`${L('Bayaran perlu perhatian', 'Payments needing attention')} (${(attention.data?.length ?? 0) + (refundIssues.data?.length ?? 0)})`}>
        {(attention.data ?? []).length + (refundIssues.data ?? []).length === 0 && <Empty>{L('Tiada isu bayaran.', 'No payment issues.')}</Empty>}
        {(attention.data ?? []).map((b) => (
          <BookingLink
            key={b.id}
            href={`/admin/bookings/${b.id}#payment`}
            title={b.customer_name}
            meta={`${b.reference} · ${formatRM(b.rental_total_sen)}`}
            tags={<span className={b.payment_status === 'needs_attention' ? 'tag tag-danger' : 'tag tag-warn'}>{L(...PAYMENT_STATUS[b.payment_status])}</span>}
          />
        ))}
        {(refundIssues.data ?? []).map((row) => {
          const booking = one(row.bookings as Joined<Ref>);
          return booking ? (
            <BookingLink
              key={row.id}
              href={`/admin/bookings/${booking.id}#payment`}
              title={booking.customer_name}
              meta={`${booking.reference} · ${L('bayaran balik', 'refund')} ${formatRM(row.amount_sen)}`}
              tags={<span className={row.status === 'failed' ? 'tag tag-danger' : 'tag tag-warn'}>{row.status === 'failed' ? L('Bayaran balik gagal', 'Refund failed') : L('Bayaran balik diproses', 'Refund pending')}</span>}
            />
          ) : null;
        })}
      </Section>

      <Section id="requests" title={`${L('Permintaan pelanggan', 'Customer requests')} (${requests.data?.length ?? 0})`}>
        {(requests.data ?? []).length === 0 && <Empty>{L('Tiada permintaan menunggu.', 'No requests waiting.')}</Empty>}
        {(requests.data ?? []).map((row) => {
          const booking = one(row.bookings as Joined<Ref>);
          return booking ? (
            <BookingLink key={row.id} href={`/admin/bookings/${booking.id}#requests`} title={booking.customer_name} meta={`${booking.reference} · ${formatDateTime(row.created_at, locale)}`} tags={<span className="tag tag-warn">{L(...REQUEST_KIND[row.kind])}</span>} />
          ) : null;
        })}
      </Section>

      {failedCount > 0 && (
        <p role="status" className="notice notice-danger font-semibold">
          {failedCount} {L('emel gagal dihantar selepas beberapa cubaan. Semak tetapan emel di Tetapan.', 'email(s) failed to send after several attempts. Check the email settings in Settings.')}{' '}
          <Link href="/admin/settings#integrations" className="underline">{L('Buka Tetapan', 'Open Settings')}</Link>
        </p>
      )}
    </div>
  );
}
