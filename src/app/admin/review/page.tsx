import { BookingLink, Empty, PageTitle } from '@/components/admin/ui';
import { requireAdmin } from '@/lib/auth';
import { getLocale, pick } from '@/lib/i18n/server';
import { createServiceClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/time';

type BookingRef = { id: string; reference: string; customer_name: string; starts_at: string; status: string };

export default async function AdminReviewPage() {
  await requireAdmin('/admin/review');
  const locale = await getLocale();
  const L = pick(locale);
  const db = createServiceClient();
  const select = 'id, full_name, is_primary, status, submitted_at, bookings!inner(id, reference, customer_name, starts_at, status)';
  const [{ data: waiting }, { data: corrections }] = await Promise.all([
    db.from('drivers').select(select).eq('status', 'submitted').eq('bookings.status', 'confirmed').order('submitted_at'),
    db.from('drivers').select(select).eq('status', 'correction_requested').eq('bookings.status', 'confirmed').order('reviewed_at'),
  ]);
  const ref = (value: unknown): BookingRef | null => (Array.isArray(value) ? (value[0] ?? null) : ((value as BookingRef) ?? null));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageTitle title={L('Semakan pemandu', 'Driver review')} />
      <section className="card" aria-labelledby="waiting-title">
        <h2 id="waiting-title" className="text-xl font-bold tracking-tight">{L('Menunggu semakan anda', 'Waiting for your review')} ({waiting?.length ?? 0})</h2>
        {(waiting ?? []).length === 0 && <Empty>{L('Semua sudah disemak.', 'Everything has been reviewed.')}</Empty>}
        {(waiting ?? []).map((row) => {
          const booking = ref(row.bookings);
          return booking ? (
            <BookingLink
              key={row.id}
              href={`/admin/bookings/${booking.id}#verification`}
              title={`${row.full_name || booking.customer_name}${row.is_primary ? '' : ` · ${L('pemandu tambahan', 'additional driver')}`}`}
              meta={`${booking.reference} · ${L('ambil', 'pickup')} ${formatDateTime(booking.starts_at, locale)}`}
              tags={<span className="tag tag-warn">{L('Semak', 'Review')}</span>}
            />
          ) : null;
        })}
      </section>
      <section className="card" aria-labelledby="corrections-title">
        <h2 id="corrections-title" className="text-xl font-bold tracking-tight">{L('Menunggu pembetulan penyewa', 'Waiting on the renter')} ({corrections?.length ?? 0})</h2>
        {(corrections ?? []).length === 0 && <Empty>{L('Tiada pembetulan tertunggak.', 'No corrections outstanding.')}</Empty>}
        {(corrections ?? []).map((row) => {
          const booking = ref(row.bookings);
          return booking ? (
            <BookingLink key={row.id} href={`/admin/bookings/${booking.id}#verification`} title={row.full_name || booking.customer_name} meta={`${booking.reference} · ${L('ambil', 'pickup')} ${formatDateTime(booking.starts_at, locale)}`} tags={<span className="tag tag-danger">{L('Pembetulan diminta', 'Correction requested')}</span>} />
          ) : null;
        })}
      </section>
    </div>
  );
}
