import type { Dict } from '@/lib/i18n/ms';
import type { Booking, DriverStatus } from '@/lib/types';

/** Booking / payment / rental status chips. Each dimension is shown separately. */
export function StatusTags({ booking, d, ready = false }: { booking: Booking; d: Dict; ready?: boolean }) {
  const paymentClass =
    booking.payment_status === 'paid' ? 'tag-live' : booking.payment_status === 'needs_attention' ? 'tag-danger' : booking.payment_status === 'unpaid' ? '' : 'tag-warn';
  return (
    <span className="flex flex-wrap gap-1.5">
      {booking.status !== 'confirmed' && <span className="tag">{d.statuses.booking[booking.status]}</span>}
      <span className={`tag ${paymentClass}`}>{d.statuses.payment[booking.payment_status]}</span>
      {booking.rental_status !== 'not_started' && <span className="tag">{d.statuses.rental[booking.rental_status]}</span>}
      {ready && booking.rental_status === 'not_started' && <span className="tag tag-live">{d.statuses.readyForPickup}</span>}
    </span>
  );
}

export function DriverStatusTag({ status, d }: { status: DriverStatus; d: Dict }) {
  const map = {
    draft: ['', d.driver.statusDraft],
    submitted: ['tag-warn', d.driver.statusSubmitted],
    approved: ['tag-live', d.driver.statusApproved],
    correction_requested: ['tag-danger', d.driver.statusCorrection],
  } as const;
  const [cls, label] = map[status];
  return <span className={`tag ${cls}`}>{label}</span>;
}
