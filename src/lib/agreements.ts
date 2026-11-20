import 'server-only';
import { createHash } from 'node:crypto';
import { audit } from './audit';
import type { SessionUser } from './auth';
import { enqueueEmail } from './email/outbox';
import type { Locale } from './i18n/config';
import { formatRM } from './money';
import { renderAgreementPdf } from './pdf';
import { getSettings, localized } from './settings';
import { BUCKETS, uploadPrivate } from './storage';
import { createServiceClient } from './supabase/server';
import { formatDateTime } from './time';
import type { Agreement, AgreementTemplate, Booking, Driver, Vehicle, VehicleModel } from './types';

export const AGREEMENT_PLACEHOLDERS = [
  'company_name',
  'booking_reference',
  'renter_name',
  'renter_id_number',
  'vehicle_name',
  'registration_no',
  'pickup_at',
  'return_at',
  'days',
  'daily_rate',
  'rental_total',
  'deposit',
  'drivers',
  'pickup_area',
  'cancellation_terms',
] as const;

export function renderTemplate(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => (key in values ? values[key] : match)).trim();
}

/** Latest agreement that is awaiting signature or signed (never a superseded one). */
export async function getCurrentAgreement(bookingId: string): Promise<Agreement | null> {
  const { data } = await createServiceClient()
    .from('agreements')
    .select('*')
    .eq('booking_id', bookingId)
    .in('status', ['pending_signature', 'signed'])
    .maybeSingle();
  return (data as Agreement) ?? null;
}

type Loaded = { booking: Booking; drivers: Driver[]; model: VehicleModel; vehicle: Vehicle };

async function load(bookingId: string): Promise<Loaded | null> {
  const db = createServiceClient();
  const { data: booking } = await db.from('bookings').select('*').eq('id', bookingId).maybeSingle();
  if (!booking) return null;
  const [{ data: drivers }, { data: model }, { data: vehicle }] = await Promise.all([
    db.from('drivers').select('*').eq('booking_id', bookingId).order('is_primary', { ascending: false }).order('created_at'),
    db.from('vehicle_models').select('*').eq('id', booking.model_id).single(),
    db.from('vehicles').select('*').eq('id', booking.vehicle_id).single(),
  ]);
  if (!model || !vehicle) return null;
  return { booking: booking as Booking, drivers: (drivers ?? []) as Driver[], model: model as VehicleModel, vehicle: vehicle as Vehicle };
}

/** Fingerprint of everything material to the agreement. A change means a fresh signature. */
function detailsHash({ booking, drivers, vehicle }: Loaded): string {
  const material = {
    vehicle: [vehicle.id, vehicle.registration_no],
    period: [booking.starts_at, booking.ends_at],
    money: [booking.days, booking.daily_rate_sen, booking.rental_total_sen, booking.deposit_sen],
    drivers: drivers.map((d) => [d.id, d.full_name, d.id_type, d.id_number, d.licence_number]),
  };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

export type EnsureResult = 'created' | 'unchanged' | 'not_ready' | 'no_template';

/**
 * Makes sure the booking has an agreement that matches its current details.
 * Called after a driver is approved and after any material change. When the
 * details differ from the current agreement, that one is kept as superseded
 * and a new version is generated for signature.
 */
export async function ensureAgreementCurrent(bookingId: string, actor: SessionUser | null = null): Promise<EnsureResult> {
  const db = createServiceClient();
  const loaded = await load(bookingId);
  if (!loaded) return 'not_ready';
  const { booking, drivers, model, vehicle } = loaded;
  const allApproved = drivers.length > 0 && drivers.every((d) => d.status === 'approved');
  if (booking.status !== 'confirmed' || !allApproved) return 'not_ready';

  const hash = detailsHash(loaded);
  const current = await getCurrentAgreement(bookingId);
  if (current?.details_hash === hash) return 'unchanged';

  const { data: templates } = await db.from('agreement_templates').select('*').eq('status', 'published');
  const published = (templates ?? []) as AgreementTemplate[];
  const template = published.find((t) => t.locale === booking.locale) ?? published[0];
  if (!template) return 'no_template';

  const locale: Locale = template.locale;
  const settings = await getSettings();
  const primary = drivers.find((d) => d.is_primary) ?? drivers[0];
  const body = renderTemplate(template.body, {
    company_name: settings.company_name || settings.display_name,
    booking_reference: booking.reference,
    renter_name: primary.full_name,
    renter_id_number: primary.id_number,
    vehicle_name: [model.name, vehicle.notes].filter(Boolean).join(' · '),
    registration_no: vehicle.registration_no || '-',
    pickup_at: formatDateTime(booking.starts_at, locale),
    return_at: formatDateTime(booking.ends_at, locale),
    days: String(booking.days),
    daily_rate: formatRM(booking.daily_rate_sen),
    rental_total: formatRM(booking.rental_total_sen),
    deposit: formatRM(booking.deposit_sen),
    drivers: drivers.map((d) => `${d.full_name} (${d.licence_number})`).join('; '),
    pickup_area: settings.pickup_area,
    cancellation_terms: localized(settings, 'cancellation_terms', locale) || '-',
  });

  if (current) await db.from('agreements').update({ status: 'superseded' }).eq('id', current.id);
  const { data: last } = await db.from('agreements').select('version').eq('booking_id', bookingId).order('version', { ascending: false }).limit(1).maybeSingle();
  const version = (last?.version ?? 0) + 1;
  const { data: created, error } = await db
    .from('agreements')
    .insert({ booking_id: bookingId, version, template_id: template.id, locale, title: template.title, rendered_body: body, details_hash: hash })
    .select('id')
    .single();
  // A concurrent call already created the current version: the unique index kept it to one.
  if (error || !created) return 'unchanged';

  await audit({ actor, action: 'agreement.generated', bookingId, entityType: 'agreement', entityId: created.id, metadata: { version, template_version: template.version, locale, replaced: current?.id ?? null } });
  await enqueueEmail({ dedupeKey: `agreement_ready:${bookingId}:v${version}`, to: booking.customer_email, locale: booking.locale, template: 'agreement_ready', bookingId });
  return 'created';
}

export type SignResult = { ok: true } | { ok: false; code: 'errStale' | 'errFailed' };

/**
 * Records the renter's acceptance: signer identity, server timestamp, the
 * drawn signature and a PDF of exactly what was shown. The stored PDF is the
 * single copy both the renter and the admin download.
 */
export async function signAgreement(input: {
  agreementId: string;
  user: SessionUser;
  signerName: string;
  signaturePng: Uint8Array;
  ip: string | null;
  userAgent: string | null;
}): Promise<SignResult> {
  const db = createServiceClient();
  const { data } = await db.from('agreements').select('*').eq('id', input.agreementId).maybeSingle();
  const agreement = data as Agreement | null;
  if (!agreement || agreement.status !== 'pending_signature') return { ok: false, code: 'errStale' };

  const loaded = await load(agreement.booking_id);
  if (!loaded || loaded.booking.renter_id !== input.user.id) return { ok: false, code: 'errFailed' };
  // Details changed while the page was open: do not sign a stale version.
  if (detailsHash(loaded) !== agreement.details_hash) {
    await ensureAgreementCurrent(agreement.booking_id);
    return { ok: false, code: 'errStale' };
  }

  const signedAt = new Date();
  const locale = agreement.locale;
  const L = (bm: string, en: string) => (locale === 'en' ? en : bm);
  let pdf: Uint8Array;
  try {
    pdf = await renderAgreementPdf({
      title: agreement.title,
      subtitle: `${loaded.booking.reference} · ${L('Versi', 'Version')} ${agreement.version}`,
      body: agreement.rendered_body,
      signature: {
        heading: L('Tandatangan Penyewa', 'Renter signature'),
        image: input.signaturePng,
        rows: [
          [L('Nama', 'Name'), input.signerName],
          [L('Emel disahkan', 'Verified email'), input.user.email],
          [L('Ditandatangani pada', 'Signed at'), `${formatDateTime(signedAt, locale)} (Asia/Kuala_Lumpur) · ${signedAt.toISOString()}`],
          [L('Rujukan tempahan', 'Booking reference'), loaded.booking.reference],
          [L('ID dokumen', 'Document ID'), `${agreement.id} v${agreement.version}`],
        ],
        footer: L(
          'Ditandatangani secara elektronik. Penandatangan mengesahkan telah membaca dan bersetuju dengan perjanjian ini. Masa direkodkan oleh pelayan.',
          'Signed electronically. The signer confirmed they had read and agreed to this agreement. The time was recorded by the server.',
        ),
      },
    });
  } catch {
    return { ok: false, code: 'errFailed' };
  }

  const base = `${agreement.booking_id}/${agreement.id}`;
  const signaturePath = `${base}-signature.png`;
  const pdfPath = `${base}.pdf`;
  try {
    await uploadPrivate(BUCKETS.agreements, signaturePath, input.signaturePng, 'image/png');
    await uploadPrivate(BUCKETS.agreements, pdfPath, pdf, 'application/pdf');
  } catch {
    return { ok: false, code: 'errFailed' };
  }

  const { data: updated } = await db
    .from('agreements')
    .update({
      status: 'signed',
      signed_at: signedAt.toISOString(),
      signer_user_id: input.user.id,
      signer_name: input.signerName,
      signer_email: input.user.email,
      signer_ip: input.ip,
      signer_user_agent: input.userAgent?.slice(0, 300) ?? null,
      signature_path: signaturePath,
      pdf_path: pdfPath,
    })
    .eq('id', agreement.id)
    .eq('status', 'pending_signature')
    .select('id');
  if (!updated?.length) return { ok: false, code: 'errStale' };

  await audit({ actor: input.user, action: 'agreement.signed', bookingId: agreement.booking_id, entityType: 'agreement', entityId: agreement.id, metadata: { version: agreement.version } });
  const key = `${agreement.booking_id}:v${agreement.version}`;
  await enqueueEmail({ dedupeKey: `ready_for_pickup:${key}`, to: loaded.booking.customer_email, locale: loaded.booking.locale, template: 'ready_for_pickup', bookingId: agreement.booking_id });
  await enqueueEmail({ dedupeKey: `admin_agreement_signed:${key}`, to: 'admin', locale: 'ms', template: 'admin_agreement_signed', bookingId: agreement.booking_id });
  return { ok: true };
}
