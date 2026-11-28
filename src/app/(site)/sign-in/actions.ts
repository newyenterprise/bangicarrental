'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { claimBookings, safeNext } from '@/lib/auth';
import { env } from '@/lib/env';
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
  const next = safeNext(String(form.get('next') ?? ''), '');
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      shouldCreateUser: true,
      // If the email shows a link rather than (or as well as) the code, the link lands here.
      emailRedirectTo: `${env.appUrl}/auth/confirm${next ? `?next=${encodeURIComponent(next)}` : ''}`,
    },
  });
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

export type PasswordSignInState = {
  /** Key in d.auth */
  error?: 'errInvalidEmail' | 'errPasswordWrong' | 'errRate';
  email?: string;
};

/**
 * Optional password sign-in. Only accounts whose password was set through the
 * site (after proving control of the email) may use it; see password_set_at.
 */
export async function signInWithPassword(_prev: PasswordSignInState, form: FormData): Promise<PasswordSignInState> {
  const email = Email.safeParse(form.get('email'));
  const password = String(form.get('password') ?? '');
  if (!email.success) return { error: 'errInvalidEmail' };
  if (!password) return { error: 'errPasswordWrong', email: email.data };

  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.data, password });
  if (error || !data.user?.email) {
    const rate = error?.status === 429 || /rate/i.test(error?.message ?? '');
    return { error: rate ? 'errRate' : 'errPasswordWrong', email: email.data };
  }

  const { data: profile } = await createServiceClient().from('profiles').select('role, password_set_at').eq('id', data.user.id).maybeSingle();
  if (!profile?.password_set_at) {
    // A password that was not set through the site: never trust it.
    await supabase.auth.signOut();
    return { error: 'errPasswordWrong', email: email.data };
  }
  const role = profile.role === 'admin' ? 'admin' : 'renter';
  const user = { id: data.user.id, email: data.user.email.toLowerCase(), role } as const;
  await claimBookings(user);
  if (role === 'admin') await audit({ actor: user, action: 'admin.signed_in', metadata: { via: 'password' } });

  redirect(safeNext(String(form.get('next') ?? ''), role === 'admin' ? '/admin' : '/bookings'));
}
