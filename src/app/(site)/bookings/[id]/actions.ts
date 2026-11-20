'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { audit } from '@/lib/audit';
import { enqueueEmail } from '@/lib/email/outbox';
import { getOwnedBooking, getOwnedDriver } from '@/lib/renter/data';
import { BUCKETS, removeObjects } from '@/lib/storage';
import { createServiceClient } from '@/lib/supabase/server';
import { parseKlLocal } from '@/lib/time';

const MAX_DRIVERS = 4;

/** Adds an empty additional driver, then opens its form. */
export async function addDriver(bookingId: string): Promise<void> {
  const owned = await getOwnedBooking(bookingId);
  if (!owned) redirect('/bookings');
  const { user, booking } = owned;
  if (booking.status !== 'confirmed' || booking.rental_status !== 'not_started') redirect(`/bookings/${booking.id}`);
  const db = createServiceClient();
  const { count } = await db.from('drivers').select('id', { count: 'exact', head: true }).eq('booking_id', booking.id);
  if ((count ?? 0) >= MAX_DRIVERS) redirect(`/bookings/${booking.id}`);
  const { data } = await db.from('drivers').insert({ booking_id: booking.id, is_primary: false }).select('id').single();
  if (!data) redirect(`/bookings/${booking.id}`);
  await audit({ actor: user, action: 'driver.added', bookingId: booking.id, entityType: 'driver', entityId: data.id });
  redirect(`/bookings/${booking.id}/drivers/${data.id}`);
}

/** Removes an additional driver that has not been submitted or approved. */
export async function removeDriver(driverId: string): Promise<void> {
  const owned = await getOwnedDriver(driverId);
  if (!owned) redirect('/bookings');
  const { user, booking, driver } = owned;
  const removable =
    !driver.is_primary &&
    booking.status === 'confirmed' &&
    booking.rental_status === 'not_started' &&
    (driver.status === 'draft' || driver.status === 'correction_requested');
  if (removable) {
    const db = createServiceClient();
    const { data: docs } = await db.from('documents').select('storage_path').eq('driver_id', driver.id);
    if (docs?.length) await removeObjects(BUCKETS.documents, docs.map((x) => x.storage_path));
    await db.from('drivers').delete().eq('id', driver.id);
    await audit({ actor: user, action: 'driver.removed', bookingId: booking.id, entityType: 'driver', entityId: driver.id });
  }
  revalidatePath(`/bookings/${booking.id}`);
  redirect(`/bookings/${booking.id}`);
}

export type RequestState = {
  ok?: boolean;
  /** Key in d.request */
  error?: 'errDates' | 'errPending' | 'errMessage';
  generic?: boolean;
  values?: { message: string; from: string; to: string };
};

/**
 * A renter request is only a message to the owner. It never changes the
 * booking dates, the unit's occupancy or any money; an admin decision does.
 */
export async function submitRequest(_prev: RequestState, form: FormData): Promise<RequestState> {
  const kind = form.get('kind') === 'date_change' ? 'date_change' : 'cancellation';
  const values = {
    message: String(form.get('message') ?? '').trim().slice(0, 1000),
    from: String(form.get('from') ?? ''),
    to: String(form.get('to') ?? ''),
  };
  const owned = await getOwnedBooking(String(form.get('booking_id') ?? ''));
  if (!owned) return { generic: true, values };
  const { user, booking } = owned;
  if (booking.status !== 'confirmed' || booking.rental_status !== 'not_started') return { generic: true, values };

  let start: Date | null = null;
  let end: Date | null = null;
  if (kind === 'date_change') {
    start = parseKlLocal(values.from);
    end = parseKlLocal(values.to);
    if (!start || !end || start.getTime() <= Date.now() || end <= start) return { error: 'errDates', values };
  } else if (values.message.length < 3) {
    return { error: 'errMessage', values };
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from('booking_requests')
    .insert({
      booking_id: booking.id,
      kind,
      requested_starts_at: start?.toISOString() ?? null,
      requested_ends_at: end?.toISOString() ?? null,
      message: values.message,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error || !data) return error?.code === '23505' ? { error: 'errPending', values } : { generic: true, values };

  await enqueueEmail({ dedupeKey: `request_received:${data.id}`, to: 'admin', locale: 'ms', template: 'admin_request_received', bookingId: booking.id, data: { kind } });
  await audit({ actor: user, action: 'request.created', bookingId: booking.id, entityType: 'booking_request', entityId: data.id, metadata: { kind } });
  revalidatePath(`/bookings/${booking.id}`);
  return { ok: true };
}
