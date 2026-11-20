'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { audit } from '@/lib/audit';
import { driverDetailsComplete, missingDocuments } from '@/lib/booking-state';
import { enqueueEmail } from '@/lib/email/outbox';
import { driverEditable, getOwnedDriver } from '@/lib/renter/data';
import { createServiceClient } from '@/lib/supabase/server';
import { klDateKey } from '@/lib/time';
import type { DocumentRow, Driver } from '@/lib/types';

export type DriverValues = {
  full_name: string;
  id_type: string;
  id_number: string;
  date_of_birth: string;
  phone: string;
  address: string;
  licence_number: string;
  licence_expiry: string;
};
type Field = keyof DriverValues;

export type DriverState = {
  saved?: boolean;
  /** Field -> key in d.driver */
  errors?: Partial<Record<Field, 'errRequired' | 'errLicenceExpired' | 'errDob'>>;
  generic?: boolean;
  values?: DriverValues;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function saveDriver(_prev: DriverState, form: FormData): Promise<DriverState> {
  const text = (name: string, max: number) => String(form.get(name) ?? '').trim().slice(0, max);
  const values: DriverValues = {
    full_name: text('full_name', 120),
    id_type: form.get('id_type') === 'passport' ? 'passport' : 'mykad',
    id_number: text('id_number', 30),
    date_of_birth: text('date_of_birth', 10),
    phone: text('phone', 20),
    address: text('address', 400),
    licence_number: text('licence_number', 30),
    licence_expiry: text('licence_expiry', 10),
  };
  const owned = await getOwnedDriver(String(form.get('driver_id') ?? ''));
  if (!owned || !driverEditable(owned.booking, owned.driver)) return { generic: true, values };
  const { user, booking, driver } = owned;

  const errors: DriverState['errors'] = {};
  const required: Field[] = ['full_name', 'id_number', 'date_of_birth', 'phone', 'licence_number', 'licence_expiry'];
  if (driver.is_primary) required.push('address');
  for (const field of required) if (!values[field]) errors[field] = 'errRequired';

  const today = klDateKey(new Date());
  if (values.date_of_birth && (!DATE.test(values.date_of_birth) || Number.isNaN(Date.parse(values.date_of_birth)) || values.date_of_birth >= today || values.date_of_birth < '1900-01-01')) {
    errors.date_of_birth = 'errDob';
  }
  if (values.licence_expiry && (!DATE.test(values.licence_expiry) || Number.isNaN(Date.parse(values.licence_expiry)) || values.licence_expiry < klDateKey(booking.ends_at))) {
    errors.licence_expiry = 'errLicenceExpired';
  }
  if (Object.keys(errors).length > 0) return { errors, values };

  const { error } = await createServiceClient()
    .from('drivers')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', driver.id)
    .in('status', ['draft', 'correction_requested']);
  if (error) return { generic: true, values };

  // Only which driver changed is recorded; never the identity or licence numbers.
  await audit({ actor: user, action: 'driver.details_saved', bookingId: booking.id, entityType: 'driver', entityId: driver.id });
  revalidatePath(`/bookings/${booking.id}`, 'layout');
  return { saved: true, values };
}

export type SubmitState = { error?: 'errIncomplete' | 'errLicenceExpired'; generic?: boolean };

/** Sends the driver for review. Checked again on the server against what is actually stored. */
export async function submitDriver(_prev: SubmitState, form: FormData): Promise<SubmitState> {
  const owned = await getOwnedDriver(String(form.get('driver_id') ?? ''));
  if (!owned || !driverEditable(owned.booking, owned.driver)) return { generic: true };
  const { user, booking, driver } = owned;
  const db = createServiceClient();
  const { data: docs } = await db.from('documents').select('*').eq('driver_id', driver.id).eq('status', 'active');
  if (!driverDetailsComplete(driver as Driver) || missingDocuments(driver.id, (docs ?? []) as DocumentRow[]).length > 0) {
    return { error: 'errIncomplete' };
  }
  if (!driver.licence_expiry || driver.licence_expiry < klDateKey(booking.ends_at)) return { error: 'errLicenceExpired' };

  const submittedAt = new Date().toISOString();
  const { data: updated } = await db
    .from('drivers')
    .update({ status: 'submitted', submitted_at: submittedAt, correction_reason: null, updated_at: submittedAt })
    .eq('id', driver.id)
    .in('status', ['draft', 'correction_requested'])
    .select('id');
  if (!updated?.length) return { generic: true };

  await enqueueEmail({
    dedupeKey: `docs_review:${driver.id}:${submittedAt}`,
    to: 'admin',
    locale: 'ms',
    template: 'admin_documents_review',
    bookingId: booking.id,
    data: { driver: driver.full_name },
  });
  await audit({ actor: user, action: 'driver.submitted', bookingId: booking.id, entityType: 'driver', entityId: driver.id });
  revalidatePath(`/bookings/${booking.id}`, 'layout');
  redirect(`/bookings/${booking.id}`);
}
