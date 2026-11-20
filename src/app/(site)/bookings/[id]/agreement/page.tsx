import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteChrome';
import { ensureAgreementCurrent } from '@/lib/agreements';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/i18n/config';
import { getI18n } from '@/lib/i18n/server';
import { UUID } from '@/lib/renter/data';
import { createUserClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/time';
import type { Agreement, Booking, Driver } from '@/lib/types';
import { SignForm } from './SignForm';

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: d.agreement.metaTitle, robots: { index: false } };
}

/** "## " lines are headings, "- " lines are list items, everything else is a paragraph. */
function AgreementBody({ body }: { body: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`l${blocks.length}`} className="my-2 list-disc space-y-1 pl-6">
        {list.map((item, i) => <li key={i}>{item}</li>)}
      </ul>,
    );
    list = [];
  };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('- ')) {
      list.push(line.slice(2));
      continue;
    }
    flush();
    if (!line) continue;
    if (line.startsWith('## ')) blocks.push(<h3 key={blocks.length} className="mt-5 mb-1 font-bold first:mt-0">{line.slice(3)}</h3>);
    else blocks.push(<p key={blocks.length} className="my-1.5">{line}</p>);
  }
  flush();
  return <>{blocks}</>;
}

export default async function AgreementPage({ params }: PageProps<'/bookings/[id]/agreement'>) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requireUser(`/bookings/${id}/agreement`);
  const { locale, d } = await getI18n();

  const supabase = await createUserClient();
  const { data: bookingRow } = await supabase.from('bookings').select('*').eq('id', id).maybeSingle();
  if (!bookingRow || bookingRow.renter_id !== user.id) notFound();
  const booking = bookingRow as Booking;

  const loadAgreements = async () =>
    ((await supabase.from('agreements').select('*').eq('booking_id', id).order('version', { ascending: false })).data ?? []) as Agreement[];
  const { data: driverRows } = await supabase.from('drivers').select('*').eq('booking_id', id).order('is_primary', { ascending: false });
  const drivers = (driverRows ?? []) as Driver[];

  let agreements = await loadAgreements();
  let agreement = agreements.find((a) => a.status !== 'superseded') ?? null;
  const allApproved = drivers.length > 0 && drivers.every((x) => x.status === 'approved');
  if (!agreement && allApproved && booking.status === 'confirmed') {
    // Generated lazily in case it was not created at approval time (for example no template was published yet).
    await ensureAgreementCurrent(id);
    agreements = await loadAgreements();
    agreement = agreements.find((a) => a.status !== 'superseded') ?? null;
  }
  const hadEarlier = agreements.some((a) => a.status === 'superseded' && a.signed_at);
  const primary = drivers.find((x) => x.is_primary) ?? drivers[0];

  return (
    <>
      <SiteHeader />
      <main className="container-narrow space-y-5 py-4">
        <Link href={`/bookings/${id}`} className="btn-plain -ml-2 text-sm">
          <span aria-hidden>←</span>&nbsp;{d.common.back}
        </Link>

        {!agreement ? (
          <div className="card">
            <h1 className="h-display text-3xl">{d.agreement.notReadyTitle}</h1>
            <p className="mt-3 leading-relaxed text-muted">{d.agreement.notReadyBody}</p>
          </div>
        ) : (
          <>
            <header>
              <h1 className="h-display text-3xl">{agreement.title}</h1>
              <p className="mt-1 text-sm text-muted">
                {booking.reference} · {fmt(d.agreement.version, { n: agreement.version })}
              </p>
            </header>

            {agreement.status === 'signed' ? (
              <div className="notice" data-testid="agreement-signed">
                <strong>{d.agreement.signedTitle}</strong>
                <p className="mt-1">{fmt(d.agreement.signedBody, { name: agreement.signer_name ?? '', date: formatDateTime(agreement.signed_at!, locale) })}</p>
                <a href={`/api/agreements/${agreement.id}/pdf`} className="btn mt-3 w-full sm:w-auto" data-testid="download-agreement">
                  {d.agreement.download}
                </a>
              </div>
            ) : (
              <>
                {hadEarlier && <p className="notice notice-warn">{d.agreement.supersededNote}</p>}
                <p className="font-semibold">{d.agreement.readAll}</p>
              </>
            )}

            <section
              className="card max-h-[70vh] overflow-y-auto text-[15px] leading-relaxed"
              tabIndex={0}
              aria-label={agreement.title}
              lang={agreement.locale}
              data-testid="agreement-body"
            >
              <AgreementBody body={agreement.rendered_body} />
            </section>

            {agreement.status === 'pending_signature' && (
              <section className="card" aria-label={d.agreement.sign}>
                <SignForm key={agreement.id} agreementId={agreement.id} defaultName={primary?.full_name ?? booking.customer_name} />
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
