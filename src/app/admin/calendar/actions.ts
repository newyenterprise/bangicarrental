'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { describeConflicts, findConflicts } from '@/lib/admin/data';
import { INVALID_INPUT, dbError, echo, str, type FormState, type Msg } from '@/lib/admin/form';
import { audit } from '@/lib/audit';
import { assertAdmin, type SessionUser } from '@/lib/auth';
import { parseRM } from '@/lib/money';
import { createServiceClient } from '@/lib/supabase/server';
import { formatDateTime, parseKlLocal } from '@/lib/time';

const FORBIDDEN: Msg = ['Anda tidak dibenarkan melakukan tindakan ini.', 'You are not allowed to do this.'];
const Uuid = z.string().uuid();

async function admin(): Promise<SessionUser | null> {
  try {
    return await assertAdmin();
  } catch {
    return null;
  }
}

async function bufferMs(vehicleId: string): Promise<number | null> {
  const { data } = await createServiceClient().from('vehicles').select('id, vehicle_models(prep_buffer_minutes)').eq('id', vehicleId).maybeSingle();
  if (!data) return null;
  const model = Array.isArray(data.vehicle_models) ? data.vehicle_models[0] : data.vehicle_models;
  return ((model as { prep_buffer_minutes?: number } | null)?.prep_buffer_minutes ?? 0) * 60_000;
}

/** Blocks a unit for personal use or maintenance. Conflicts are shown first; the database constraint is the final guard. */
export async function createBlockAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const values = echo(form);
  const vehicleId = Uuid.safeParse(form.get('vehicle_id'));
  const start = parseKlLocal(str(form, 'from'));
  const end = parseKlLocal(str(form, 'to'));
  const reason = str(form, 'reason');
  if (!vehicleId.success || !start || !end || !['personal', 'maintenance', 'other'].includes(reason)) return { error: INVALID_INPUT, values };
  if (end <= start) return { error: dbError({ message: 'INVALID_PERIOD' }), values };

  const conflicts = await findConflicts(vehicleId.data, start, end);
  if (conflicts.length) return { error: describeConflicts(conflicts, formatDateTime), values };

  const db = createServiceClient();
  const { data, error } = await db
    .from('occupancy')
    .insert({
      vehicle_id: vehicleId.data,
      period: `[${start.toISOString()},${end.toISOString()})`,
      kind: 'block',
      reason,
      note: str(form, 'note').slice(0, 500),
      created_by: actor.id,
    })
    .select('id')
    .single();
  // 23P01 = exclusion violation: someone booked or blocked these dates a moment ago.
  if (error || !data) return { error: dbError(error), values };
  await audit({ actor, action: 'block.created', entityType: 'occupancy', entityId: data.id, metadata: { vehicle_id: vehicleId.data, starts_at: start.toISOString(), ends_at: end.toISOString(), reason } });
  revalidatePath('/admin/calendar');
  return { ok: ['Masa disekat.', 'Time blocked.'] };
}

export async function removeBlockAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const id = Uuid.safeParse(form.get('occupancy_id'));
  if (!id.success) return { error: INVALID_INPUT };
  const db = createServiceClient();
  // Only blocks can be removed here; bookings and holds go through their own flows.
  const { data } = await db.from('occupancy').delete().eq('id', id.data).eq('kind', 'block').select('id, vehicle_id, period');
  if (!data?.length) return { warn: ['Sekatan ini sudah tiada.', 'This block no longer exists.'] };
  await audit({ actor, action: 'block.removed', entityType: 'occupancy', entityId: id.data, metadata: { vehicle_id: data[0].vehicle_id, period: data[0].period } });
  revalidatePath('/admin/calendar');
  return { ok: ['Sekatan dibuang.', 'Block removed.'] };
}

const Manual = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().max(20),
  locale: z.enum(['ms', 'en']),
});

/** Phone / walk-in booking. The unit is secured in the same database transaction. */
export async function createManualBookingAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const values = echo(form);
  const vehicleId = Uuid.safeParse(form.get('vehicle_id'));
  const start = parseKlLocal(str(form, 'from'));
  const end = parseKlLocal(str(form, 'to'));
  const contact = Manual.safeParse({ name: str(form, 'name'), email: str(form, 'email'), phone: str(form, 'phone'), locale: str(form, 'locale') || 'ms' });
  const total = parseRM(str(form, 'rental_total'));
  const deposit = parseRM(str(form, 'deposit') || '0');
  if (!vehicleId.success || !start || !end) return { error: INVALID_INPUT, values };
  if (end <= start) return { error: dbError({ message: 'INVALID_PERIOD' }), values };
  if (!contact.success) return { error: ['Masukkan nama dan emel pelanggan yang sah.', 'Enter a valid customer name and email.'], values };
  if (total == null || deposit == null) return { error: ['Masukkan jumlah sewa dan deposit dalam RM.', 'Enter the rental total and deposit in RM.'], values };

  const buffer = await bufferMs(vehicleId.data);
  if (buffer == null) return { error: dbError({ message: 'VEHICLE_NOT_FOUND' }), values };
  const conflicts = await findConflicts(vehicleId.data, start, new Date(end.getTime() + buffer));
  if (conflicts.length) return { error: describeConflicts(conflicts, formatDateTime), values };

  const db = createServiceClient();
  const { data, error } = await db.rpc('create_manual_booking', {
    p_vehicle_id: vehicleId.data,
    p_starts_at: start.toISOString(),
    p_ends_at: end.toISOString(),
    p_name: contact.data.name,
    p_email: contact.data.email,
    p_phone: contact.data.phone,
    p_locale: contact.data.locale,
    p_rental_total_sen: total,
    p_deposit_sen: deposit,
    p_actor: actor.id,
  });
  if (error || !data) return { error: dbError(error), values };
  const created = data as { booking_id: string; reference: string };

  if (form.get('paid_offline') === 'on' && total > 0) {
    const now = new Date().toISOString();
    await db.from('payments').insert({ booking_id: created.booking_id, provider: 'manual', amount_sen: total, status: 'succeeded', method: 'offline', note: str(form, 'payment_note').slice(0, 500) || null, paid_at: now });
    await db.from('bookings').update({ payment_status: 'paid', paid_at: now, updated_at: now }).eq('id', created.booking_id);
    await audit({ actor, action: 'payment.recorded_offline', bookingId: created.booking_id, entityType: 'booking', entityId: created.booking_id, metadata: { amount_sen: total } });
  }
  revalidatePath('/admin/calendar');
  revalidatePath('/admin/bookings');
  return {
    ok: [
      `Tempahan ${created.reference} dibuat. Pelanggan log masuk dengan emel mereka untuk hantar dokumen dan tandatangan.`,
      `Booking ${created.reference} created. The customer signs in with their email to submit documents and sign.`,
    ],
  };
}
