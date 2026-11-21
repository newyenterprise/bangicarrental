import { NextResponse } from 'next/server';
import { verifySignature } from '@/lib/billplz';
import { applyBillplzBill } from '@/lib/payments';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Billplz server-to-server callback (X Signature). Billplz POSTs the bill as a
 * form; the signature is checked against every field it sent before anything
 * is believed. Billplz retries when the response is not HTTP 200, and handling
 * is idempotent, so duplicates and late deliveries are harmless.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === 'string') fields[key] = value;

  if (!verifySignature(fields, fields.x_signature)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }
  if (!fields.id) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  try {
    const outcome = await applyBillplzBill({
      id: fields.id,
      collection_id: fields.collection_id ?? '',
      paid: fields.paid === 'true',
      state: fields.state === 'paid' || fields.state === 'deleted' ? fields.state : 'due',
      amount: Number(fields.amount ?? 0),
      paid_amount: Number(fields.paid_amount ?? 0),
      url: fields.url ?? '',
      paid_at: fields.paid_at ?? null,
    });
    const { data: payment } = await createServiceClient().from('payments').select('booking_id').eq('provider', 'billplz').eq('checkout_session_id', fields.id).maybeSingle();
    await createServiceClient()
      .from('payment_events')
      .upsert(
        { provider_event_id: `billplz:${fields.id}:${fields.state}:${fields.paid_at ?? ''}`, type: 'billplz.callback', booking_id: payment?.booking_id ?? null, outcome },
        { onConflict: 'provider_event_id' },
      );
    return NextResponse.json({ received: true, outcome });
  } catch (err) {
    console.error('[billplz callback] handling failed', err instanceof Error ? err.message : 'error');
    return NextResponse.json({ error: 'handler failed' }, { status: 500 });
  }
}
