import type { Locale } from './i18n/config';

export type ModelStatus = 'hidden' | 'preview' | 'bookable';
export type BookingStatus = 'pending_payment' | 'confirmed' | 'cancelled' | 'expired';
export type PaymentStatus = 'unpaid' | 'processing' | 'paid' | 'partially_refunded' | 'refunded' | 'needs_attention';
export type RentalStatus = 'not_started' | 'picked_up' | 'returned';
export type DepositStatus = 'due' | 'collected' | 'settled' | 'not_required';
export type DriverStatus = 'draft' | 'submitted' | 'approved' | 'correction_requested';
export type DocumentKind = 'identity' | 'licence';
export type AgreementStatus = 'pending_signature' | 'signed' | 'superseded';

export type Settings = {
  id: 1;
  company_name: string;
  display_name: string;
  contact_phone: string;
  contact_email: string;
  pickup_area: string;
  pickup_instructions_ms: string;
  pickup_instructions_en: string;
  operating_hours_ms: string;
  operating_hours_en: string;
  cancellation_terms_ms: string;
  cancellation_terms_en: string;
  lead_time_hours: number;
  verification_deadline_hours: number;
  hold_minutes: number;
  max_rental_days: number;
  document_retention_days: number;
  email_from: string;
  email_reply_to: string;
  admin_alert_email: string;
  rates_confirmed: boolean;
  deposit_confirmed: boolean;
  live_payments_enabled: boolean;
  updated_at: string;
};

export type VehicleModel = {
  id: string;
  slug: string;
  name: string;
  seats: number;
  transmission: 'automatic' | 'manual';
  tagline_ms: string;
  tagline_en: string;
  image_url: string;
  daily_rate_sen: number;
  deposit_sen: number;
  prep_buffer_minutes: number;
  status: ModelStatus;
  sort_order: number;
};

export type Vehicle = {
  id: string;
  model_id: string;
  label: string;
  registration_no: string;
  model_year: number | null;
  colour: string;
  notes: string;
  active: boolean;
  created_at: string;
};

export type Quote = {
  model_id: string;
  model_name: string;
  starts_at: string;
  ends_at: string;
  days: number;
  daily_rate_sen: number;
  rental_total_sen: number;
  deposit_sen: number;
  prep_buffer_minutes: number;
};

export type Booking = {
  id: string;
  reference: string;
  renter_id: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  locale: Locale;
  source: 'online' | 'manual';
  model_id: string;
  vehicle_id: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  payment_status: PaymentStatus;
  rental_status: RentalStatus;
  deposit_status: DepositStatus;
  attention_reason: string | null;
  days: number;
  daily_rate_sen: number;
  rental_total_sen: number;
  deposit_sen: number;
  quote: Record<string, unknown>;
  refunded_sen: number;
  details_version: number;
  hold_expires_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type Driver = {
  id: string;
  booking_id: string;
  is_primary: boolean;
  full_name: string;
  id_type: 'mykad' | 'passport';
  id_number: string;
  date_of_birth: string | null;
  phone: string;
  address: string;
  licence_number: string;
  licence_expiry: string | null;
  status: DriverStatus;
  correction_reason: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type DocumentRow = {
  id: string;
  booking_id: string;
  driver_id: string;
  kind: DocumentKind;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  status: 'active' | 'superseded' | 'deleted';
  created_at: string;
};

export type Agreement = {
  id: string;
  booking_id: string;
  version: number;
  template_id: string;
  locale: Locale;
  title: string;
  rendered_body: string;
  details_hash: string;
  status: AgreementStatus;
  signed_at: string | null;
  signer_name: string | null;
  signer_email: string | null;
  signature_path: string | null;
  pdf_path: string | null;
  created_at: string;
};

export type AgreementTemplate = {
  id: string;
  locale: Locale;
  version: number;
  title: string;
  body: string;
  status: 'draft' | 'published' | 'archived';
  published_at: string | null;
  updated_at: string;
};

export type Payment = {
  id: string;
  booking_id: string;
  provider: 'stripe' | 'manual';
  checkout_session_id: string | null;
  payment_intent_id: string | null;
  amount_sen: number;
  status: 'open' | 'processing' | 'succeeded' | 'failed' | 'expired';
  method: string | null;
  receipt_url: string | null;
  note: string | null;
  livemode: boolean;
  created_at: string;
  paid_at: string | null;
};

export type Refund = {
  id: string;
  booking_id: string;
  payment_id: string;
  amount_sen: number;
  reason: string;
  status: 'pending' | 'succeeded' | 'failed';
  provider_refund_id: string | null;
  failure_reason: string | null;
  created_at: string;
};

export type BookingRequest = {
  id: string;
  booking_id: string;
  kind: 'cancellation' | 'date_change';
  requested_starts_at: string | null;
  requested_ends_at: string | null;
  message: string;
  status: 'pending' | 'approved' | 'declined';
  admin_response: string | null;
  decided_at: string | null;
  created_at: string;
};

export type Handover = {
  id: string;
  booking_id: string;
  kind: 'pickup' | 'return';
  mileage_km: number | null;
  fuel_eighths: number | null;
  notes: string;
  recorded_by: string | null;
  recorded_at: string;
};

export type DepositTransaction = {
  id: string;
  booking_id: string;
  kind: 'collected' | 'deduction' | 'returned';
  amount_sen: number;
  method: string | null;
  reason: string | null;
  recorded_by: string | null;
  created_at: string;
};

export type OccupancyRow = {
  id: string;
  vehicle_id: string;
  period: string;
  kind: 'hold' | 'booking' | 'block';
  booking_id: string | null;
  reason: 'personal' | 'maintenance' | 'other' | null;
  note: string;
  expires_at: string | null;
};

export type AuditEntry = {
  id: string;
  actor_id: string | null;
  actor_role: string;
  action: string;
  booking_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

/** Parses a Postgres tstzrange literal such as ["2031-01-01 02:00:00+00","2031-01-02 04:00:00+00"). */
export function parseRange(range: string): { start: Date; end: Date } {
  const toDate = (raw: string) => {
    let value = raw.trim().replace(' ', 'T');
    if (/[+-]\d{2}$/.test(value)) value += ':00';
    return new Date(value);
  };
  const [a, b] = range.replace(/[[\]()"]/g, '').split(',');
  return { start: toDate(a), end: toDate(b) };
}
