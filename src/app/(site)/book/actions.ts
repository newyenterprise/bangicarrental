'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { getSessionUser } from '@/lib/auth';
import { errorCode } from '@/lib/catalogue';
import { isLocale } from '@/lib/i18n/config';
import { createCheckout, reconcileExpiredHolds } from '@/lib/payments';
import { getLaunchStatus, getSettings, localized } from '@/lib/settings';
import { createServiceClient } from '@/lib/supabase/server';
import { parseKlLocal } from '@/lib/time';

export type CheckoutState = {
  /** Field name -> error key in the dictionary (d.errors[key]). */
  fieldErrors?: Partial<Record<'name' | 'email' | 'phone' | 'agree', string>>;
  /** Form-level error key in the dictionary. */
  error?: string;
  /** Echoed back so the fields keep what was typed after a failed submit. */
  values?: { name: string; email: string; phone: string };
};

const Contact = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^\+?\d[\d\s-]{7,17}$/),
});

/**
 * Starts checkout: validates on the server, secures a hold on a physical
 * unit, then sends the visitor to Stripe. Nothing from the browser is trusted
 * for price or availability; only the model, the dates and the contact details are read.
 */
export async function startCheckout(_prev: CheckoutState, form: FormData): Promise<CheckoutState> {
  const fieldErrors: CheckoutState['fieldErrors'] = {};
  const user = await getSessionUser();
  const values = {
    name: String(form.get('name') ?? '').slice(0, 120),
    email: user?.email ?? '',
    phone: String(form.get('phone') ?? '').slice(0, 20),
  };
  // Customers must have an account; the booking is created for it and its verified email.
  if (!user) return { error: 'SIGN_IN_REQUIRED', values };
  const parsed = Contact.safeParse({ name: form.get('name'), phone: form.get('phone') });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as 'name' | 'phone'] = String(issue.path[0]);
  }
  if (form.get('agree') !== 'on') fieldErrors.agree = 'agree';
  if (!parsed.success || Object.keys(fieldErrors).length > 0) return { fieldErrors, values };

  const start = parseKlLocal(String(form.get('from') ?? ''));
  const end = parseKlLocal(String(form.get('to') ?? ''));
  const modelId = String(form.get('model_id') ?? '');
  if (!start || !end || !/^[0-9a-f-]{36}$/i.test(modelId)) return { error: 'INVALID_PERIOD', values };
  const localeInput = form.get('locale');
  const locale = isLocale(localeInput) ? localeInput : 'ms';

  const launch = await getLaunchStatus();
  if (launch.paymentMode === 'unconfigured') return { error: 'PAYMENT_UNAVAILABLE', values };
  if (!launch.bookingsOpen) return { error: 'BOOKINGS_CLOSED', values };

  // Free any units whose unpaid hold has run out before trying to take one.
  try {
    await reconcileExpiredHolds();
  } catch {
    // Not fatal: a stale hold only makes the unit look busy for longer.
  }

  const db = createServiceClient();
  const settings = await getSettings();
  const { data: hold, error } = await db.rpc('create_booking_hold', {
    p_model_id: modelId,
    p_starts_at: start.toISOString(),
    p_ends_at: end.toISOString(),
    p_name: parsed.data.name,
    p_email: user.email,
    p_phone: parsed.data.phone,
    p_locale: locale,
    p_cancellation_terms: localized(settings, 'cancellation_terms', locale),
  });
  if (error || !hold) return { error: errorCode(error?.message), values };
  await db.from('bookings').update({ renter_id: user.id }).eq('id', (hold as { booking_id: string }).booking_id);
  // Remember the latest name and phone for next time.
  await db.from('profiles').update({ full_name: parsed.data.name, phone: parsed.data.phone }).eq('id', user.id);

  const result = hold as {
    booking_id: string;
    reference: string;
    hold_minutes: number;
    quote: { model_name: string; days: number; rental_total_sen: number };
  };

  const checkoutInput = {
    booking: {
      id: result.booking_id,
      reference: result.reference,
      customer_email: user.email,
      rental_total_sen: result.quote.rental_total_sen,
      days: result.quote.days,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
    },
    customerName: parsed.data.name,
    modelName: result.quote.model_name,
    locale,
    holdMinutes: result.hold_minutes,
  };
  // Try the primary provider, then the backup (only ever one in the same test/live mode).
  let checkoutUrl: string | null = null;
  let usedProvider = launch.provider;
  for (const provider of [launch.provider, launch.backup]) {
    if (!provider || checkoutUrl) continue;
    try {
      checkoutUrl = await createCheckout(provider, checkoutInput);
      usedProvider = provider;
    } catch (err) {
      console.error(`[checkout] ${provider} could not create the payment`, err instanceof Error ? err.message.slice(0, 80) : 'error');
    }
  }
  if (!checkoutUrl) {
    await db.rpc('release_booking_hold', { p_booking_id: result.booking_id, p_payment_status: 'failed' });
    return { error: 'PAYMENT_UNAVAILABLE', values };
  }

  await audit({ action: 'booking.hold_created', bookingId: result.booking_id, entityType: 'booking', entityId: result.booking_id, metadata: { provider: usedProvider } });
  redirect(checkoutUrl);
}
