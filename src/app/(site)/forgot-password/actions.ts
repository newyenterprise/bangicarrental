'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { claimBookings, safeNext } from '@/lib/auth';
import { env } from '@/lib/env';
import { passwordProblems, type PasswordRule } from '@/lib/password';
import { createServiceClient, createUserClient } from '@/lib/supabase/server';

export type ResetState = {
  step: 'email' | 'code';
  email?: string;
  /** Key in d.forgot, or 'errRules' / 'errMismatch' in d.password */
  error?: 'errEmail' | 'errSend' | 'errRate' | 'errCode' | 'errCodeFormat' | 'errFailed' | 'errRules' | 'errMismatch';
  problems?: PasswordRule[];
  resent?: boolean;
};

const Email = z.string().trim().toLowerCase().email().max(200);

/**
 * Sends a password-reset code. The answer is the same whether or not the
 * address has an account, so this page cannot be used to find out who is a customer.
 */
export async function requestReset(_prev: ResetState, form: FormData): Promise<ResetState> {
  const email = Email.safeParse(form.get('email'));
  if (!email.success) return { step: 'email', error: 'errEmail' };
  const supabase = await createUserClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${env.appUrl}/auth/confirm?next=/account`,
  });
  if (error) {
    if (error.status === 429 || /rate|seconds/i.test(error.message)) return { step: 'email', email: email.data, error: 'errRate' };
    console.error('[forgot-password] send failed', error.status, error.code);
    return { step: 'email', email: email.data, error: 'errSend' };
  }
  return { step: 'code', email: email.data };
}

export async function resendReset(prev: ResetState): Promise<ResetState> {
  if (!prev.email) return { step: 'email', error: 'errEmail' };
  const supabase = await createUserClient();
  const { error } = await supabase.auth.resetPasswordForEmail(prev.email, { redirectTo: `${env.appUrl}/auth/confirm?next=/account` });
  if (error) return { ...prev, error: error.status === 429 || /rate/i.test(error.message) ? 'errRate' : 'errSend', resent: false };
  return { ...prev, error: undefined, resent: true };
}

/** The code proves the email; the new password is then set and the person is signed in. */
export async function completeReset(prev: ResetState, form: FormData): Promise<ResetState> {
  const email = Email.safeParse(prev.email ?? form.get('email'));
  if (!email.success) return { step: 'email', error: 'errEmail' };
  const token = String(form.get('code') ?? '').replace(/\s/g, '');
  const password = String(form.get('password') ?? '');
  const state = { step: 'code' as const, email: email.data };
  if (!/^\d{6}$/.test(token)) return { ...state, error: 'errCodeFormat' };
  const problems = passwordProblems(password);
  if (problems.length) return { ...state, error: 'errRules', problems };
  if (password !== String(form.get('confirm') ?? '')) return { ...state, error: 'errMismatch' };

  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: email.data, token, type: 'recovery' });
  if (error || !data.user?.email) return { ...state, error: 'errCode' };

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    return /weak|password/i.test(updateError.message) ? { ...state, error: 'errRules', problems: passwordProblems(password) } : { ...state, error: 'errFailed' };
  }

  const db = createServiceClient();
  await db.from('profiles').update({ password_set_at: new Date().toISOString() }).eq('id', data.user.id);
  const { data: profile } = await db.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  const user = { id: data.user.id, email: data.user.email.toLowerCase(), role: profile?.role === 'admin' ? 'admin' : 'renter' } as const;
  await claimBookings(user);
  await audit({ actor: user, action: 'password.reset', entityType: 'profile', entityId: user.id });

  redirect(safeNext(String(form.get('next') ?? ''), user.role === 'admin' ? '/admin' : '/bookings'));
}
