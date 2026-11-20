'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { signAgreement } from '@/lib/agreements';
import { UUID, getOwnedBooking } from '@/lib/renter/data';
import { createServiceClient } from '@/lib/supabase/server';

export type SignState = {
  signed?: boolean;
  /** Key in d.agreement */
  error?: 'errAccept' | 'errName' | 'errSignature' | 'errStale' | 'errFailed';
  values?: { name: string };
};

const MAX_SIGNATURE_BYTES = 500 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Explicit acceptance + drawn signature. Signer identity and time are taken on the server. */
export async function sign(_prev: SignState, form: FormData): Promise<SignState> {
  const name = String(form.get('signer_name') ?? '').trim().slice(0, 120);
  const values = { name };
  const agreementId = String(form.get('agreement_id') ?? '');
  if (!UUID.test(agreementId)) return { error: 'errFailed', values };

  const { data: row } = await createServiceClient().from('agreements').select('booking_id').eq('id', agreementId).maybeSingle();
  const owned = row ? await getOwnedBooking(row.booking_id) : null;
  if (!owned) return { error: 'errFailed', values };

  if (form.get('accept') !== 'on') return { error: 'errAccept', values };
  if (name.length < 2) return { error: 'errName', values };

  const dataUrl = String(form.get('signature') ?? '');
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) return { error: 'errSignature', values };
  const png = new Uint8Array(Buffer.from(dataUrl.slice(prefix.length), 'base64'));
  if (png.length < 200 || png.length > MAX_SIGNATURE_BYTES || !PNG_MAGIC.every((b, i) => png[i] === b)) {
    return { error: 'errSignature', values };
  }

  const h = await headers();
  const ip = (h.get('cf-connecting-ip') ?? h.get('x-forwarded-for')?.split(',')[0] ?? '').trim().slice(0, 64) || null;
  const result = await signAgreement({
    agreementId,
    user: owned.user,
    signerName: name,
    signaturePng: png,
    ip,
    userAgent: h.get('user-agent'),
  });
  if (!result.ok) return { error: result.code, values };

  revalidatePath(`/bookings/${owned.booking.id}`, 'layout');
  return { signed: true };
}
