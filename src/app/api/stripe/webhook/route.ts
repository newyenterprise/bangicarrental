import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { getStripe, handleStripeEvent } from '@/lib/payments';

export const dynamic = 'force-dynamic';

/**
 * Stripe webhook. The signature is verified against the raw request body, so
 * the body must be read with request.text() and never parsed first.
 * A non-2xx response makes Stripe retry, and handling is idempotent.
 */
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  const secret = env.stripeWebhookSecret;
  if (!signature || !secret) return NextResponse.json({ error: 'not configured' }, { status: 400 });

  const rawBody = await request.text();
  let event;
  try {
    event = await getStripe().webhooks.constructEventAsync(rawBody, signature, secret);
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  try {
    const outcome = await handleStripeEvent(event);
    return NextResponse.json({ received: true, outcome });
  } catch (err) {
    console.error('[stripe webhook] handling failed', event.type, err instanceof Error ? err.message : 'error');
    return NextResponse.json({ error: 'handler failed' }, { status: 500 });
  }
}
