import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteChrome';
import { DriverStatusTag } from '@/components/renter/StatusTags';
import { requireUser } from '@/lib/auth';
import { driverDetailsComplete, missingDocuments } from '@/lib/booking-state';
import { getI18n } from '@/lib/i18n/server';
import { UUID, driverEditable } from '@/lib/renter/data';
import { createUserClient } from '@/lib/supabase/server';
import { klDateKey } from '@/lib/time';
import type { Booking, DocumentRow, Driver } from '@/lib/types';
import { DocumentUpload } from './DocumentUpload';
import { DriverForm } from './DriverForm';
import { SubmitDriver } from './SubmitDriver';

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: d.driver.metaTitle, robots: { index: false } };
}

export default async function DriverPage({ params }: PageProps<'/bookings/[id]/drivers/[driverId]'>) {
  const { id, driverId } = await params;
  if (!UUID.test(id) || !UUID.test(driverId)) notFound();
  const user = await requireUser(`/bookings/${id}/drivers/${driverId}`);
  const { d } = await getI18n();

  // Read through the renter's session: RLS hides other renters' drivers and documents.
  const supabase = await createUserClient();
  const [{ data: bookingRow }, { data: driverRow }, { data: docRows }] = await Promise.all([
    supabase.from('bookings').select('*').eq('id', id).maybeSingle(),
    supabase.from('drivers').select('*').eq('id', driverId).eq('booking_id', id).maybeSingle(),
    supabase.from('documents').select('*').eq('driver_id', driverId).eq('status', 'active'),
  ]);
  if (!bookingRow || bookingRow.renter_id !== user.id || !driverRow) notFound();
  const booking = bookingRow as Booking;
  const driver = driverRow as Driver;
  const documents = (docRows ?? []) as DocumentRow[];

  const editable = driverEditable(booking, driver);
  const ready = driverDetailsComplete(driver) && missingDocuments(driver.id, documents).length === 0;
  const docId = (kind: 'identity' | 'licence') => documents.find((x) => x.kind === kind)?.id ?? null;

  return (
    <>
      <SiteHeader />
      <main className="container-narrow space-y-5 py-4">
        <Link href={`/bookings/${id}`} className="btn-plain -ml-2 text-sm">
          <span aria-hidden>←</span>&nbsp;{d.common.back}
        </Link>
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="h-display text-3xl">{d.driver.title}</h1>
            <p className="mt-1 text-sm text-muted">
              {driver.is_primary ? d.bookings.primaryDriver : d.bookings.additionalDriver} · {booking.reference}
            </p>
          </div>
          <DriverStatusTag status={driver.status} d={d} />
        </header>

        {driver.status === 'correction_requested' && (
          <div className="notice notice-danger" role="alert" data-testid="correction-reason">
            <strong>{d.driver.correctionTitle}</strong>
            <p className="mt-1 whitespace-pre-line">{driver.correction_reason}</p>
          </div>
        )}
        {driver.status === 'submitted' && <p className="notice notice-warn">{d.driver.lockedSubmitted}</p>}
        {driver.status === 'approved' && <p className="notice">{d.driver.lockedApproved}</p>}

        <section className="card" aria-labelledby="details-title">
          <h2 id="details-title" className="text-lg font-bold">{d.driver.title}</h2>
          {editable && <p className="mt-1 mb-4 text-sm text-muted">{d.driver.intro}</p>}
          <div className={editable ? '' : 'mt-4'}>
            <DriverForm
              driverId={driver.id}
              isPrimary={driver.is_primary}
              editable={editable}
              minExpiry={klDateKey(booking.ends_at)}
              initial={{
                full_name: driver.full_name,
                id_type: driver.id_type,
                id_number: driver.id_number,
                date_of_birth: driver.date_of_birth ?? '',
                phone: driver.phone,
                address: driver.address,
                licence_number: driver.licence_number,
                licence_expiry: driver.licence_expiry ?? '',
              }}
            />
          </div>
        </section>

        <section className="card" aria-labelledby="documents-title">
          <h2 id="documents-title" className="text-lg font-bold">{d.driver.documents}</h2>
          {editable && (
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {d.driver.photoTips} {d.driver.fileRules}
            </p>
          )}
          <div className="mt-3 space-y-3">
            <DocumentUpload driverId={driver.id} kind="identity" label={d.driver.identityDoc} documentId={docId('identity')} editable={editable} />
            <DocumentUpload driverId={driver.id} kind="licence" label={d.driver.licenceDoc} documentId={docId('licence')} editable={editable} />
          </div>
        </section>

        {editable && <SubmitDriver driverId={driver.id} ready={ready} />}
      </main>
    </>
  );
}
