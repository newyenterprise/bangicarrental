'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { claimBookings, safeNext } from '@/lib/auth';
import { createServiceClient, createUserClient } from '@/lib/supabase/server';

export type SignInState = {
  step: 'email' | 'code';
  email?: string;
  /** Key in d.auth */
  error?: 'errInvalidEmail' | 'errSend' | 'errRate' | 'errCode' | 'errCodeFormat';
};

const Email = z.string().trim().toLowerCase().email().max(200);

/** Step 1: email a one-time 6-digit code. No password is ever set or asked for. */
export async function requestCode(_prev: SignInState, form: FormData): Promise<SignInState> {
  const parsed = Email.safeParse(form.get('email'));
  if (!parsed.success) return { step: 'email', error: 'errInvalidEmail' };
  const supabase = await createUserClient();
  const { error } = await supabase.auth.signInWithOtp({ email: parsed.data, options: { shouldCreateUser: true } });
  if (error) {
    const rate = error.status === 429 || /rate|seconds/i.test(error.message);
    return { step: 'email', email: parsed.data, error: rate ? 'errRate' : 'errSend' };
  }
  return { step: 'code', email: parsed.data };
}

/** Step 2: the code proves control of the email; only then are bookings attached. */
export async function verifyCode(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = Email.safeParse(form.get('email'));
  const token = String(form.get('code') ?? '').replace(/\s/g, '');
  if (!email.success) return { step: 'email', error: 'errInvalidEmail' };
  if (!/^\d{6}$/.test(token)) return { step: 'code', email: email.data, error: 'errCodeFormat' };

  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: email.data, token, type: 'email' });
  if (error || !data.user?.email) return { step: 'code', email: email.data, error: 'errCode' };

  const { data: profile } = await createServiceClient().from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  const role = profile?.role === 'admin' ? 'admin' : 'renter';
  const user = { id: data.user.id, email: data.user.email.toLowerCase(), role } as const;
  await claimBookings(user);
  if (role === 'admin') await audit({ actor: user, action: 'admin.signed_in' });

  redirect(safeNext(String(form.get('next') ?? ''), role === 'admin' ? '/admin' : '/bookings'));
}
