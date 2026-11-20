import 'server-only';
import { computeBookingState, type BookingState } from '@/lib/booking-state';
import { createServiceClient } from '@/lib/supabase/server';
import { parseRange } from '@/lib/types';
import type {
  Agreement,
  AuditEntry,
  Booking,
  BookingRequest,
  DepositTransaction,
  DocumentRow,
  Driver,
  Handover,
  Payment,
  Refund,
  Vehicle,
  VehicleModel,
} from '@/lib/types';
import type { Msg } from './form';

export type Conflict = {
  id: string;
  kind: 'hold' | 'booking' | 'block';
  start: Date;
  end: Date;
  reason: string | null;
  note: string;
  booking_id: string | null;
  reference: string | null;
  customer_name: string | null;
};

type ConflictRow = {
  id: string;
  kind: 'hold' | 'booking' | 'block';
  period: string;
  reason: string | null;
  note: string;
  booking_id: string | null;
  bookings: { reference: string; customer_name: string } | { reference: string; customer_name: string }[] | null;
};

const first = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

/**
 * Everything already occupying a unit in [start, end). Used to show the
 * admin what a block, move or manual booking would collide with before it is
 * attempted. The database exclusion constraint remains the real guard.
 */
export async function findConflicts(vehicleId: string, start: Date, end: Date, excludeBookingId?: string): Promise<Conflict[]> {
  const { data } = await createServiceClient()
    .from('occupancy')
    .select('id, kind, period, reason, note, booking_id, bookings(reference, customer_name)')
    .eq('vehicle_id', vehicleId)
    .overlaps('period', `[${start.toISOString()},${end.toISOString()})`);
  return ((data ?? []) as ConflictRow[])
    .filter((row) => !excludeBookingId || row.booking_id !== excludeBookingId)
    .map((row) => {
      const range = parseRange(row.period);
      const booking = first(row.bookings);
      return {
        id: row.id,
        kind: row.kind,
        start: range.start,
        end: range.end,
        reason: row.reason,
        note: row.note,
        booking_id: row.booking_id,
        reference: booking?.reference ?? null,
        customer_name: booking?.customer_name ?? null,
      };
    });
}

export function describeConflicts(conflicts: Conflict[], format: (date: Date, locale: 'ms' | 'en') => string): Msg {
  const line = (c: Conflict, locale: 'ms' | 'en') => {
    const what =
      c.kind === 'block'
        ? locale === 'ms'
          ? `Sekatan (${c.reason ?? '-'})`
          : `Block (${c.reason ?? '-'})`
        : c.kind === 'hold'
          ? locale === 'ms'
            ? `Tahanan bayaran ${c.reference ?? ''}`
            : `Checkout hold ${c.reference ?? ''}`
          : locale === 'ms'
            ? `Tempahan ${c.reference ?? ''}`
            : `Booking ${c.reference ?? ''}`;
    return `• ${what}: ${format(c.start, locale)} – ${format(c.end, locale)}`;
  };
  return [
    `Bertindih dengan (termasuk masa persediaan):\n${conflicts.map((c) => line(c, 'ms')).join('\n')}`,
    `Conflicts with (including preparation time):\n${conflicts.map((c) => line(c, 'en')).join('\n')}`,
  ];
}

export type BookingBundle = {
  booking: Booking;
  model: VehicleModel | null;
  vehicle: Vehicle | null;
  drivers: Driver[];
  documents: DocumentRow[];
  agreements: Agreement[];
  currentAgreement: Agreement | null;
  payments: Payment[];
  refunds: Refund[];
  requests: BookingRequest[];
  handovers: Handover[];
  handoverPhotos: { id: string; handover_id: string; created_at: string }[];
  deposits: DepositTransaction[];
  audit: AuditEntry[];
  state: BookingState;
};

export async function loadBooking(id: string): Promise<BookingBundle | null> {
  const db = createServiceClient();
  const { data: booking } = await db.from('bookings').select('*').eq('id', id).maybeSingle();
  if (!booking) return null;
  const by = (table: string) => db.from(table).select('*').eq('booking_id', id);
  const [model, vehicle, drivers, documents, agreements, payments, refunds, requests, handovers, photos, deposits, auditRows] = await Promise.all([
    db.from('vehicle_models').select('*').eq('id', booking.model_id).maybeSingle(),
    db.from('vehicles').select('*').eq('id', booking.vehicle_id).maybeSingle(),
    by('drivers').order('is_primary', { ascending: false }).order('created_at'),
    by('documents').neq('status', 'deleted').order('created_at', { ascending: false }),
    by('agreements').order('version', { ascending: false }),
    by('payments').order('created_at', { ascending: false }),
    by('refunds').order('created_at', { ascending: false }),
    by('booking_requests').order('created_at', { ascending: false }),
    by('handovers').order('recorded_at'),
    db.from('handover_photos').select('id, handover_id, created_at').eq('booking_id', id).order('created_at'),
    by('deposit_transactions').order('created_at'),
    by('audit_log').order('created_at', { ascending: false }).limit(100),
  ]);
  const agreementRows = (agreements.data ?? []) as Agreement[];
  const currentAgreement = agreementRows.find((a) => a.status !== 'superseded') ?? null;
  const driverRows = (drivers.data ?? []) as Driver[];
  const documentRows = (documents.data ?? []) as DocumentRow[];
  return {
    booking: booking as Booking,
    model: (model.data as VehicleModel) ?? null,
    vehicle: (vehicle.data as Vehicle) ?? null,
    drivers: driverRows,
    documents: documentRows,
    agreements: agreementRows,
    currentAgreement,
    payments: (payments.data ?? []) as Payment[],
    refunds: (refunds.data ?? []) as Refund[],
    requests: (requests.data ?? []) as BookingRequest[],
    handovers: (handovers.data ?? []) as Handover[],
    handoverPhotos: photos.data ?? [],
    deposits: (deposits.data ?? []) as DepositTransaction[],
    audit: (auditRows.data ?? []) as AuditEntry[],
    state: computeBookingState({ booking: booking as Booking, drivers: driverRows, documents: documentRows, agreement: currentAgreement }),
  };
}

/** Email addresses for a set of user ids (who recorded an action). */
export async function actorEmails(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const map = new Map<string, string>();
  const db = createServiceClient();
  await Promise.all(
    unique.map(async (id) => {
      const { data } = await db.auth.admin.getUserById(id);
      if (data.user?.email) map.set(id, data.user.email);
    }),
  );
  return map;
}
