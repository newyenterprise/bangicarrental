import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminForm } from '@/components/admin/AdminForm';
import { FileUpload } from '@/components/admin/FileUpload';
import { Disclosure, Empty, PageTitle, Row, Section, StatusTag } from '@/components/admin/ui';
import { actorEmails, loadBooking } from '@/lib/admin/data';
import {
  AGREEMENT_STATUS,
  ATTENTION_REASON,
  BOOKING_STATUS,
  DEPOSIT_KIND,
  DEPOSIT_STATUS,
  DOCUMENT_KIND,
  DRIVER_STATUS,
  FUEL_OPTIONS,
  PAYMENT_STATUS,
  REFUND_STATUS,
  RENTAL_STATUS,
  REQUEST_KIND,
  REQUEST_STATUS,
} from '@/lib/admin/labels';
import { requireAdmin } from '@/lib/auth';
import { isPaid, missingDocuments } from '@/lib/booking-state';
import { getLocale, pick } from '@/lib/i18n/server';
import { formatRM } from '@/lib/money';
import { createServiceClient } from '@/lib/supabase/server';
import { formatDate, formatDateTime, toKlLocal } from '@/lib/time';
import type { Vehicle } from '@/lib/types';
import {
  cancelBookingAction,
  decideDriverAction,
  decideRequestAction,
  deleteDocumentsAction,
  depositAction,
  handoverAction,
  moveBookingAction,
  offlinePaymentAction,
  refundAction,
} from './actions';

export default async function AdminBookingPage({ params }: PageProps<'/admin/bookings/[id]'>) {
  const { id } = await params;
  await requireAdmin(`/admin/bookings/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const locale = await getLocale();
  const L = pick(locale);
  const bundle = await loadBooking(id);
  if (!bundle) notFound();
  const { booking, model, vehicle, drivers, documents, agreements, currentAgreement, payments, refunds, requests, handovers, handoverPhotos, deposits, state } = bundle;

  const { data: unitRows } = await createServiceClient().from('vehicles').select('*, vehicle_models(name)').eq('active', true).order('created_at');
  const units = (unitRows ?? []) as (Vehicle & { vehicle_models: { name: string } | null })[];
  const emails = await actorEmails([...handovers.map((h) => h.recorded_by), ...deposits.map((d) => d.recorded_by), ...bundle.audit.map((a) => a.actor_id)]);
  const who = (userId: string | null) => (userId ? (emails.get(userId) ?? L('admin', 'admin')) : L('sistem', 'system'));

  const paidTotal = payments.filter((p) => p.status === 'succeeded').reduce((sum, p) => sum + p.amount_sen, 0);
  const refundCommitted = refunds.filter((r) => r.status !== 'failed').reduce((sum, r) => sum + r.amount_sen, 0);
  const refundable = Math.max(0, paidTotal - refundCommitted);
  const collected = deposits.filter((d) => d.kind === 'collected').reduce((s, d) => s + d.amount_sen, 0);
  const deducted = deposits.filter((d) => d.kind === 'deduction').reduce((s, d) => s + d.amount_sen, 0);
  const returned = deposits.filter((d) => d.kind === 'returned').reduce((s, d) => s + d.amount_sen, 0);
  const held = collected - deducted - returned;
  const pickup = handovers.find((h) => h.kind === 'pickup');
  const ret = handovers.find((h) => h.kind === 'return');
  const hidden = (form: string, extra: Record<string, string> = {}) => ({ booking_id: booking.id, form_id: `${form}-`, ...extra });

  // Exactly what still blocks handing over the keys.
  const missing: string[] = [];
  if (booking.status !== 'confirmed') missing.push(L('Tempahan belum disahkan', 'Booking is not confirmed'));
  if (!isPaid(booking)) missing.push(L('Caj sewa belum dibayar', 'Rental charge is not paid'));
  if (drivers.length === 0) missing.push(L('Tiada pemandu', 'No driver on the booking'));
  for (const d of drivers.filter((x) => x.status !== 'approved')) {
    missing.push(`${L('Pemandu belum diluluskan', 'Driver not approved')}: ${d.full_name || '-'}`);
  }
  if (!currentAgreement) missing.push(L('Perjanjian belum dijana', 'Agreement not generated'));
  else if (currentAgreement.status !== 'signed') missing.push(L('Perjanjian semasa belum ditandatangani', 'Current agreement is not signed'));

  const canChange = booking.status === 'confirmed' && booking.rental_status === 'not_started';
  const fuel = (n: number | null) => (n == null ? '-' : `${n}/8`);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageTitle title={booking.reference}>
        <Link href="/admin/bookings" className="btn-plain text-sm underline">
          ← {L('Semua tempahan', 'All bookings')}
        </Link>
      </PageTitle>

      {booking.payment_status === 'needs_attention' && (
        <p role="alert" className="notice notice-danger font-semibold">
          {booking.attention_reason && ATTENTION_REASON[booking.attention_reason] ? L(...ATTENTION_REASON[booking.attention_reason]) : L('Bayaran perlu perhatian.', 'This payment needs attention.')}
        </p>
      )}

      <Section id="status" title={L('Status', 'Status')} aside={state.readyForPickup && booking.rental_status === 'not_started' ? <span className="tag tag-live">{L('Sedia untuk diambil', 'Ready for pickup')}</span> : undefined}>
        <dl>
          <Row label={L('Tempahan', 'Booking')}><StatusTag status={booking.status} labels={BOOKING_STATUS} L={L} /></Row>
          <Row label={L('Bayaran sewa', 'Rental payment')}><StatusTag status={booking.payment_status} labels={PAYMENT_STATUS} L={L} /></Row>
          <Row label={L('Semakan pemandu', 'Driver verification')}>
            {drivers.length === 0 ? '-' : state.allApproved ? <span className="tag tag-live">{L('Semua diluluskan', 'All approved')}</span> : <span className="tag tag-warn">{`${drivers.filter((d) => d.status === 'approved').length}/${drivers.length} ${L('diluluskan', 'approved')}`}</span>}
          </Row>
          <Row label={L('Perjanjian', 'Agreement')}>
            {currentAgreement ? <StatusTag status={currentAgreement.status} labels={AGREEMENT_STATUS} L={L} /> : <span className="tag">{L('Belum dijana', 'Not generated')}</span>}
          </Row>
          <Row label={L('Sewaan', 'Rental')}><StatusTag status={booking.rental_status} labels={RENTAL_STATUS} L={L} /></Row>
          <Row label={L('Deposit keselamatan', 'Security deposit')}><StatusTag status={booking.deposit_status} labels={DEPOSIT_STATUS} L={L} /></Row>
        </dl>
      </Section>

      <Section id="renter" title={L('Penyewa', 'Renter')}>
        <dl>
          <Row label={L('Nama', 'Name')}>{booking.customer_name}</Row>
          <Row label={L('Emel', 'Email')}><a className="underline" href={`mailto:${booking.customer_email}`}>{booking.customer_email}</a></Row>
          <Row label={L('Telefon', 'Phone')}><a className="underline" href={`tel:${booking.customer_phone.replace(/[^+\d]/g, '')}`}>{booking.customer_phone || '-'}</a></Row>
          <Row label={L('Bahasa', 'Language')}>{booking.locale === 'en' ? 'English' : 'Bahasa Melayu'}</Row>
          <Row label={L('Sumber', 'Source')}>{booking.source === 'manual' ? L('Manual (admin)', 'Manual (admin)') : L('Laman web', 'Website')}</Row>
          <Row label={L('Akaun disahkan', 'Verified account')}>{booking.renter_id ? L('Ya', 'Yes') : L('Belum log masuk', 'Has not signed in yet')}</Row>
        </dl>
      </Section>

      <Section id="rental" title={L('Tarikh dan kereta', 'Dates and vehicle')}>
        <dl>
          <Row label={L('Ambil', 'Pickup')}>{formatDateTime(booking.starts_at, locale)}</Row>
          <Row label={L('Pulang', 'Return')}>{formatDateTime(booking.ends_at, locale)}</Row>
          <Row label={L('Tempoh', 'Duration')}>{booking.days} {L('hari', 'day(s)')}</Row>
          <Row label={L('Model', 'Model')}>{model?.name ?? '-'}</Row>
          <Row label={L('Unit', 'Unit')}>{vehicle ? `${vehicle.label || '-'} · ${vehicle.registration_no || L('tiada no. pendaftaran', 'no registration no.')}` : '-'}</Row>
        </dl>
        {canChange && (
          <>
            <Disclosure summary={L('Pindah tarikh atau kereta', 'Move dates or car')}>
              <p className="field-hint mb-3">
                {L('Konflik disemak dahulu dan dipaparkan sebelum apa-apa diubah. Harga asal dikekalkan. Jika perjanjian sudah ditandatangani, penyewa perlu menandatangani versi baharu.', 'Conflicts are checked first and shown before anything changes. The original price is kept. If the agreement was signed, the renter must sign a new version.')}
              </p>
              <AdminForm
                action={moveBookingAction}
                hidden={hidden('move')}
                submitLabel={L('Semak dan pindah', 'Check and move')}
                confirm={L('Pindahkan tempahan ini ke tarikh/kereta berikut?', 'Move this booking to the following dates/car?')}
                confirmFields={['vehicle_id', 'from', 'to']}
                fields={[
                  { name: 'vehicle_id', label: L('Kereta', 'Car'), type: 'select', required: true, defaultValue: booking.vehicle_id, options: units.map((u) => ({ value: u.id, label: `${u.vehicle_models?.name ?? ''} · ${u.label} ${u.registration_no}`.trim() })) },
                  { name: 'from', label: L('Ambil baharu', 'New pickup'), type: 'datetime-local', required: true, defaultValue: toKlLocal(booking.starts_at) },
                  { name: 'to', label: L('Pulang baharu', 'New return'), type: 'datetime-local', required: true, defaultValue: toKlLocal(booking.ends_at) },
                ]}
              />
            </Disclosure>
            <Disclosure summary={L('Batalkan tempahan', 'Cancel booking')}>
              <AdminForm
                action={cancelBookingAction}
                hidden={hidden('cancel')}
                danger
                submitLabel={L('Batalkan tempahan', 'Cancel booking')}
                confirm={L('Batalkan tempahan ini dan lepaskan tarikhnya? Bayaran balik tidak dibuat secara automatik.', 'Cancel this booking and release its dates? No refund is made automatically.')}
                fields={[{ name: 'reason', label: L('Sebab (dipaparkan kepada penyewa)', 'Reason (shown to the renter)'), type: 'textarea', required: true }]}
              />
            </Disclosure>
          </>
        )}
        {booking.status === 'cancelled' && (
          <p className="notice mt-3 text-sm">
            {L('Dibatalkan', 'Cancelled')} {booking.cancelled_at ? formatDateTime(booking.cancelled_at, locale) : ''}
            {booking.cancellation_reason ? ` · ${booking.cancellation_reason}` : ''}
          </p>
        )}
      </Section>

      <Section id="payment" title={L('Bayaran sewa', 'Rental payment')}>
        <dl>
          <Row label={L('Jumlah sewa', 'Rental total')}>{formatRM(booking.rental_total_sen)}</Row>
          <Row label={L('Diterima', 'Received')}>{formatRM(paidTotal)}</Row>
          <Row label={L('Dipulangkan', 'Refunded')}>{formatRM(booking.refunded_sen)}</Row>
          <Row label={L('Hasil sewa bersih', 'Net rental revenue')}>{formatRM(paidTotal - booking.refunded_sen)}</Row>
        </dl>
        <p className="field-hint">{L('Deposit keselamatan direkodkan berasingan di bawah dan bukan sebahagian daripada hasil sewa.', 'The security deposit is recorded separately below and is not part of rental revenue.')}</p>

        <h3 className="mt-4 font-bold">{L('Rekod bayaran', 'Payment records')}</h3>
        {payments.length === 0 && <Empty>{L('Tiada rekod bayaran.', 'No payment records.')}</Empty>}
        {payments.map((p) => (
          <dl key={p.id} className="mt-2 rounded-xl border border-line-soft px-3 text-sm">
            <Row label={L('Pembekal', 'Provider')}>
              {p.provider === 'manual' ? L('Luar talian', 'Offline') : p.provider === 'billplz' ? 'Billplz' : 'Stripe'} {p.provider !== 'manual' && <span className={p.livemode ? 'tag tag-live' : 'tag tag-warn'}>{p.livemode ? 'LIVE' : 'TEST'}</span>}
            </Row>
            <Row label={L('Status', 'Status')}>{p.status}</Row>
            <Row label={L('Jumlah', 'Amount')}>{formatRM(p.amount_sen)}</Row>
            {p.method && <Row label={L('Kaedah', 'Method')}>{p.method}</Row>}
            {p.paid_at && <Row label={L('Dibayar pada', 'Paid at')}>{formatDateTime(p.paid_at, locale)}</Row>}
            {p.checkout_session_id && <Row label="Checkout session"><code className="text-xs break-all">{p.checkout_session_id}</code></Row>}
            {p.payment_intent_id && <Row label="Payment intent"><code className="text-xs break-all">{p.payment_intent_id}</code></Row>}
            {p.note && <Row label={L('Nota', 'Note')}>{p.note}</Row>}
            {p.receipt_url && <Row label={L('Resit', 'Receipt')}><a className="underline" href={p.receipt_url} target="_blank" rel="noreferrer">{L('Buka resit', 'Open receipt')}</a></Row>}
          </dl>
        ))}

        {booking.status === 'confirmed' && booking.payment_status === 'unpaid' && (
          <Disclosure summary={L('Rekod bayaran luar talian', 'Record an offline payment')}>
            <AdminForm
              action={offlinePaymentAction}
              hidden={hidden('offline')}
              submitLabel={L('Rekod bayaran', 'Record payment')}
              confirm={L('Rekod bayaran sewa ini sebagai diterima di luar Stripe?', 'Record this rental payment as received outside Stripe?')}
              confirmFields={['amount']}
              fields={[
                { name: 'amount', label: L('Jumlah diterima (RM)', 'Amount received (RM)'), required: true, inputMode: 'decimal', defaultValue: (booking.rental_total_sen / 100).toFixed(2) },
                { name: 'note', label: L('Nota (tunai, pindahan bank…)', 'Note (cash, bank transfer…)') },
              ]}
            />
          </Disclosure>
        )}

        <h3 className="mt-4 font-bold">{L('Bayaran balik', 'Refunds')}</h3>
        {refunds.length === 0 && <Empty>{L('Tiada bayaran balik.', 'No refunds.')}</Empty>}
        {refunds.map((r) => (
          <div key={r.id} className="row-line text-sm">
            <span>
              {formatDateTime(r.created_at, locale)}
              <span className="block text-muted">{r.reason}</span>
              {r.provider_refund_id && <code className="block text-xs break-all text-muted">{r.provider_refund_id}</code>}
              {r.failure_reason && <span className="block text-danger">{r.failure_reason}</span>}
            </span>
            <span>
              {formatRM(r.amount_sen)}
              <br />
              <StatusTag status={r.status} labels={REFUND_STATUS} L={L} />
            </span>
          </div>
        ))}
        {refundable > 0 && (
          <Disclosure summary={`${L('Buat bayaran balik', 'Issue a refund')} (${L('baki', 'up to')} ${formatRM(refundable)})`} open={booking.payment_status === 'needs_attention'}>
            <AdminForm
              action={refundAction}
              hidden={hidden('refund', { idempotency_key: crypto.randomUUID() })}
              danger
              submitLabel={L('Semak bayaran balik', 'Review refund')}
              confirm={L('Wang akan dipulangkan kepada pelanggan. Tindakan ini tidak boleh dibatalkan.', 'Money will be returned to the customer. This cannot be undone.')}
              confirmFields={['amount', 'reason']}
              fields={[
                { name: 'amount', label: L('Jumlah bayaran balik (RM)', 'Refund amount (RM)'), required: true, inputMode: 'decimal', hint: `${L('Maksimum', 'Maximum')} ${formatRM(refundable)}` },
                { name: 'reason', label: L('Sebab (dipaparkan kepada penyewa)', 'Reason (shown to the renter)'), type: 'textarea', required: true, rows: 2 },
              ]}
            />
          </Disclosure>
        )}
      </Section>

      <Section id="verification" title={L('Semakan pemandu', 'Driver verification')}>
        {drivers.length === 0 && <Empty>{L('Pemandu ditambah selepas bayaran disahkan.', 'Drivers are added once payment is confirmed.')}</Empty>}
        {drivers.map((driver) => {
          const docs = documents.filter((doc) => doc.driver_id === driver.id && doc.status === 'active');
          const lacking = missingDocuments(driver.id, documents);
          return (
            <div key={driver.id} className="mt-3 rounded-xl border border-line-soft p-3 first:mt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>
                  {driver.full_name || L('(tiada nama)', '(no name)')} {driver.is_primary && <span className="tag ml-1">{L('Utama', 'Main')}</span>}
                </strong>
                <StatusTag status={driver.status} labels={DRIVER_STATUS} L={L} />
              </div>
              <dl className="text-sm">
                <Row label={driver.id_type === 'passport' ? L('Pasport', 'Passport') : 'MyKad'}>{driver.id_number || '-'}</Row>
                <Row label={L('Tarikh lahir', 'Date of birth')}>{driver.date_of_birth ? formatDate(`${driver.date_of_birth}T12:00:00+08:00`, locale) : '-'}</Row>
                <Row label={L('Telefon', 'Phone')}>{driver.phone || '-'}</Row>
                {driver.is_primary && <Row label={L('Alamat', 'Address')}>{driver.address || '-'}</Row>}
                <Row label={L('No. lesen', 'Licence no.')}>{driver.licence_number || '-'}</Row>
                <Row label={L('Lesen tamat', 'Licence expires')}>{driver.licence_expiry ? formatDate(`${driver.licence_expiry}T12:00:00+08:00`, locale) : '-'}</Row>
              </dl>
              <div className="mt-2 flex flex-wrap gap-2">
                {docs.map((doc) => (
                  <a key={doc.id} href={`/api/documents/${doc.id}`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                    {L(...DOCUMENT_KIND[doc.kind])} ↗
                  </a>
                ))}
                {lacking.map((kind) => (
                  <span key={kind} className="tag tag-warn self-center">{L('Tiada', 'Missing')}: {L(...DOCUMENT_KIND[kind])}</span>
                ))}
              </div>
              <p className="field-hint">{L('Pautan dokumen sah selama 60 saat dan setiap bukaan direkodkan dalam audit.', 'Document links last 60 seconds and every view is recorded in the audit log.')}</p>
              {driver.status === 'correction_requested' && driver.correction_reason && (
                <p className="notice notice-warn mt-2 text-sm">{L('Pembetulan diminta', 'Correction requested')}: {driver.correction_reason}</p>
              )}
              {driver.status !== 'draft' && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {driver.status !== 'approved' && (
                    <AdminForm
                      action={decideDriverAction}
                      hidden={hidden(`approve-${driver.id}`, { driver_id: driver.id, decision: 'approved' })}
                      compact
                      fields={[]}
                      submitLabel={L('Luluskan pemandu', 'Approve driver')}
                      confirm={`${L('Luluskan', 'Approve')} ${driver.full_name}? ${L('Pastikan butiran sepadan dengan dokumen.', 'Make sure the details match the documents.')}`}
                      disabled={lacking.length > 0}
                    />
                  )}
                  <Disclosure summary={L('Minta pembetulan', 'Request correction')}>
                    <AdminForm
                      action={decideDriverAction}
                      hidden={hidden(`correct-${driver.id}`, { driver_id: driver.id, decision: 'correction_requested' })}
                      compact
                      secondary
                      submitLabel={L('Hantar permintaan', 'Send request')}
                      fields={[{ name: 'reason', label: L('Apa yang perlu dibetulkan (penyewa akan nampak)', 'What needs correcting (the renter will see this)'), type: 'textarea', required: true, rows: 3 }]}
                    />
                  </Disclosure>
                </div>
              )}
            </div>
          );
        })}
        {documents.length > 0 && (
          <Disclosure summary={L('Padam dokumen pengenalan', 'Delete identity documents')}>
            <p className="field-hint mb-3">{L('Memadam fail daripada storan secara kekal. Perjanjian bertandatangan dikekalkan.', 'Permanently removes the files from storage. Signed agreements are kept.')}</p>
            <AdminForm
              action={deleteDocumentsAction}
              hidden={hidden('deldocs')}
              danger
              fields={[]}
              submitLabel={L('Padam dokumen', 'Delete documents')}
              confirm={L('Padam semua dokumen pengenalan dan lesen tempahan ini secara kekal?', 'Permanently delete all ID and licence documents for this booking?')}
            />
          </Disclosure>
        )}
      </Section>

      <Section id="agreement" title={L('Perjanjian', 'Agreement')}>
        {agreements.length === 0 && (
          <Empty>
            {state.allApproved
              ? L('Tiada perjanjian dijana. Pastikan templat diterbitkan di Admin > Perjanjian.', 'No agreement generated. Make sure a template is published in Admin > Agreement.')
              : L('Dijana selepas semua pemandu diluluskan.', 'Generated once every driver is approved.')}
          </Empty>
        )}
        {agreements.map((a) => (
          <div key={a.id} className="row-line text-sm">
            <span>
              {L('Versi', 'Version')} {a.version} · {a.locale === 'en' ? 'English' : 'BM'}
              <span className="block text-muted">
                {a.signed_at ? `${L('Ditandatangani', 'Signed')} ${formatDateTime(a.signed_at, locale)} · ${a.signer_name ?? ''}` : `${L('Dijana', 'Generated')} ${formatDateTime(a.created_at, locale)}`}
              </span>
            </span>
            <span>
              <StatusTag status={a.status} labels={AGREEMENT_STATUS} L={L} />
              {a.pdf_path && (
                <a href={`/api/agreements/${a.id}/pdf`} className="mt-1 block underline">
                  {L('Muat turun PDF', 'Download PDF')}
                </a>
              )}
            </span>
          </div>
        ))}
        {state.allApproved && !currentAgreement && (
          <Link href="/admin/agreement" className="btn btn-secondary btn-sm mt-3">{L('Urus templat perjanjian', 'Manage agreement templates')}</Link>
        )}
      </Section>

      <Section id="deposit" title={L('Deposit keselamatan', 'Security deposit')} aside={<StatusTag status={booking.deposit_status} labels={DEPOSIT_STATUS} L={L} />}>
        <dl>
          <Row label={L('Deposit dipersetujui', 'Agreed deposit')}>{formatRM(booking.deposit_sen)}</Row>
          <Row label={L('Dikutip', 'Collected')}>{formatRM(collected)}</Row>
          <Row label={L('Potongan', 'Deductions')}>{formatRM(deducted)}</Row>
          <Row label={L('Dipulangkan', 'Returned')}>{formatRM(returned)}</Row>
          <Row label={L('Masih dipegang', 'Still held')}>{formatRM(held)}</Row>
        </dl>
        {deposits.map((d) => (
          <div key={d.id} className="row-line text-sm">
            <span>
              {L(...DEPOSIT_KIND[d.kind])} · {formatDateTime(d.created_at, locale)}
              <span className="block text-muted">{[d.method, d.reason, who(d.recorded_by)].filter(Boolean).join(' · ')}</span>
            </span>
            <span>{formatRM(d.amount_sen)}</span>
          </div>
        ))}
        {booking.status === 'confirmed' && (
          <Disclosure summary={L('Rekod transaksi deposit', 'Record a deposit entry')}>
            <AdminForm
              action={depositAction}
              hidden={hidden('deposit', { idempotency_key: crypto.randomUUID() })}
              submitLabel={L('Semak dan rekod', 'Review and record')}
              confirm={L('Rekod transaksi deposit ini?', 'Record this deposit entry?')}
              confirmFields={['kind', 'amount', 'reason']}
              fields={[
                {
                  name: 'kind',
                  label: L('Jenis', 'Type'),
                  type: 'select',
                  required: true,
                  defaultValue: collected === 0 ? 'collected' : 'returned',
                  options: [
                    { value: 'collected', label: L('Dikutip daripada penyewa', 'Collected from renter') },
                    { value: 'deduction', label: L('Potongan (perlu sebab)', 'Deduction (reason required)') },
                    { value: 'returned', label: L('Dipulangkan kepada penyewa', 'Returned to renter') },
                  ],
                },
                { name: 'amount', label: L('Jumlah (RM)', 'Amount (RM)'), required: true, inputMode: 'decimal', defaultValue: collected === 0 ? (booking.deposit_sen / 100).toFixed(2) : held > 0 ? (held / 100).toFixed(2) : '' },
                {
                  name: 'method',
                  label: L('Kaedah', 'Method'),
                  type: 'select',
                  options: [
                    { value: 'cash', label: L('Tunai', 'Cash') },
                    { value: 'transfer', label: L('Pindahan bank', 'Bank transfer') },
                    { value: 'ewallet', label: 'E-wallet / DuitNow QR' },
                  ],
                },
                { name: 'reason', label: L('Sebab / nota', 'Reason / note'), type: 'textarea', rows: 2 },
              ]}
            />
          </Disclosure>
        )}
      </Section>

      <Section id="handover" title={L('Ambil dan pulang', 'Pickup and return')}>
        {booking.rental_status === 'not_started' && missing.length > 0 && (
          <div className="notice notice-warn text-sm">
            <strong>{L('Belum sedia untuk diambil:', 'Not ready for pickup yet:')}</strong>
            <ul className="mt-1 list-disc pl-5">
              {missing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {booking.rental_status === 'not_started' && missing.length === 0 && booking.deposit_status === 'due' && (
          <p className="notice notice-warn text-sm font-semibold">
            {L('Kutip deposit', 'Collect the deposit of')} {formatRM(booking.deposit_sen)} {L('semasa serahan dan rekodkan di bahagian Deposit.', 'at handover and record it in the Deposit section.')}
          </p>
        )}

        {[
          { kind: 'pickup' as const, record: pickup, title: L('Ambil kereta', 'Pickup'), allowed: booking.rental_status === 'not_started' ? missing.length === 0 : !!pickup },
          { kind: 'return' as const, record: ret, title: L('Pulang kereta', 'Return'), allowed: booking.rental_status === 'picked_up' || !!ret },
        ].map(({ kind, record, title, allowed }) => (
          <div key={kind} className="mt-4">
            <h3 className="font-bold">{title}</h3>
            {record ? (
              <>
                <dl className="text-sm">
                  <Row label={L('Odometer', 'Odometer')}>{record.mileage_km?.toLocaleString('en-MY') ?? '-'} km</Row>
                  <Row label={L('Bahan api', 'Fuel')}>{fuel(record.fuel_eighths)}</Row>
                  <Row label={L('Nota', 'Notes')}>{record.notes || '-'}</Row>
                  <Row label={L('Direkod oleh', 'Recorded by')}>{who(record.recorded_by)} · {formatDateTime(record.recorded_at, locale)}</Row>
                </dl>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {handoverPhotos
                    .filter((p) => p.handover_id === record.id)
                    .map((p, index) => (
                      <a key={p.id} href={`/api/admin/handover-photos/${p.id}`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                        {L('Gambar', 'Photo')} {index + 1} ↗
                      </a>
                    ))}
                  <FileUpload
                    url="/api/admin/handover-photos"
                    fields={{ handover_id: record.id }}
                    label={L('+ Gambar keadaan', '+ Condition photo')}
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    multiple
                    capture
                  />
                </div>
                <Disclosure summary={L('Betulkan rekod ini', 'Correct this record')}>
                  <AdminForm
                    action={handoverAction}
                    hidden={hidden(`${kind}-edit`, { kind })}
                    compact
                    secondary
                    submitLabel={L('Simpan pembetulan', 'Save correction')}
                    fields={[
                      { name: 'mileage_km', label: L('Odometer (km)', 'Odometer (km)'), type: 'number', required: true, min: 0, inputMode: 'numeric', defaultValue: String(record.mileage_km ?? '') },
                      { name: 'fuel_eighths', label: L('Paras bahan api', 'Fuel level'), type: 'select', required: true, options: FUEL_OPTIONS, defaultValue: String(record.fuel_eighths ?? 8) },
                      { name: 'notes', label: L('Nota keadaan', 'Condition notes'), type: 'textarea', defaultValue: record.notes },
                    ]}
                  />
                </Disclosure>
              </>
            ) : allowed ? (
              <AdminForm
                action={handoverAction}
                hidden={hidden(kind, { kind })}
                submitLabel={kind === 'pickup' ? L('Rekod ambil kereta', 'Record pickup') : L('Rekod pemulangan', 'Record return')}
                confirm={kind === 'pickup' ? L('Sahkan kunci diserahkan kepada penyewa?', 'Confirm the keys were handed to the renter?') : L('Sahkan kereta telah dipulangkan?', 'Confirm the car has been returned?')}
                confirmFields={['mileage_km', 'fuel_eighths']}
                fields={[
                  { name: 'mileage_km', label: L('Odometer (km)', 'Odometer (km)'), type: 'number', required: true, min: 0, inputMode: 'numeric' },
                  { name: 'fuel_eighths', label: L('Paras bahan api', 'Fuel level'), type: 'select', required: true, options: FUEL_OPTIONS, defaultValue: '8' },
                  { name: 'notes', label: L('Nota keadaan (calar, kebersihan…)', 'Condition notes (scratches, cleanliness…)'), type: 'textarea' },
                ]}
              />
            ) : (
              <Empty>{kind === 'pickup' ? L('Boleh direkod apabila tempahan sedia untuk diambil.', 'Can be recorded once the booking is ready for pickup.') : L('Boleh direkod selepas kereta diambil.', 'Can be recorded after the car is picked up.')}</Empty>
            )}
          </div>
        ))}
      </Section>

      <Section id="requests" title={L('Permintaan pelanggan', 'Customer requests')}>
        {requests.length === 0 && <Empty>{L('Tiada permintaan.', 'No requests.')}</Empty>}
        {requests.map((r) => (
          <div key={r.id} className="mt-3 rounded-xl border border-line-soft p-3 first:mt-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{L(...REQUEST_KIND[r.kind])}</strong>
              <StatusTag status={r.status} labels={REQUEST_STATUS} L={L} />
            </div>
            <p className="text-sm text-muted">{formatDateTime(r.created_at, locale)}</p>
            {r.kind === 'date_change' && r.requested_starts_at && r.requested_ends_at && (
              <p className="mt-1 text-sm font-semibold">
                {formatDateTime(r.requested_starts_at, locale)} – {formatDateTime(r.requested_ends_at, locale)}
              </p>
            )}
            {r.message && <p className="mt-1 text-sm whitespace-pre-line">{r.message}</p>}
            {r.admin_response && <p className="notice mt-2 text-sm">{L('Jawapan', 'Reply')}: {r.admin_response}</p>}
            {r.status === 'pending' && (
              <div className="mt-3">
                <p className="field-hint mb-2">
                  {r.kind === 'cancellation'
                    ? L('Meluluskan akan membatalkan tempahan dan melepaskan tarikh. Bayaran balik tidak dibuat secara automatik.', 'Approving cancels the booking and releases the dates. No refund is made automatically.')
                    : L('Meluluskan akan menyemak konflik dahulu, kemudian memindahkan tempahan ke tarikh yang diminta.', 'Approving checks for conflicts first, then moves the booking to the requested dates.')}
                </p>
                <AdminForm
                  action={decideRequestAction}
                  hidden={hidden(`request-${r.id}`, { request_id: r.id })}
                  compact
                  submitLabel={L('Hantar keputusan', 'Send decision')}
                  confirm={L('Hantar keputusan ini kepada penyewa?', 'Send this decision to the renter?')}
                  confirmFields={['decision', 'response']}
                  fields={[
                    {
                      name: 'decision',
                      label: L('Keputusan', 'Decision'),
                      type: 'select',
                      required: true,
                      options: [
                        { value: 'approved', label: L('Luluskan', 'Approve') },
                        { value: 'declined', label: L('Tolak', 'Decline') },
                      ],
                    },
                    { name: 'response', label: L('Mesej kepada penyewa', 'Message to the renter'), type: 'textarea', rows: 2 },
                  ]}
                />
              </div>
            )}
          </div>
        ))}
      </Section>

      <Section id="activity" title={L('Sejarah aktiviti', 'Activity history')}>
        {bundle.audit.length === 0 && <Empty>{L('Tiada aktiviti direkodkan.', 'No activity recorded.')}</Empty>}
        <ol>
          {bundle.audit.map((entry) => (
            <li key={entry.id} className="row-line text-sm">
              <span>
                <code className="text-xs">{entry.action}</code>
                <span className="block text-muted">{entry.actor_role === 'system' ? L('sistem', 'system') : `${entry.actor_role} · ${who(entry.actor_id)}`}</span>
              </span>
              <span className="font-normal text-muted">{formatDateTime(entry.created_at, locale)}</span>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
