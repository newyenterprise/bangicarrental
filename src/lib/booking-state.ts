import type { Agreement, Booking, DocumentKind, DocumentRow, Driver } from './types';

export const REQUIRED_DOCUMENTS: DocumentKind[] = ['identity', 'licence'];

export type NextAction =
  | 'payment_attention'
  | 'unpaid'
  | 'cancelled'
  | 'details'
  | 'upload'
  | 'correct'
  | 'review'
  | 'agreement_pending'
  | 'sign'
  | 'ready'
  | 'active'
  | 'completed';

export type BookingState = {
  next: NextAction;
  /** The driver the next action is about, when there is one. */
  driverId: string | null;
  driversComplete: boolean;
  allApproved: boolean;
  agreementSigned: boolean;
  /** Payment confirmed + every driver approved + current agreement signed. */
  readyForPickup: boolean;
};

export function driverDetailsComplete(driver: Driver): boolean {
  const base =
    driver.full_name.trim() !== '' &&
    driver.id_number.trim() !== '' &&
    driver.licence_number.trim() !== '' &&
    !!driver.licence_expiry &&
    !!driver.date_of_birth &&
    driver.phone.trim() !== '';
  return driver.is_primary ? base && driver.address.trim() !== '' : base;
}

export function missingDocuments(driverId: string, documents: DocumentRow[]): DocumentKind[] {
  const present = new Set(documents.filter((d) => d.driver_id === driverId && d.status === 'active').map((d) => d.kind));
  return REQUIRED_DOCUMENTS.filter((kind) => !present.has(kind));
}

export function isPaid(booking: Pick<Booking, 'payment_status'>): boolean {
  return booking.payment_status === 'paid' || booking.payment_status === 'partially_refunded';
}

/**
 * Works out the single next thing a renter should do. Payment, verification,
 * signature, rental and deposit are separate statuses; this only reads them.
 */
export function computeBookingState(input: {
  booking: Booking;
  drivers: Driver[];
  documents: DocumentRow[];
  /** The current (pending or signed) agreement, if any. */
  agreement: Pick<Agreement, 'status'> | null;
}): BookingState {
  const { booking, drivers, documents, agreement } = input;
  const allApproved = drivers.length > 0 && drivers.every((d) => d.status === 'approved');
  const driversComplete =
    drivers.length > 0 && drivers.every((d) => driverDetailsComplete(d) && missingDocuments(d.id, documents).length === 0);
  const agreementSigned = agreement?.status === 'signed';
  const readyForPickup = booking.status === 'confirmed' && isPaid(booking) && allApproved && agreementSigned;
  const base = { driversComplete, allApproved, agreementSigned, readyForPickup, driverId: null as string | null };

  if (booking.payment_status === 'needs_attention') return { ...base, next: 'payment_attention' };
  if (booking.status === 'cancelled') return { ...base, next: 'cancelled' };
  if (booking.status !== 'confirmed') return { ...base, next: 'unpaid' };
  if (booking.rental_status === 'returned') return { ...base, next: 'completed' };
  if (booking.rental_status === 'picked_up') return { ...base, next: 'active' };

  const correction = drivers.find((d) => d.status === 'correction_requested');
  if (correction) return { ...base, next: 'correct', driverId: correction.id };

  const drafts = drivers.filter((d) => d.status === 'draft');
  const needsDetails = drafts.find((d) => !driverDetailsComplete(d));
  if (needsDetails) return { ...base, next: 'details', driverId: needsDetails.id };
  // details are complete but documents are missing or the driver was never submitted
  if (drafts[0]) return { ...base, next: 'upload', driverId: drafts[0].id };

  if (!allApproved) return { ...base, next: 'review' };
  if (!agreement) return { ...base, next: 'agreement_pending' };
  if (!agreementSigned) return { ...base, next: 'sign' };
  return { ...base, next: 'ready' };
}
