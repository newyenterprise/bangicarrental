import type { Msg } from './form';

/** Bilingual admin labels for each separate status dimension. */
export const BOOKING_STATUS: Record<string, Msg> = {
  pending_payment: ['Menunggu bayaran', 'Awaiting payment'],
  confirmed: ['Disahkan', 'Confirmed'],
  cancelled: ['Dibatalkan', 'Cancelled'],
  expired: ['Tamat tempoh', 'Expired'],
};

export const PAYMENT_STATUS: Record<string, Msg> = {
  unpaid: ['Belum dibayar', 'Unpaid'],
  processing: ['Sedang diproses', 'Processing'],
  paid: ['Dibayar', 'Paid'],
  partially_refunded: ['Sebahagian dipulangkan', 'Partially refunded'],
  refunded: ['Dipulangkan', 'Refunded'],
  needs_attention: ['Perlu perhatian', 'Needs attention'],
};

export const RENTAL_STATUS: Record<string, Msg> = {
  not_started: ['Belum diambil', 'Not picked up'],
  picked_up: ['Sedang disewa', 'On rental'],
  returned: ['Dipulangkan', 'Returned'],
};

export const DEPOSIT_STATUS: Record<string, Msg> = {
  due: ['Perlu dikutip semasa serahan', 'Due at handover'],
  collected: ['Dipegang', 'Held'],
  settled: ['Diselesaikan', 'Settled'],
  not_required: ['Tidak diperlukan', 'Not required'],
};

export const DRIVER_STATUS: Record<string, Msg> = {
  draft: ['Belum dihantar', 'Not submitted'],
  submitted: ['Menunggu semakan', 'Awaiting review'],
  approved: ['Diluluskan', 'Approved'],
  correction_requested: ['Pembetulan diminta', 'Correction requested'],
};

export const AGREEMENT_STATUS: Record<string, Msg> = {
  pending_signature: ['Menunggu tandatangan', 'Awaiting signature'],
  signed: ['Ditandatangani', 'Signed'],
  superseded: ['Digantikan', 'Superseded'],
};

export const REFUND_STATUS: Record<string, Msg> = {
  pending: ['Sedang diproses', 'Pending'],
  succeeded: ['Berjaya', 'Succeeded'],
  failed: ['Gagal', 'Failed'],
};

export const REQUEST_STATUS: Record<string, Msg> = {
  pending: ['Menunggu keputusan', 'Awaiting decision'],
  approved: ['Diluluskan', 'Approved'],
  declined: ['Ditolak', 'Declined'],
};

export const REQUEST_KIND: Record<string, Msg> = {
  cancellation: ['Pembatalan', 'Cancellation'],
  date_change: ['Tukar tarikh', 'Date change'],
};

export const DEPOSIT_KIND: Record<string, Msg> = {
  collected: ['Dikutip', 'Collected'],
  deduction: ['Potongan', 'Deduction'],
  returned: ['Dipulangkan', 'Returned'],
};

export const BLOCK_REASON: Record<string, Msg> = {
  personal: ['Kegunaan peribadi', 'Personal use'],
  maintenance: ['Penyelenggaraan', 'Maintenance'],
  other: ['Lain-lain', 'Other'],
};

export const DOCUMENT_KIND: Record<string, Msg> = {
  identity: ['MyKad / pasport', 'MyKad / passport'],
  licence: ['Lesen memandu', 'Driving licence'],
};

export const ATTENTION_REASON: Record<string, Msg> = {
  late_payment_unit_taken: ['Bayaran lewat: kereta sudah diambil tempahan lain. Perlu bayaran balik.', 'Late payment: the car was taken by another booking. A refund is needed.'],
  paid_after_cancellation: ['Bayaran diterima selepas tempahan dibatalkan. Perlu bayaran balik.', 'Payment arrived after the booking was cancelled. A refund is needed.'],
  amount_mismatch: ['Jumlah dibayar tidak sama dengan jumlah sewa. Semak di Stripe.', 'The amount paid differs from the rental total. Check in Stripe.'],
};

export function tagClass(status: string): string {
  if (['paid', 'confirmed', 'approved', 'signed', 'succeeded', 'settled', 'returned', 'collected'].includes(status)) return 'tag tag-live';
  if (['needs_attention', 'failed', 'correction_requested', 'cancelled', 'declined'].includes(status)) return 'tag tag-danger';
  if (['processing', 'pending', 'submitted', 'pending_signature', 'pending_payment', 'due', 'picked_up', 'partially_refunded'].includes(status)) return 'tag tag-warn';
  return 'tag';
}

export const FUEL_OPTIONS = Array.from({ length: 9 }, (_, i) => ({ value: String(i), label: i === 0 ? 'E (0/8)' : i === 8 ? 'F (8/8)' : `${i}/8` }));
