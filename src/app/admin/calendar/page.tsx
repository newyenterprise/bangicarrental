import Link from 'next/link';
import { AdminForm } from '@/components/admin/AdminForm';
import { Disclosure, Empty, PageTitle, Section } from '@/components/admin/ui';
import { BLOCK_REASON } from '@/lib/admin/labels';
import { requireAdmin } from '@/lib/auth';
import { getLocale, pick } from '@/lib/i18n/server';
import { createServiceClient } from '@/lib/supabase/server';
import { formatDateTime, klDateKey, klDayStart, toKlLocal } from '@/lib/time';
import { parseRange, type Vehicle } from '@/lib/types';
import { createBlockAction, createManualBookingAction, removeBlockAction } from './actions';

type Entry = {
  id: string;
  vehicle_id: string;
  kind: 'hold' | 'booking' | 'block';
  start: Date;
  end: Date;
  reason: string | null;
  note: string;
  booking_id: string | null;
  reference: string | null;
  customer_name: string | null;
};

type Unit = Vehicle & { vehicle_models: { name: string; prep_buffer_minutes: number; daily_rate_sen: number; deposit_sen: number } | null };

const COLOURS: Record<Entry['kind'], string> = { booking: 'bg-live text-live-ink', hold: 'bg-warn-soft text-warn-ink', block: 'bg-chip text-ink' };

export default async function AdminCalendarPage({ searchParams }: PageProps<'/admin/calendar'>) {
  await requireAdmin('/admin/calendar');
  const params = await searchParams;
  const locale = await getLocale();
  const L = pick(locale);
  const db = createServiceClient();

  const todayKey = klDateKey(new Date());
  const month = typeof params.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : todayKey.slice(0, 7);
  const [year, monthIndex] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(year, monthIndex - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const monthStart = klDayStart(`${month}-01`);
  const monthEnd = klDayStart(`${shift(1)}-01`);
  const monthLabel = new Intl.DateTimeFormat(locale === 'en' ? 'en-MY' : 'ms-MY', { month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(monthStart.getTime() + 43_200_000));
  // Monday-first offset of the 1st (Kuala Lumpur).
  const firstWeekday = (new Date(Date.UTC(year, monthIndex - 1, 1)).getUTCDay() + 6) % 7;
  const weekdays = locale === 'en' ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['I', 'S', 'R', 'K', 'J', 'S', 'A'];

  const [{ data: unitRows }, { data: occupancyRows }] = await Promise.all([
    db.from('vehicles').select('*, vehicle_models(name, prep_buffer_minutes, daily_rate_sen, deposit_sen)').order('active', { ascending: false }).order('created_at'),
    db
      .from('occupancy')
      .select('id, vehicle_id, kind, period, reason, note, booking_id, bookings(reference, customer_name)')
      .overlaps('period', `[${monthStart.toISOString()},${monthEnd.toISOString()})`),
  ]);
  const units = (unitRows ?? []) as Unit[];
  const entries: Entry[] = (occupancyRows ?? []).map((row) => {
    const range = parseRange(row.period as string);
    const booking = (Array.isArray(row.bookings) ? row.bookings[0] : row.bookings) as { reference: string; customer_name: string } | null;
    return {
      id: row.id,
      vehicle_id: row.vehicle_id,
      kind: row.kind,
      start: range.start,
      end: range.end,
      reason: row.reason,
      note: row.note,
      booking_id: row.booking_id,
      reference: booking?.reference ?? null,
      customer_name: booking?.customer_name ?? null,
    };
  });
  entries.sort((a, b) => a.start.getTime() - b.start.getTime());

  const unitOptions = units.filter((u) => u.active).map((u) => ({ value: u.id, label: `${u.vehicle_models?.name ?? ''} · ${u.label} ${u.registration_no}`.trim() }));
  const defaultStart = toKlLocal(new Date(klDayStart(todayKey).getTime() + 34 * 3600_000));
  const defaultEnd = toKlLocal(new Date(klDayStart(todayKey).getTime() + 58 * 3600_000));
  const describe = (e: Entry) =>
    e.kind === 'block' ? `${L('Sekatan', 'Block')} · ${e.reason ? L(...BLOCK_REASON[e.reason]) : '-'}` : e.kind === 'hold' ? `${L('Tahanan bayaran', 'Checkout hold')} · ${e.reference ?? ''}` : `${e.reference ?? ''} · ${e.customer_name ?? ''}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageTitle title={L('Kalendar', 'Calendar')} />
      <nav className="flex items-center justify-between gap-2" aria-label={L('Bulan', 'Month')}>
        <Link href={`/admin/calendar?month=${shift(-1)}`} className="btn btn-secondary btn-sm" aria-label={L('Bulan sebelum', 'Previous month')}>←</Link>
        <strong className="text-lg capitalize">{monthLabel}</strong>
        <Link href={`/admin/calendar?month=${shift(1)}`} className="btn btn-secondary btn-sm" aria-label={L('Bulan seterusnya', 'Next month')}>→</Link>
      </nav>
      <p className="flex flex-wrap gap-2 text-xs">
        <span className="tag tag-live">{L('Tempahan', 'Booking')}</span>
        <span className="tag tag-warn">{L('Tahanan bayaran', 'Checkout hold')}</span>
        <span className="tag">{L('Sekatan', 'Block')}</span>
        <span className="self-center text-muted">{L('Termasuk masa persediaan selepas pemulangan.', 'Includes preparation time after each return.')}</span>
      </p>

      {units.length === 0 && <Empty>{L('Tiada kereta. Tambah unit di Armada.', 'No cars yet. Add a unit in Fleet.')}</Empty>}
      {units.map((unit) => {
        const mine = entries.filter((e) => e.vehicle_id === unit.id);
        return (
          <Section key={unit.id} id={`unit-${unit.id}`} title={`${unit.vehicle_models?.name ?? ''} · ${unit.label || unit.registration_no || L('Unit', 'Unit')}`} aside={!unit.active ? <span className="tag">{L('Tidak aktif', 'Inactive')}</span> : undefined}>
            <div className="grid grid-cols-7 gap-1 text-center text-sm" role="grid" aria-label={monthLabel}>
              {weekdays.map((day, index) => (
                <span key={index} className="py-1 text-xs font-bold text-muted" aria-hidden>{day}</span>
              ))}
              {Array.from({ length: firstWeekday }, (_, index) => (
                <span key={`pad-${index}`} />
              ))}
              {Array.from({ length: daysInMonth }, (_, index) => {
                const key = `${month}-${String(index + 1).padStart(2, '0')}`;
                const dayStart = klDayStart(key);
                const dayEnd = new Date(dayStart.getTime() + 86_400_000);
                const hits = mine.filter((e) => e.start < dayEnd && e.end > dayStart);
                const kind = hits.find((e) => e.kind === 'booking')?.kind ?? hits[0]?.kind;
                return (
                  <span
                    key={key}
                    role="gridcell"
                    className={`grid min-h-10 place-items-center rounded-lg ${kind ? COLOURS[kind] : 'bg-white'} ${key === todayKey ? 'ring-2 ring-amber' : 'border border-line-soft'} ${kind ? 'font-bold' : ''}`}
                    title={hits.map(describe).join(' | ') || L('Kosong', 'Free')}
                  >
                    {index + 1}
                    <span className="sr-only">: {hits.length ? hits.map(describe).join(', ') : L('kosong', 'free')}</span>
                  </span>
                );
              })}
            </div>

            <ul className="mt-3">
              {mine.length === 0 && <li><Empty>{L('Tiada tempahan atau sekatan bulan ini.', 'No bookings or blocks this month.')}</Empty></li>}
              {mine.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-3 text-sm last:border-b-0">
                  <span>
                    <span className={`tag ${e.kind === 'booking' ? 'tag-live' : e.kind === 'hold' ? 'tag-warn' : ''}`}>{e.kind === 'booking' ? L('Tempahan', 'Booking') : e.kind === 'hold' ? L('Tahanan', 'Hold') : L('Sekatan', 'Block')}</span>{' '}
                    {e.booking_id ? (
                      <Link href={`/admin/bookings/${e.booking_id}`} className="font-bold underline">{describe(e)}</Link>
                    ) : (
                      <strong>{e.reason ? L(...BLOCK_REASON[e.reason]) : '-'}{e.note ? ` · ${e.note}` : ''}</strong>
                    )}
                    <span className="block text-muted">{formatDateTime(e.start, locale)} → {formatDateTime(e.end, locale)}</span>
                  </span>
                  {e.kind === 'block' && (
                    <AdminForm
                      action={removeBlockAction}
                      hidden={{ occupancy_id: e.id, form_id: `unblock-${e.id}-` }}
                      fields={[]}
                      compact
                      secondary
                      submitLabel={L('Buang', 'Remove')}
                      confirm={L('Buang sekatan ini dan buka semula tarikhnya untuk tempahan?', 'Remove this block and reopen its dates for bookings?')}
                    />
                  )}
                </li>
              ))}
            </ul>
          </Section>
        );
      })}

      <Section id="block" title={L('Sekat masa', 'Block time')}>
        <p className="field-hint mb-3">{L('Untuk kegunaan peribadi atau penyelenggaraan. Konflik dipaparkan sebelum sekatan dibuat.', 'For personal use or maintenance. Conflicts are shown before the block is made.')}</p>
        {unitOptions.length === 0 ? (
          <Empty>{L('Tiada kereta aktif.', 'No active cars.')}</Empty>
        ) : (
          <AdminForm
            action={createBlockAction}
            hidden={{ form_id: 'block-' }}
            submitLabel={L('Semak dan sekat', 'Check and block')}
            fields={[
              { name: 'vehicle_id', label: L('Kereta', 'Car'), type: 'select', required: true, options: unitOptions },
              { name: 'from', label: L('Dari', 'From'), type: 'datetime-local', required: true, defaultValue: defaultStart },
              { name: 'to', label: L('Hingga', 'Until'), type: 'datetime-local', required: true, defaultValue: defaultEnd },
              { name: 'reason', label: L('Sebab', 'Reason'), type: 'select', required: true, options: Object.entries(BLOCK_REASON).map(([value, label]) => ({ value, label: L(...label) })) },
              { name: 'note', label: L('Nota', 'Note') },
            ]}
          />
        )}
      </Section>

      <Section id="manual" title={L('Tempahan manual', 'Manual booking')}>
        <p className="field-hint mb-3">{L('Untuk tempahan melalui telefon atau WhatsApp. Kereta dikunci serta-merta; jumlah sewa dan deposit ditetapkan oleh anda.', 'For phone or WhatsApp bookings. The car is secured immediately; you set the rental total and deposit.')}</p>
        {unitOptions.length === 0 ? (
          <Empty>{L('Tiada kereta aktif.', 'No active cars.')}</Empty>
        ) : (
          <Disclosure summary={L('Tambah tempahan manual', 'Add a manual booking')}>
            <AdminForm
              action={createManualBookingAction}
              hidden={{ form_id: 'manual-' }}
              submitLabel={L('Semak dan tempah', 'Check and book')}
              confirm={L('Buat tempahan manual ini?', 'Create this manual booking?')}
              confirmFields={['vehicle_id', 'from', 'to', 'name', 'rental_total']}
              fields={[
                { name: 'vehicle_id', label: L('Kereta', 'Car'), type: 'select', required: true, options: unitOptions },
                { name: 'from', label: L('Ambil', 'Pickup'), type: 'datetime-local', required: true, defaultValue: defaultStart },
                { name: 'to', label: L('Pulang', 'Return'), type: 'datetime-local', required: true, defaultValue: defaultEnd },
                { name: 'name', label: L('Nama pelanggan', 'Customer name'), required: true },
                { name: 'email', label: L('Emel pelanggan', 'Customer email'), type: 'email', required: true, inputMode: 'email', hint: L('Pelanggan guna emel ini untuk log masuk.', 'The customer signs in with this email.') },
                { name: 'phone', label: L('Telefon', 'Phone'), type: 'tel', inputMode: 'tel' },
                { name: 'locale', label: L('Bahasa pelanggan', 'Customer language'), type: 'select', required: true, options: [{ value: 'ms', label: 'Bahasa Melayu' }, { value: 'en', label: 'English' }] },
                { name: 'rental_total', label: L('Jumlah sewa (RM)', 'Rental total (RM)'), required: true, inputMode: 'decimal' },
                { name: 'deposit', label: L('Deposit keselamatan (RM)', 'Security deposit (RM)'), required: true, inputMode: 'decimal', defaultValue: units[0]?.vehicle_models ? (units[0].vehicle_models.deposit_sen / 100).toFixed(2) : '0' },
                { name: 'paid_offline', label: L('Bayaran sewa sudah diterima di luar talian', 'Rental payment already received offline'), type: 'checkbox' },
                { name: 'payment_note', label: L('Nota bayaran (tunai, pindahan…)', 'Payment note (cash, transfer…)') },
              ]}
            />
          </Disclosure>
        )}
      </Section>
    </div>
  );
}
