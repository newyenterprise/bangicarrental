import Link from 'next/link';
import { Empty, PageTitle } from '@/components/admin/ui';
import { actorEmails } from '@/lib/admin/data';
import { requireAdmin } from '@/lib/auth';
import { getLocale, pick } from '@/lib/i18n/server';
import { createServiceClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/time';
import type { AuditEntry } from '@/lib/types';

const PAGE_SIZE = 50;

export default async function AdminAuditPage({ searchParams }: PageProps<'/admin/audit'>) {
  await requireAdmin('/admin/audit');
  const params = await searchParams;
  const locale = await getLocale();
  const L = pick(locale);
  const db = createServiceClient();
  const page = Math.max(1, Math.min(500, Number(typeof params.page === 'string' ? params.page : '1') || 1));
  const reference = (typeof params.ref === 'string' ? params.ref : '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);

  let bookingId: string | null = null;
  let unknownReference = false;
  if (reference) {
    const { data } = await db.from('bookings').select('id').eq('reference', reference).maybeSingle();
    bookingId = data?.id ?? null;
    unknownReference = !bookingId;
  }

  let entries: AuditEntry[] = [];
  let hasMore = false;
  if (!unknownReference) {
    let query = db.from('audit_log').select('*').order('created_at', { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    if (bookingId) query = query.eq('booking_id', bookingId);
    const { data } = await query;
    const rows = (data ?? []) as AuditEntry[];
    hasMore = rows.length > PAGE_SIZE;
    entries = rows.slice(0, PAGE_SIZE);
  }

  const emails = await actorEmails(entries.map((e) => e.actor_id));
  const bookingIds = [...new Set(entries.map((e) => e.booking_id).filter((v): v is string => !!v))];
  const { data: refs } = bookingIds.length ? await db.from('bookings').select('id, reference').in('id', bookingIds) : { data: [] };
  const refOf = new Map((refs ?? []).map((r) => [r.id, r.reference]));
  const link = (target: number) => `/admin/audit?page=${target}${reference ? `&ref=${reference}` : ''}`;

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title={L('Log audit', 'Audit log')} />
      <form method="get" className="mb-3 flex gap-2" role="search">
        <label className="sr-only" htmlFor="ref">{L('Rujukan tempahan', 'Booking reference')}</label>
        <input id="ref" name="ref" defaultValue={reference} className="field-input" placeholder="BCR-XXXXXX" autoCapitalize="characters" />
        <button type="submit" className="btn">{L('Tapis', 'Filter')}</button>
        {reference && <Link href="/admin/audit" className="btn btn-secondary">{L('Semua', 'All')}</Link>}
      </form>

      <div className="card">
        {unknownReference && <Empty>{L('Tiada tempahan dengan rujukan ini.', 'No booking with this reference.')}</Empty>}
        {!unknownReference && entries.length === 0 && <Empty>{L('Tiada rekod.', 'No entries.')}</Empty>}
        <ol>
          {entries.map((entry) => {
            const meta = Object.keys(entry.metadata ?? {}).length ? JSON.stringify(entry.metadata) : '';
            return (
              <li key={entry.id} className="border-b border-line-soft py-3 text-sm last:border-b-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <code className="font-bold">{entry.action}</code>
                  <span className="text-muted">{formatDateTime(entry.created_at, locale)}</span>
                </div>
                <p className="text-muted">
                  {entry.actor_role === 'system' ? L('sistem', 'system') : `${entry.actor_role} · ${entry.actor_id ? (emails.get(entry.actor_id) ?? entry.actor_id.slice(0, 8)) : '-'}`}
                  {entry.booking_id && (
                    <>
                      {' · '}
                      <Link href={`/admin/bookings/${entry.booking_id}`} className="underline">{refOf.get(entry.booking_id) ?? L('tempahan', 'booking')}</Link>
                    </>
                  )}
                </p>
                {meta && <p className="mt-1 font-mono text-xs break-all text-muted">{meta.slice(0, 400)}</p>}
              </li>
            );
          })}
        </ol>
      </div>

      <nav className="mt-3 flex justify-between" aria-label={L('Halaman', 'Pages')}>
        {page > 1 ? <Link href={link(page - 1)} className="btn btn-secondary btn-sm">← {L('Lebih baharu', 'Newer')}</Link> : <span />}
        {hasMore ? <Link href={link(page + 1)} className="btn btn-secondary btn-sm">{L('Lebih lama', 'Older')} →</Link> : <span />}
      </nav>
    </div>
  );
}
