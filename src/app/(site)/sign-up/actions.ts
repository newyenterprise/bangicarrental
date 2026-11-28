'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { claimBookings, safeNext } from '@/lib/auth';
import { env } from '@/lib/env';
import { passwordProblems, type PasswordRule } from '@/lib/password';
import { createServiceClient, createUserClient } from '@/lib/supabase/server';

type Values = { name: string; phone: string; email: string };

export type SignUpState = {
  step: 'details' | 'code';
  values?: Values;
  /** Key in d.signup, or 'errRules' / 'errMismatch' in d.password */
  error?:
    | 'errName'
    | 'errPhone'
    | 'errEmail'
    | 'errExists'
    | 'errSend'
    | 'errRate'
    | 'errCode'
    | 'errCodeFormat'
    | 'errUnavailable'
    | 'errRules'
    | 'errMismatch';
  problems?: PasswordRule[];
  resent?: boolean;
};

const Name = z.string().trim().min(2).max(120);
const Phone = z.string().trim().regex(/^\+?\d[\d\s-]{7,17}$/);
const Email = z.string().trim().toLowerCase().email().max(200);

function readValues(form: FormData): Values {
  return {
    name: String(form.get('name') ?? '').trim().slice(0, 120),
    phone: String(form.get('phone') ?? '').trim().slice(0, 20),
    email: String(form.get('email') ?? '').trim().toLowerCase().slice(0, 200),
  };
}

/**
 * Step 1: create the account with a password. Supabase emails a 6-digit code
 * ("Confirm email" must be on); nothing is trusted until that code is entered.
 */
export async function startSignUp(_prev: SignUpState, form: FormData): Promise<SignUpState> {
  const values = readValues(form);
  const password = String(form.get('password') ?? '');
  if (!Name.safeParse(values.name).success) return { step: 'details', values, error: 'errName' };
  if (!Phone.safeParse(values.phone).success) return { step: 'details', values, error: 'errPhone' };
  if (!Email.safeParse(values.email).success) return { step: 'details', values, error: 'errEmail' };
  const problems = passwordProblems(password);
  if (problems.length) return { step: 'details', values, error: 'errRules', problems };
  if (password !== String(form.get('confirm') ?? '')) return { step: 'details', values, error: 'errMismatch' };

  const next = safeNext(String(form.get('next') ?? ''), '');
  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.signUp({
    email: values.email,
    password,
    options: {
      data: { full_name: values.name, phone: values.phone },
      emailRedirectTo: `${env.appUrl}/auth/confirm${next ? `?next=${encodeURIComponent(next)}` : ''}`,
    },
  });
  if (error) {
    if (error.status === 429 || /rate/i.test(error.message)) return { step: 'details', values, error: 'errRate' };
    if (/already|registered|exists/i.test(error.message)) return { step: 'details', values, error: 'errExists' };
    if (/password/i.test(error.message)) return { step: 'details', values, error: 'errRules', problems: passwordProblems(password) };
    console.error('[sign-up] failed', error.status, error.code);
    return { step: 'details', values, error: 'errSend' };
  }
  if (data.session) {
    // "Confirm email" is switched off in Supabase, so the email was never proven. Refuse.
    await supabase.auth.signOut();
    console.error('[sign-up] Supabase returned a session without email confirmation; turn "Confirm email" on');
    return { step: 'details', values, error: 'errUnavailable' };
  }
  // Supabase hides whether an address is taken by returning a user with no identities.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { step: 'details', values, error: 'errExists' };
  }
  return { step: 'code', values };
}

/** Sends a fresh sign-up code. */
export async function resendSignUpCode(prev: SignUpState): Promise<SignUpState> {
  if (!prev.values?.email) return { step: 'details', error: 'errEmail' };
  const supabase = await createUserClient();
  const { error } = await supabase.auth.resend({ type: 'signup', email: prev.values.email });
  if (error) return { ...prev, error: error.status === 429 || /rate/i.test(error.message) ? 'errRate' : 'errSend', resent: false };
  return { ...prev, error: undefined, resent: true };
}

/**
 * Step 2: the code proves the email. The password is set again here, so the
 * account ends up with exactly the password this person chose, even if someone
 * had tried to pre-register the address. Only then is password sign-in allowed.
 */
export async function verifySignUp(prev: SignUpState, form: FormData): Promise<SignUpState> {
  const values = prev.values ?? readValues(form);
  const token = String(form.get('code') ?? '').replace(/\s/g, '');
  const password = String(form.get('password') ?? '');
  if (!Email.safeParse(values.email).success) return { step: 'details', values, error: 'errEmail' };
  if (!/^\d{6}$/.test(token)) return { step: 'code', values, error: 'errCodeFormat' };

  const supabase = await createUserClient();
  let result = await supabase.auth.verifyOtp({ email: values.email, token, type: 'email' });
  if (result.error) result = await supabase.auth.verifyOtp({ email: values.email, token, type: 'signup' });
  const authUser = result.data.user;
  if (result.error || !authUser?.email) return { step: 'code', values, error: 'errCode' };

  const db = createServiceClient();
  const update: Record<string, string> = { full_name: values.name, phone: values.phone };
  if (password && passwordProblems(password).length === 0) {
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) update.password_set_at = new Date().toISOString();
  }
  await db.from('profiles').update(update).eq('id', authUser.id);

  const { data: profile } = await db.from('profiles').select('role').eq('id', authUser.id).maybeSingle();
  const user = { id: authUser.id, email: authUser.email.toLowerCase(), role: profile?.role === 'admin' ? 'admin' : 'renter' } as const;
  await claimBookings(user);
  await audit({ actor: user, action: 'account.signed_up', entityType: 'profile', entityId: user.id });

  redirect(safeNext(String(form.get('next') ?? ''), user.role === 'admin' ? '/admin' : '/bookings'));
}
