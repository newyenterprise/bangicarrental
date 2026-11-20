import 'server-only';
import { getSessionUser, type SessionUser } from '../auth';
import { createServiceClient } from '../supabase/server';
import type { Booking, Driver } from '../types';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * For server actions and route handlers: the signed-in user plus a booking
 * that is theirs. The ownership check is explicit here because writes use the
 * service role afterwards. Returns null when not signed in or not the owner.
 */
export async function getOwnedBooking(bookingId: string): Promise<{ user: SessionUser; booking: Booking } | null> {
  if (!UUID.test(bookingId)) return null;
  const user = await getSessionUser();
  if (!user) return null;
  const { data } = await createServiceClient().from('bookings').select('*').eq('id', bookingId).eq('renter_id', user.id).maybeSingle();
  if (!data) return null;
  return { user, booking: data as Booking };
}

/** A driver on a booking owned by the signed-in user. */
export async function getOwnedDriver(driverId: string): Promise<{ user: SessionUser; booking: Booking; driver: Driver } | null> {
  if (!UUID.test(driverId)) return null;
  const { data: driver } = await createServiceClient().from('drivers').select('*').eq('id', driverId).maybeSingle();
  if (!driver) return null;
  const owned = await getOwnedBooking(driver.booking_id);
  if (!owned) return null;
  return { ...owned, driver: driver as Driver };
}

export function driverEditable(booking: Booking, driver: Driver): boolean {
  return (
    booking.status === 'confirmed' &&
    booking.rental_status === 'not_started' &&
    (driver.status === 'draft' || driver.status === 'correction_requested')
  );
}

/** Upcoming first (soonest on top); cancelled, returned and missed bookings count as past (latest on top). */
export function splitBookings<T extends Booking>(bookings: T[]): { upcoming: T[]; past: T[] } {
  const now = Date.now();
  const isPast = (b: Booking) =>
    b.status === 'cancelled' || b.rental_status === 'returned' || (b.rental_status === 'not_started' && new Date(b.ends_at).getTime() < now);
  return { upcoming: bookings.filter((b) => !isPast(b)), past: bookings.filter(isPast).reverse() };
}
