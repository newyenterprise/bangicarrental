import Link from 'next/link';
import { BookingLink, Empty, PageTitle, StatusTag } from '@/components/admin/ui';
import { BOOKING_STATUS, PAYMENT_STATUS, RENTAL_STATUS } from '@/lib/admin/labels';
import { requireAdmin } from '@/lib/auth';
import { getLocale, pick } from '@/lib/i18n/server';
import { formatRM } from '@/lib/money';
import { createServiceClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/time';
import type { Booking } from '@/lib/types';

const FILTERS = ['upcoming', 'active', 'past', 'closed', 'attention'] as const;
type Filter = (typeof FILTERS)[number];

export default async function AdminBookingsPage({ searchParams }: PageProps<'/admin/bookings'>) {
  await requireAdmin('/admin/bookings');
  const params = await searchParams;
  const locale = await getLocale();
  const L = pick(locale);
  const filter: Filter = FILTERS.includes(params.filter as Filter) ? (params.filter as Filter) : 'upcoming';
  // Letters, digits and a few safe symbols only: the term goes into a PostgREST filter.
  const q = (typeof params.q === 'string' ? params.q : '').replace(/[^\p{L}\p{N}@._ -]/gu, '').trim().slice(0, 80);
  const now = new Date().toISOString();

  let query = createServiceClient().from('bookings').select('*').limit(100);
  if (q) {
    query = query.or(`reference.ilike.%${q}%,customer_name.ilike.%${q}%,customer_email.ilike.%${q}%`).order('starts_at', { ascending: false });
  } else if (filter === 'upcoming') {
    query = query.eq('status', 'confirmed').eq('rental_status', 'not_started').order('starts_at');
  } else if (filter === 'active') {
    query = query.eq('rental_status', 'picked_up').order('ends_at');
  } else if (filter === 'past') {
    query = query.or(`rental_status.eq.returned,and(status.eq.confirmed,ends_at.lt.${now})`).order('ends_at', { ascending: false });
  } else if (filter === 'closed') {
    query = query.in('status', ['cancelled', 'expired']).order('created_at', { ascending: false });
  } else {
    query = query.in('payment_status', ['needs_attention', 'processing']).order('updated_at', { ascending: false });
  }
  const { data } = await query;
  const bookings = (data ?? []) as Booking[];

  const labels: Record<Filter, string> = {
    upcoming: L('Akan datang', 'Upcoming'),
    active: L('Sedang disewa', 'On rental'),
    past: L('Lepas', 'Past'),
    closed: L('Batal / tamat', 'Cancelled / expired'),
    attention: L('Perlu perhatian', 'Needs attention'),
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title={L('Tempahan', 'Bookings')}>
        <Link href="/admin/calendar#manual" className="btn btn-secondary btn-sm">+ {L('Tempahan manual', 'Manual booking')}</Link>
      </PageTitle>

      <form method="get" className="mb-3 flex gap-2" role="search">
        <label className="sr-only" htmlFor="q">{L('Cari', 'Search')}</label>
        <input id="q" name="q" defaultValue={q} className="field-input" placeholder={L('Rujukan, nama atau emel', 'Reference, name or email')} />
        <button type="submit" className="btn">{L('Cari', 'Search')}</button>
      </form>

      <nav aria-label={L('Tapis', 'Filter')} className="mb-3 flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {FILTERS.map((key) => (
          <Link
            key={key}
            href={`/admin/bookings?filter=${key}`}
            aria-current={!q && key === filter ? 'page' : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-bold ${!q && key === filter ? 'bg-ink text-white' : 'bg-white hover:bg-mist'}`}
          >
            {labels[key]}
          </Link>
        ))}
      </nav>

      <div className="card">
        {bookings.length === 0 && <Empty>{q ? L('Tiada padanan.', 'No matches.') : L('Tiada tempahan dalam senarai ini.', 'No bookings in this list.')}</Empty>}
        {bookings.map((b) => (
          <BookingLink
            key={b.id}
            href={`/admin/bookings/${b.id}`}
            title={`${b.customer_name} · ${b.reference}`}
            meta={`${formatDateTime(b.starts_at, locale)} → ${formatDateTime(b.ends_at, locale)} · ${formatRM(b.rental_total_sen)}`}
            tags={
              <>
                <StatusTag status={b.status} labels={BOOKING_STATUS} L={L} />
                <StatusTag status={b.payment_status} labels={PAYMENT_STATUS} L={L} />
                {b.rental_status !== 'not_started' && <StatusTag status={b.rental_status} labels={RENTAL_STATUS} L={L} />}
              </>
            }
          />
        ))}
      </div>
    </div>
  );
}
