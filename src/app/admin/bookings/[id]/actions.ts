'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { describeConflicts, findConflicts, loadBooking } from '@/lib/admin/data';
import { GENERIC_ERROR, INVALID_INPUT, dbError, echo, str, type FormState, type Msg } from '@/lib/admin/form';
import { ensureAgreementCurrent } from '@/lib/agreements';
import { audit } from '@/lib/audit';
import { assertAdmin, type SessionUser } from '@/lib/auth';
import { missingDocuments } from '@/lib/booking-state';
import { enqueueEmail } from '@/lib/email/outbox';
import { formatRM, parseRM } from '@/lib/money';
import { issueRefund } from '@/lib/payments';
import { deleteBookingDocuments } from '@/lib/retention';
import { createServiceClient } from '@/lib/supabase/server';
import { formatDateTime, parseKlLocal } from '@/lib/time';
import type { DocumentRow } from '@/lib/types';

const FORBIDDEN: Msg = ['Anda tidak dibenarkan melakukan tindakan ini.', 'You are not allowed to do this.'];
const Uuid = z.string().uuid();

async function admin(): Promise<SessionUser | null> {
  try {
    return await assertAdmin();
  } catch {
    return null;
  }
}

function bookingId(form: FormData): string | null {
  const parsed = Uuid.safeParse(form.get('booking_id'));
  return parsed.success ? parsed.data : null;
}

const refresh = (id: string) => revalidatePath(`/admin/bookings/${id}`);
const NO_TEMPLATE: Msg = [
  'Pemandu diluluskan, tetapi tiada perjanjian diterbitkan. Terbitkan templat di Admin > Perjanjian supaya penyewa boleh menandatangani.',
  'Driver approved, but no agreement is published. Publish a template in Admin > Agreement so the renter can sign.',
];

/** Full or partial refund with an explicit amount and reason. Idempotent per rendered form. */
export async function refundAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const values = echo(form);
  const id = bookingId(form);
  const key = Uuid.safeParse(form.get('idempotency_key'));
  const amount = parseRM(str(form, 'amount'));
  const reason = str(form, 'reason');
  if (!id || !key.success) return { error: INVALID_INPUT, values };
  if (!amount || amount <= 0) return { error: ['Masukkan jumlah dalam RM, contohnya 350 atau 350.50.', 'Enter an amount in RM, for example 350 or 350.50.'], values };
  if (reason.length < 3) return { error: ['Nyatakan sebab bayaran balik.', 'Give a reason for the refund.'], values };

  const result = await issueRefund({ bookingId: id, amountSen: amount, reason, idempotencyKey: key.data, actor });
  refresh(id);
  if (!result.ok) return { error: dbError({ message: result.code }), values };
  if (result.duplicate) {
    return { warn: ['Bayaran balik ini sudah direkodkan. Tiada bayaran balik kedua dibuat.', 'This refund was already recorded. No second refund was made.'] };
  }
  return result.status === 'succeeded'
    ? { ok: [`Bayaran balik ${formatRM(amount)} berjaya.`, `Refund of ${formatRM(amount)} succeeded.`] }
    : { ok: [`Bayaran balik ${formatRM(amount)} dihantar dan sedang diproses.`, `Refund of ${formatRM(amount)} submitted and processing.`] };
}

/** Approve a driver, or ask for a correction with a reason the renter will see. */
export async function decideDriverAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const values = echo(form);
  const id = bookingId(form);
  const driverId = Uuid.safeParse(form.get('driver_id'));
  const decision = str(form, 'decision');
  const reason = str(form, 'reason');
  if (!id || !driverId.success || !['approved', 'correction_requested'].includes(decision)) return { error: INVALID_INPUT, values };
  if (decision === 'correction_requested' && reason.length < 5) {
    return { error: ['Tulis apa yang perlu dibetulkan. Penyewa akan nampak mesej ini.', 'Write what needs correcting. The renter will see this message.'], values };
  }

  const db = createServiceClient();
  const { data: driver } = await db.from('drivers').select('id, booking_id, full_name, status').eq('id', driverId.data).maybeSingle();
  if (!driver || driver.booking_id !== id) return { error: INVALID_INPUT, values };
  if (driver.status === 'draft') return { error: ['Pemandu ini belum menghantar butiran.', 'This driver has not submitted their details yet.'], values };
  if (driver.status === decision) return { warn: ['Keputusan ini sudah direkodkan.', 'This decision was already recorded.'] };
  if (decision === 'approved') {
    const { data: docs } = await db.from('documents').select('*').eq('driver_id', driver.id).eq('status', 'active');
    if (missingDocuments(driver.id, (docs ?? []) as DocumentRow[]).length > 0) {
      return { error: ['Pemandu ini belum memuat naik pengenalan dan lesen. Minta pembetulan.', 'This driver has not uploaded both ID and licence. Request a correction instead.'], values };
    }
  }

  const { data: row, error } = await db
    .from('verification_decisions')
    .insert({ booking_id: id, driver_id: driver.id, decision, reason: decision === 'correction_requested' ? reason : null, decided_by: actor.id })
    .select('id')
    .single();
  if (error || !row) return { error: GENERIC_ERROR, values };
  await db
    .from('drivers')
    .update({
      status: decision,
      correction_reason: decision === 'correction_requested' ? reason : null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: actor.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', driver.id);
  // The audit entry records who decided what, never the identity number or document contents.
  await audit({ actor, action: decision === 'approved' ? 'driver.approved' : 'driver.correction_requested', bookingId: id, entityType: 'driver', entityId: driver.id });

  const { data: booking } = await db.from('bookings').select('customer_email, locale').eq('id', id).single();
  refresh(id);
  revalidatePath('/admin');
  if (decision === 'correction_requested') {
    if (booking) {
      await enqueueEmail({
        dedupeKey: `correction:${row.id}`,
        to: booking.customer_email,
        locale: booking.locale,
        template: 'correction_requested',
        bookingId: id,
        data: { driver: driver.full_name, reason },
      });
    }
    return { ok: ['Pembetulan diminta. Penyewa telah dimaklumkan melalui emel.', 'Correction requested. The renter has been emailed.'] };
  }

  const ensured = await ensureAgreementCurrent(id, actor);
  if (ensured === 'no_template') return { warn: NO_TEMPLATE };
  return ensured === 'created'
    ? { ok: ['Diluluskan. Perjanjian dijana dan penyewa dimaklumkan untuk menandatangani.', 'Approved. The agreement was generated and the renter asked to sign.'] }
    : { ok: ['Pemandu diluluskan.', 'Driver approved.'] };
}

/** Security deposit ledger entry: collected, deduction (with reason) or returned. */
export async function depositAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const values = echo(form);
  const id = bookingId(form);
  const key = Uuid.safeParse(form.get('idempotency_key'));
  const kind = str(form, 'kind');
  const amount = parseRM(str(form, 'amount'));
  const reason = str(form, 'reason');
  if (!id || !key.success || !['collected', 'deduction', 'returned'].includes(kind)) return { error: INVALID_INPUT, values };
  if (!amount || amount <= 0) return { error: ['Masukkan jumlah dalam RM.', 'Enter an amount in RM.'], values };
  if (kind === 'deduction' && reason.length < 3) return { error: ['Potongan memerlukan sebab.', 'A deduction needs a reason.'], values };

  const { data, error } = await createServiceClient().rpc('record_deposit_transaction', {
    p_booking_id: id,
    p_kind: kind,
    p_amount_sen: amount,
    p_method: str(form, 'method') || null,
    p_reason: reason || null,
    p_idempotency_key: key.data,
    p_actor: actor.id,
  });
  refresh(id);
  if (error) return { error: dbError(error), values };
  if (data === 'duplicate') return { warn: ['Transaksi ini sudah direkodkan.', 'This entry was already recorded.'] };
  return { ok: [`Direkodkan: ${formatRM(amount)}.`, `Recorded: ${formatRM(amount)}.`] };
}

/** Pickup or return record: mileage, fuel, notes and who recorded it. */
export async function handoverAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const values = echo(form);
  const id = bookingId(form);
  const kind = str(form, 'kind');
  const parsed = z
    .object({ mileage: z.coerce.number().int().min(0).max(2_000_000), fuel: z.coerce.number().int().min(0).max(8) })
    .safeParse({ mileage: str(form, 'mileage_km'), fuel: str(form, 'fuel_eighths') });
  if (!id || !['pickup', 'return'].includes(kind) || !parsed.success || str(form, 'mileage_km') === '') {
    return { error: ['Masukkan bacaan odometer dan paras bahan api.', 'Enter the odometer reading and fuel level.'], values };
  }

  const bundle = await loadBooking(id);
  if (!bundle) return { error: INVALID_INPUT, values };
  const { booking, state, handovers } = bundle;
  const existing = handovers.find((h) => h.kind === kind);
  const db = createServiceClient();
  const record = { mileage_km: parsed.data.mileage, fuel_eighths: parsed.data.fuel, notes: str(form, 'notes').slice(0, 4000) };

  if (existing) {
    // Correcting an earlier record keeps the status as it is; the change is audited.
    await db.from('handovers').update(record).eq('id', existing.id);
    await audit({ actor, action: `handover.${kind}_updated`, bookingId: id, entityType: 'handover', entityId: existing.id, metadata: record });
    refresh(id);
    return { ok: ['Rekod dikemas kini.', 'Record updated.'], values };
  }

  if (kind === 'pickup') {
    if (booking.rental_status !== 'not_started') return { error: ['Kereta ini sudah direkodkan sebagai diambil.', 'This car is already recorded as picked up.'], values };
    if (!state.readyForPickup) {
      return {
        error: [
          'Belum sedia untuk diambil: bayaran mesti disahkan, semua pemandu diluluskan dan perjanjian semasa ditandatangani.',
          'Not ready for pickup: payment must be confirmed, every driver approved and the current agreement signed.',
        ],
        values,
      };
    }
  } else {
    if (booking.rental_status !== 'picked_up') return { error: ['Rekod ambil kereta dahulu sebelum pemulangan.', 'Record the pickup before the return.'], values };
    const pickup = handovers.find((h) => h.kind === 'pickup');
    if (pickup?.mileage_km != null && parsed.data.mileage < pickup.mileage_km) {
      return { error: ['Odometer pulang tidak boleh kurang daripada semasa ambil.', 'The return odometer cannot be lower than at pickup.'], values };
    }
  }

  const { data: created, error } = await db.from('handovers').insert({ booking_id: id, kind, ...record, recorded_by: actor.id }).select('id').single();
  if (error || !created) return { error: dbError(error), values };
  await db
    .from('bookings')
    .update({ rental_status: kind === 'pickup' ? 'picked_up' : 'returned', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('rental_status', kind === 'pickup' ? 'not_started' : 'picked_up');
  await audit({ actor, action: `handover.${kind}`, bookingId: id, entityType: 'handover', entityId: created.id, metadata: { mileage_km: record.mileage_km, fuel_eighths: record.fuel_eighths } });
  refresh(id);
  revalidatePath('/admin');
  return kind === 'pickup'
    ? { ok: ['Ambil kereta direkodkan. Tambah gambar keadaan di bawah.', 'Pickup recorded. Add condition photos below.'] }
    : { ok: ['Pemulangan direkodkan. Selesaikan deposit di bahagian Deposit.', 'Return recorded. Settle the deposit in the Deposit section.'] };
}

/** Admin decision on a renter's cancellation or date-change request. Never refunds by itself. */
export async function decideRequestAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const values = echo(form);
  const id = bookingId(form);
  const requestId = Uuid.safeParse(form.get('request_id'));
  const decision = str(form, 'decision');
  const response = str(form, 'response').slice(0, 2000);
  if (!id || !requestId.success || !['approved', 'declined'].includes(decision)) return { error: INVALID_INPUT, values };
  if (decision === 'declined' && response.length < 3) return { error: ['Beri penjelasan ringkas kepada penyewa.', 'Give the renter a short explanation.'], values };

  const db = createServiceClient();
  const { data: request } = await db.from('booking_requests').select('*').eq('id', requestId.data).maybeSingle();
  if (!request || request.booking_id !== id) return { error: INVALID_INPUT, values };
  if (request.status !== 'pending') return { warn: ['Permintaan ini sudah diputuskan.', 'This request was already decided.'] };
  const bundle = await loadBooking(id);
  if (!bundle) return { error: INVALID_INPUT, values };

  if (decision === 'approved' && request.kind === 'cancellation') {
    const { data: cancelled, error } = await db.rpc('cancel_booking', { p_booking_id: id, p_reason: response || 'Customer request', p_actor: actor.id });
    if (error) return { error: dbError(error), values };
    if (cancelled !== true) return { error: ['Tempahan ini tidak boleh dibatalkan (sudah diambil atau sudah dibatalkan).', 'This booking cannot be cancelled (already picked up or already cancelled).'], values };
  }

  if (decision === 'approved' && request.kind === 'date_change') {
    const start = request.requested_starts_at ? new Date(request.requested_starts_at) : null;
    const end = request.requested_ends_at ? new Date(request.requested_ends_at) : null;
    if (!start || !end) return { error: INVALID_INPUT, values };
    const buffer = (bundle.model?.prep_buffer_minutes ?? 0) * 60_000;
    const conflicts = await findConflicts(bundle.booking.vehicle_id, start, new Date(end.getTime() + buffer), id);
    if (conflicts.length) return { error: describeConflicts(conflicts, formatDateTime), values };
    const { error } = await db.rpc('move_booking', {
      p_booking_id: id,
      p_vehicle_id: bundle.booking.vehicle_id,
      p_starts_at: start.toISOString(),
      p_ends_at: end.toISOString(),
      p_actor: actor.id,
    });
    if (error) return { error: dbError(error), values };
    await ensureAgreementCurrent(id, actor);
  }

  await db
    .from('booking_requests')
    .update({ status: decision, admin_response: response || null, decided_by: actor.id, decided_at: new Date().toISOString() })
    .eq('id', request.id)
    .eq('status', 'pending');
  await audit({ actor, action: `request.${decision}`, bookingId: id, entityType: 'booking_request', entityId: request.id, metadata: { kind: request.kind } });
  await enqueueEmail({
    dedupeKey: `request_outcome:${request.id}`,
    to: bundle.booking.customer_email,
    locale: bundle.booking.locale,
    template: 'request_outcome',
    bookingId: id,
    data: { kind: request.kind, status: decision, response },
  });
  refresh(id);
  revalidatePath('/admin');
  if (decision === 'approved' && request.kind === 'cancellation') {
    return { ok: ['Tempahan dibatalkan dan penyewa dimaklumkan. Bayaran balik TIDAK dibuat secara automatik: guna borang Bayaran balik jika perlu.', 'Booking cancelled and the renter told. NO refund was made automatically: use the Refund form if one is due.'] };
  }
  if (decision === 'approved') {
    return { ok: ['Tarikh ditukar dan penyewa dimaklumkan. Harga asal dikekalkan; sebarang perbezaan diurus secara berasingan.', 'Dates changed and the renter told. The original price is kept; settle any difference separately.'] };
  }
  return { ok: ['Permintaan ditolak dan penyewa dimaklumkan.', 'Request declined and the renter told.'] };
}

/** Move a booking to other dates and/or another unit. Conflicts are shown before anything changes. */
export async function moveBookingAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const values = echo(form);
  const id = bookingId(form);
  const vehicleId = Uuid.safeParse(form.get('vehicle_id'));
  const start = parseKlLocal(str(form, 'from'));
  const end = parseKlLocal(str(form, 'to'));
  if (!id || !vehicleId.success || !start || !end) return { error: INVALID_INPUT, values };
  if (end <= start) return { error: dbError({ message: 'INVALID_PERIOD' }), values };

  const db = createServiceClient();
  const { data: vehicle } = await db.from('vehicles').select('id, vehicle_models(prep_buffer_minutes)').eq('id', vehicleId.data).maybeSingle();
  if (!vehicle) return { error: dbError({ message: 'VEHICLE_NOT_FOUND' }), values };
  const model = Array.isArray(vehicle.vehicle_models) ? vehicle.vehicle_models[0] : vehicle.vehicle_models;
  const buffer = ((model as { prep_buffer_minutes?: number } | null)?.prep_buffer_minutes ?? 0) * 60_000;
  const conflicts = await findConflicts(vehicle.id, start, new Date(end.getTime() + buffer), id);
  if (conflicts.length) return { error: describeConflicts(conflicts, formatDateTime), values };

  const { error } = await db.rpc('move_booking', {
    p_booking_id: id,
    p_vehicle_id: vehicle.id,
    p_starts_at: start.toISOString(),
    p_ends_at: end.toISOString(),
    p_actor: actor.id,
  });
  if (error) return { error: dbError(error), values };
  const ensured = await ensureAgreementCurrent(id, actor);
  refresh(id);
  revalidatePath('/admin/calendar');
  if (ensured === 'created') {
    return { ok: ['Tempahan dipindahkan. Perjanjian versi baharu dijana dan penyewa perlu menandatangani semula.', 'Booking moved. A new agreement version was generated and the renter must sign again.'] };
  }
  return { ok: ['Tempahan dipindahkan. Harga asal dikekalkan.', 'Booking moved. The original price is kept.'] };
}

/** Cancel a booking and free the unit. Any refund is a separate explicit action. */
export async function cancelBookingAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const values = echo(form);
  const id = bookingId(form);
  const reason = str(form, 'reason').slice(0, 2000);
  if (!id) return { error: INVALID_INPUT, values };
  if (reason.length < 3) return { error: ['Nyatakan sebab pembatalan. Penyewa akan nampak sebab ini.', 'Give a cancellation reason. The renter will see it.'], values };

  const db = createServiceClient();
  const { data: cancelled, error } = await db.rpc('cancel_booking', { p_booking_id: id, p_reason: reason, p_actor: actor.id });
  if (error) return { error: dbError(error), values };
  if (cancelled !== true) return { error: ['Tempahan ini tidak boleh dibatalkan (sudah diambil, dibatalkan atau tamat tempoh).', 'This booking cannot be cancelled (already picked up, cancelled or expired).'], values };
  const { data: booking } = await db.from('bookings').select('customer_email, locale').eq('id', id).single();
  if (booking) {
    await enqueueEmail({ dedupeKey: `booking_cancelled:${id}`, to: booking.customer_email, locale: booking.locale, template: 'booking_cancelled', bookingId: id, data: { reason } });
  }
  refresh(id);
  revalidatePath('/admin');
  revalidatePath('/admin/calendar');
  return { ok: ['Tempahan dibatalkan dan tarikh dilepaskan. Bayaran balik tidak dibuat secara automatik.', 'Booking cancelled and the dates released. No refund was made automatically.'] };
}

/** Authorised deletion of a booking's identity documents. */
export async function deleteDocumentsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const id = bookingId(form);
  if (!id) return { error: INVALID_INPUT };
  const count = await deleteBookingDocuments(id, actor, 'admin_request');
  refresh(id);
  return { ok: [`${count} dokumen dipadam secara kekal.`, `${count} document(s) permanently deleted.`] };
}

/** Records a rental payment received outside Stripe (cash or bank transfer). */
export async function offlinePaymentAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const values = echo(form);
  const id = bookingId(form);
  const amount = parseRM(str(form, 'amount'));
  const note = str(form, 'note').slice(0, 500);
  if (!id) return { error: INVALID_INPUT, values };
  if (!amount || amount <= 0) return { error: ['Masukkan jumlah dalam RM.', 'Enter an amount in RM.'], values };

  const db = createServiceClient();
  const now = new Date().toISOString();
  // The status guard makes a double submit a no-op.
  const { data: updated } = await db
    .from('bookings')
    .update({ payment_status: 'paid', paid_at: now, updated_at: now })
    .eq('id', id)
    .eq('status', 'confirmed')
    .eq('payment_status', 'unpaid')
    .select('id');
  if (!updated?.length) return { warn: ['Tempahan ini bukan tempahan disahkan yang belum dibayar.', 'This booking is not a confirmed, unpaid booking.'] };
  await db.from('payments').insert({ booking_id: id, provider: 'manual', amount_sen: amount, status: 'succeeded', method: 'offline', note: note || null, paid_at: now });
  await audit({ actor, action: 'payment.recorded_offline', bookingId: id, entityType: 'booking', entityId: id, metadata: { amount_sen: amount } });
  refresh(id);
  return { ok: [`Bayaran luar talian ${formatRM(amount)} direkodkan.`, `Offline payment of ${formatRM(amount)} recorded.`] };
}
