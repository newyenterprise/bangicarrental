/** Bilingual message: [Bahasa Melayu, English]. */
export type Msg = [string, string];

/** Result of an admin server action, rendered by components/admin/AdminForm. */
export type FormState = {
  ok?: Msg;
  error?: Msg;
  warn?: Msg;
  /** Echoed back so fields keep what was typed (React resets forms after an action). */
  values?: Record<string, string>;
};

export type FieldOption = { value: string; label: string };

export type Field = {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'checkbox' | 'datetime-local' | 'date';
  required?: boolean;
  hint?: string;
  defaultValue?: string;
  options?: FieldOption[];
  placeholder?: string;
  rows?: number;
  min?: number;
  max?: number;
  step?: number;
  inputMode?: 'numeric' | 'decimal' | 'tel' | 'email' | 'text';
  /** Use a monospace font (agreement body). */
  mono?: boolean;
};

/** Collects the submitted text values so they can be echoed back. */
export function echo(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string' && !key.startsWith('$') && key !== 'idempotency_key') values[key] = value.slice(0, 60000);
  }
  return values;
}

export const str = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

/** Maps database business errors (see supabase/migrations/*_functions.sql) to admin-readable text. */
const DB_ERRORS: Record<string, Msg> = {
  UNAVAILABLE: ['Bertindih dengan tempahan atau sekatan sedia ada untuk kereta ini.', 'Overlaps an existing booking or block for this car.'],
  INVALID_PERIOD: ['Waktu pulang mesti selepas waktu ambil.', 'The return time must be after the pickup time.'],
  INVALID_CONTACT: ['Nama dan emel pelanggan diperlukan.', 'Customer name and email are required.'],
  VEHICLE_NOT_FOUND: ['Kereta tidak dijumpai.', 'Vehicle not found.'],
  NOT_MOVABLE: ['Hanya tempahan yang disahkan dan belum diambil boleh dipindahkan.', 'Only confirmed bookings that have not been picked up can be moved.'],
  INVALID_AMOUNT: ['Masukkan jumlah yang sah, lebih daripada sifar.', 'Enter a valid amount above zero.'],
  REASON_REQUIRED: ['Sebab diperlukan.', 'A reason is required.'],
  NO_PAYMENT: ['Tiada bayaran berjaya untuk dipulangkan.', 'There is no successful payment to refund.'],
  EXCEEDS_PAID: ['Jumlah melebihi baki bayaran yang boleh dipulangkan.', 'The amount is more than what is left to refund.'],
  EXCEEDS_COLLECTED: ['Jumlah melebihi baki deposit yang dipegang.', 'The amount is more than the deposit still held.'],
  NOT_FOUND: ['Rekod tidak dijumpai.', 'Record not found.'],
  PROVIDER_FAILED: ['Stripe menolak bayaran balik ini. Semak di papan pemuka Stripe.', 'Stripe rejected this refund. Check the Stripe dashboard.'],
  '23P01': ['Bertindih dengan tempahan atau sekatan sedia ada.', 'Overlaps an existing booking or block.'],
};

export const GENERIC_ERROR: Msg = ['Tindakan gagal. Cuba lagi.', 'The action failed. Please try again.'];
export const INVALID_INPUT: Msg = ['Semak semula medan yang diisi.', 'Please check the fields you entered.'];

export function dbError(error: { message?: string; code?: string } | null | undefined): Msg {
  if (!error) return GENERIC_ERROR;
  if (error.code && DB_ERRORS[error.code]) return DB_ERRORS[error.code];
  const key = Object.keys(DB_ERRORS).find((code) => error.message?.includes(code));
  return key ? DB_ERRORS[key] : GENERIC_ERROR;
}
