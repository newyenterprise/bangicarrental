import 'server-only';
import Stripe from 'stripe';
import { audit } from './audit';
import type { SessionUser } from './auth';
import { enqueueEmail } from './email/outbox';
import { billplzBaseUrl, createBill, deleteBill, getBill, type BillplzBill } from './billplz';
import { env, type PaymentProvider } from './env';
import type { Locale } from './i18n/config';
import { createServiceClient } from './supabase/server';
import { formatDateTime } from './time';
import type { Booking } from './types';

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!env.stripeSecretKey) throw new Error('PAYMENT_UNAVAILABLE');
  stripeClient ??= new Stripe(env.stripeSecretKey, { maxNetworkRetries: 2, timeout: 20_000 });
  return stripeClient;
}

export type CheckoutOutcome = 'paid' | 'processing' | 'open' | 'expired' | 'needs_attention' | 'not_found';

/**
 * Creates the hosted Stripe Checkout session for a booking that already
 * holds a unit. The session expires before the hold does.
 */
export async function createCheckoutSession(input: {
  booking: Pick<Booking, 'id' | 'reference' | 'customer_email' | 'rental_total_sen' | 'days' | 'starts_at' | 'ends_at'>;
  modelName: string;
  locale: Locale;
  holdMinutes: number;
}): Promise<string> {
  const { booking, modelName, locale, holdMinutes } = input;
  const stripe = getStripe();
  const period = `${formatDateTime(booking.starts_at, locale)} – ${formatDateTime(booking.ends_at, locale)}`;
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      // Payment methods are chosen by Stripe from what the account has enabled (cards, FPX).
      currency: 'myr',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'myr',
            unit_amount: booking.rental_total_sen,
            product_data: {
              name: locale === 'en' ? `${modelName} rental · ${booking.days} day(s)` : `Sewa ${modelName} · ${booking.days} hari`,
              description: period,
            },
          },
        },
      ],
      customer_email: booking.customer_email,
      client_reference_id: booking.id,
      metadata: { booking_id: booking.id, reference: booking.reference },
      payment_intent_data: {
        description: `${booking.reference} · ${modelName}`,
        metadata: { booking_id: booking.id, reference: booking.reference },
      },
      locale: locale === 'en' ? 'en' : 'ms',
      // Stripe requires at least 30 minutes; a few seconds of slack keeps us above it.
      expires_at: Math.floor(Date.now() / 1000) + Math.max(30, holdMinutes) * 60 + 20,
      success_url: `${env.appUrl}/book/status?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.appUrl}/book/status?b=${booking.id}`,
    },
    { idempotencyKey: `checkout-${booking.id}` },
  );
  if (!session.url) throw new Error('PAYMENT_UNAVAILABLE');

  const { error } = await createServiceClient().from('payments').insert({
    booking_id: booking.id,
    provider: 'stripe',
    checkout_session_id: session.id,
    amount_sen: booking.rental_total_sen,
    status: 'open',
    livemode: session.livemode,
  });
  if (error) throw new Error('PAYMENT_UNAVAILABLE');
  return session.url;
}

type CheckoutInput = Parameters<typeof createCheckoutSession>[0] & { customerName: string };

/** Creates a Billplz bill for a booking that already holds a unit. */
async function createBillplzCheckout(input: CheckoutInput): Promise<string> {
  const { booking, modelName, locale } = input;
  const period = `${formatDateTime(booking.starts_at, locale)} - ${formatDateTime(booking.ends_at, locale)}`;
  const what = locale === 'en' ? `${modelName} rental, ${booking.days} day(s)` : `Sewa ${modelName}, ${booking.days} hari`;
  const bill = await createBill({
    email: booking.customer_email,
    name: input.customerName,
    amountSen: booking.rental_total_sen,
    description: `${booking.reference} · ${what} · ${period}`,
    reference: booking.reference,
    callbackUrl: `${env.appUrl}/api/billplz/callback`,
    // Billplz appends billplz[id], billplz[paid]... and a signature to this address.
    redirectUrl: `${env.appUrl}/book/status?b=${booking.id}`,
  });
  const { error } = await createServiceClient().from('payments').insert({
    booking_id: booking.id,
    provider: 'billplz',
    checkout_session_id: bill.id,
    amount_sen: booking.rental_total_sen,
    status: 'open',
    livemode: !env.billplzSandbox,
  });
  if (error) {
    await deleteBill(bill.id).catch(() => undefined);
    throw new Error('PAYMENT_UNAVAILABLE');
  }
  return bill.url;
}

/** Starts hosted checkout with the given provider and returns the address to send the customer to. */
export async function createCheckout(provider: PaymentProvider, input: CheckoutInput): Promise<string> {
  return provider === 'billplz' ? createBillplzCheckout(input) : createCheckoutSession(input);
}

export type PaymentRef = { provider: string; checkout_session_id: string };

/** Applies the state of a Billplz bill (from a verified callback or fetched with our API key). */
export async function applyBillplzBill(bill: BillplzBill): Promise<CheckoutOutcome> {
  const db = createServiceClient();
  const { data: payment } = await db.from('payments').select('booking_id').eq('provider', 'billplz').eq('checkout_session_id', bill.id).maybeSingle();
  if (!payment) return 'not_found';
  if (bill.paid && bill.state === 'paid') {
    const { data, error } = await db.rpc('record_payment_success', {
      p_booking_id: payment.booking_id,
      p_checkout_session_id: bill.id,
      p_payment_intent_id: bill.id,
      p_amount_sen: bill.paid_amount || bill.amount,
      p_method: 'billplz',
      p_receipt_url: bill.url || `${billplzBaseUrl()}/bills/${bill.id}`,
      p_livemode: !env.billplzSandbox,
    });
    if (error) throw new Error('record_payment_success failed');
    if (data === 'needs_attention') return 'needs_attention';
    return data === 'not_found' ? 'not_found' : 'paid';
  }
  if (bill.state === 'deleted') {
    await db.rpc('release_booking_hold', { p_booking_id: payment.booking_id, p_payment_status: 'expired' });
    return 'expired';
  }
  return 'open';
}

/** Authenticated reconciliation for either provider: reads the live state and applies it. */
export async function syncPayment(ref: PaymentRef): Promise<CheckoutOutcome> {
  if (ref.provider === 'billplz') {
    const bill = await getBill(ref.checkout_session_id);
    return bill ? applyBillplzBill(bill) : 'not_found';
  }
  return syncCheckoutSession(ref.checkout_session_id);
}

/** Closes an unpaid checkout so it can no longer be paid. Errors are left to the re-check that follows. */
async function closeCheckout(ref: PaymentRef): Promise<void> {
  try {
    if (ref.provider === 'billplz') await deleteBill(ref.checkout_session_id);
    else await getStripe().checkout.sessions.expire(ref.checkout_session_id);
  } catch {
    // It may have completed or expired in the meantime; the re-check decides.
  }
}

/** Address to resume an unfinished checkout, or null when it can no longer be paid. */
export async function resumeUrl(ref: PaymentRef): Promise<string | null> {
  try {
    if (ref.provider === 'billplz') {
      const bill = await getBill(ref.checkout_session_id);
      return bill && bill.state === 'due' ? bill.url : null;
    }
    const session = await getStripe().checkout.sessions.retrieve(ref.checkout_session_id);
    return session.status === 'open' ? session.url : null;
  } catch {
    return null;
  }
}

/**
 * Authenticated reconciliation: asks Stripe (with our secret key) for the
 * current state of a session and applies it. This, and verified webhook
 * events that call it, are the only ways a booking becomes paid. Reading the
 * live state each time also makes duplicate and out-of-order events harmless.
 */
export async function syncCheckoutSession(sessionId: string): Promise<CheckoutOutcome> {
  const db = createServiceClient();
  const session = await getStripe().checkout.sessions.retrieve(sessionId, { expand: ['payment_intent.latest_charge'] });
  const bookingId = session.client_reference_id ?? session.metadata?.booking_id;
  if (!bookingId) return 'not_found';

  if (session.status === 'complete' && session.payment_status === 'paid') {
    const intent = typeof session.payment_intent === 'object' ? session.payment_intent : null;
    const charge = intent && typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
    const { data, error } = await db.rpc('record_payment_success', {
      p_booking_id: bookingId,
      p_checkout_session_id: session.id,
      p_payment_intent_id: intent?.id ?? (typeof session.payment_intent === 'string' ? session.payment_intent : null),
      p_amount_sen: session.amount_total ?? 0,
      p_method: charge?.payment_method_details?.type ?? null,
      p_receipt_url: charge?.receipt_url ?? null,
      p_livemode: session.livemode,
    });
    if (error) throw new Error('record_payment_success failed');
    if (data === 'needs_attention') return 'needs_attention';
    return data === 'not_found' ? 'not_found' : 'paid';
  }

  if (session.status === 'complete') {
    // Paid with a delayed method: the bank has not confirmed yet. Keep the hold.
    await db.from('payments').update({ status: 'processing' }).eq('checkout_session_id', session.id).eq('status', 'open');
    await db.from('bookings').update({ payment_status: 'processing' }).eq('id', bookingId).eq('status', 'pending_payment').eq('payment_status', 'unpaid');
    return 'processing';
  }

  if (session.status === 'expired') {
    await db.rpc('release_booking_hold', { p_booking_id: bookingId, p_payment_status: 'expired' });
    return 'expired';
  }
  return 'open';
}

/**
 * Releases holds whose time is up, but only after the payment session has
 * been closed and checked. Runs from the scheduler and before each new hold,
 * so it keeps working across restarts and deployments.
 */
export async function reconcileExpiredHolds(): Promise<{ checked: number; released: number; paid: number; processing: number }> {
  const db = createServiceClient();
  const result = { checked: 0, released: 0, paid: 0, processing: 0 };
  const { data: holds } = await db
    .from('occupancy')
    .select('booking_id')
    .eq('kind', 'hold')
    .lt('expires_at', new Date().toISOString())
    .limit(50);

  for (const hold of holds ?? []) {
    if (!hold.booking_id) continue;
    result.checked += 1;
    try {
      const { data: payment } = await db
        .from('payments')
        .select('provider, checkout_session_id')
        .eq('booking_id', hold.booking_id)
        .not('checkout_session_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!payment?.checkout_session_id) {
        // Checkout was never created (for example the visitor left first).
        await db.rpc('release_booking_hold', { p_booking_id: hold.booking_id, p_payment_status: 'expired' });
        result.released += 1;
        continue;
      }

      const ref = { provider: payment.provider, checkout_session_id: payment.checkout_session_id };
      let outcome = await syncPayment(ref);
      if (outcome === 'open') {
        // Close the checkout first so it can no longer be paid, then check it once more.
        await closeCheckout(ref);
        outcome = await syncPayment(ref);
      }
      if (outcome === 'expired') result.released += 1;
      else if (outcome === 'paid') result.paid += 1;
      else if (outcome === 'processing') result.processing += 1;
    } catch (err) {
      console.error('[reconcile] hold check failed', hold.booking_id, err instanceof Error ? err.message : 'error');
    }
  }
  return result;
}

/** Applies one verified Stripe event. Replays are detected and skipped. */
export async function handleStripeEvent(event: Stripe.Event): Promise<string> {
  const db = createServiceClient();
  const { data: seen } = await db.from('payment_events').select('outcome').eq('provider_event_id', event.id).maybeSingle();
  if (seen?.outcome) return 'duplicate';

  let outcome = 'ignored';
  let bookingId: string | null = null;

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.expired': {
      const session = event.data.object;
      bookingId = session.client_reference_id ?? session.metadata?.booking_id ?? null;
      outcome = await syncCheckoutSession(session.id);
      break;
    }
    case 'checkout.session.async_payment_failed': {
      const session = event.data.object;
      bookingId = session.client_reference_id ?? session.metadata?.booking_id ?? null;
      if (bookingId) {
        await db.rpc('release_booking_hold', { p_booking_id: bookingId, p_payment_status: 'failed' });
        outcome = 'failed';
      }
      break;
    }
    case 'refund.created':
    case 'refund.updated':
    case 'refund.failed': {
      bookingId = await applyStripeRefund(event.data.object);
      outcome = 'refund_synced';
      break;
    }
    case 'charge.refunded': {
      const charge = event.data.object;
      const refunds = await getStripe().refunds.list({ charge: charge.id, limit: 20 });
      for (const refund of refunds.data) bookingId = (await applyStripeRefund(refund)) ?? bookingId;
      outcome = 'refund_synced';
      break;
    }
  }

  // Recorded only after the work succeeded, so a failed attempt is retried by Stripe.
  await db
    .from('payment_events')
    .upsert({ provider_event_id: event.id, type: event.type, booking_id: bookingId, outcome }, { onConflict: 'provider_event_id' });
  return outcome;
}

function mapRefundStatus(status: string | null): 'pending' | 'succeeded' | 'failed' {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed' || status === 'canceled') return 'failed';
  return 'pending';
}

/** Mirrors a Stripe refund into our ledger. Returns the booking id it belongs to. */
async function applyStripeRefund(refund: Stripe.Refund): Promise<string | null> {
  const db = createServiceClient();
  const status = mapRefundStatus(refund.status);
  const rowId = refund.metadata?.refund_row_id;

  let { data: row } = rowId
    ? await db.from('refunds').select('*').eq('id', rowId).maybeSingle()
    : await db.from('refunds').select('*').eq('provider_refund_id', refund.id).maybeSingle();

  if (!row) {
    // A refund made directly in the Stripe dashboard: record it so the ledger stays true.
    const intentId = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id;
    if (!intentId) return null;
    const { data: payment } = await db.from('payments').select('id, booking_id').eq('payment_intent_id', intentId).maybeSingle();
    if (!payment) return null;
    const inserted = await db
      .from('refunds')
      .upsert(
        {
          booking_id: payment.booking_id,
          payment_id: payment.id,
          amount_sen: refund.amount,
          reason: 'Refunded in the Stripe dashboard',
          status,
          idempotency_key: `stripe:${refund.id}`,
          provider_refund_id: refund.id,
        },
        { onConflict: 'idempotency_key' },
      )
      .select('*')
      .single();
    row = inserted.data;
    if (!row) return payment.booking_id;
    await audit({ action: 'refund.recorded_from_provider', bookingId: payment.booking_id, entityType: 'refund', entityId: row.id, metadata: { amount_sen: refund.amount } });
  } else if (row.status !== status || !row.provider_refund_id) {
    await db
      .from('refunds')
      .update({ status, provider_refund_id: refund.id, failure_reason: refund.failure_reason ?? null, updated_at: new Date().toISOString() })
      .eq('id', row.id);
  }

  await db.rpc('sync_refund_totals', { p_booking_id: row.booking_id });
  if (status === 'succeeded') await notifyRefund(row.booking_id, row.id, row.amount_sen, row.reason);
  return row.booking_id;
}

async function notifyRefund(bookingId: string, refundId: string, amountSen: number, reason: string): Promise<void> {
  const { data: booking } = await createServiceClient().from('bookings').select('customer_email, locale').eq('id', bookingId).maybeSingle();
  if (!booking) return;
  await enqueueEmail({
    dedupeKey: `refund_issued:${refundId}`,
    to: booking.customer_email,
    locale: booking.locale,
    template: 'refund_issued',
    bookingId,
    data: { amount_sen: amountSen, reason },
  });
}

export type RefundResult = { ok: true; duplicate: boolean; status: string } | { ok: false; code: string };

/**
 * Admin refund with an explicit amount and reason. The idempotency key comes
 * from the rendered form, so a double click or a retry returns the first
 * result, and the same key is passed to Stripe.
 */
export async function issueRefund(input: {
  bookingId: string;
  amountSen: number;
  reason: string;
  idempotencyKey: string;
  actor: SessionUser;
}): Promise<RefundResult> {
  const db = createServiceClient();
  const { data, error } = await db.rpc('request_refund', {
    p_booking_id: input.bookingId,
    p_amount_sen: input.amountSen,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
    p_actor: input.actor.id,
  });
  if (error) return { ok: false, code: error.message.match(/[A-Z_]{4,}/)?.[0] ?? 'FAILED' };
  const request = data as { refund_id: string; duplicate: boolean; status: string; provider?: string; payment_intent_id?: string | null };
  if (request.duplicate) return { ok: true, duplicate: true, status: request.status };

  if (request.provider !== 'stripe') {
    // Paid offline or through Billplz (which has no refund API): the money is
    // returned by the operator outside the app, and this records that it was.
    await db.from('refunds').update({ status: 'succeeded', updated_at: new Date().toISOString() }).eq('id', request.refund_id);
    await db.rpc('sync_refund_totals', { p_booking_id: input.bookingId });
    await notifyRefund(input.bookingId, request.refund_id, input.amountSen, input.reason);
    return { ok: true, duplicate: false, status: 'succeeded' };
  }

  try {
    if (!request.payment_intent_id) throw new Error('missing payment intent');
    const refund = await getStripe().refunds.create(
      {
        payment_intent: request.payment_intent_id,
        amount: input.amountSen,
        reason: 'requested_by_customer',
        metadata: { refund_row_id: request.refund_id, booking_id: input.bookingId },
      },
      { idempotencyKey: `refund-${input.idempotencyKey}` },
    );
    const status = mapRefundStatus(refund.status);
    await db
      .from('refunds')
      .update({ status, provider_refund_id: refund.id, failure_reason: refund.failure_reason ?? null, updated_at: new Date().toISOString() })
      .eq('id', request.refund_id);
    await db.rpc('sync_refund_totals', { p_booking_id: input.bookingId });
    if (status === 'succeeded') await notifyRefund(input.bookingId, request.refund_id, input.amountSen, input.reason);
    return { ok: true, duplicate: false, status };
  } catch (err) {
    const message = err instanceof Stripe.errors.StripeError ? (err.code ?? err.type) : 'refund_failed';
    await db.from('refunds').update({ status: 'failed', failure_reason: message, updated_at: new Date().toISOString() }).eq('id', request.refund_id);
    await audit({ actor: input.actor, action: 'refund.failed', bookingId: input.bookingId, entityType: 'refund', entityId: request.refund_id, metadata: { code: message } });
    return { ok: false, code: 'PROVIDER_FAILED' };
  }
}
