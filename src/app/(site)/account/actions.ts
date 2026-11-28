'use server';

import { revalidatePath } from 'next/cache';
import { audit } from '@/lib/audit';
import { getSessionUser } from '@/lib/auth';
import { passwordProblems, type PasswordRule } from '@/lib/password';
import { createServiceClient, createUserClient } from '@/lib/supabase/server';

export type PasswordState = {
  ok?: boolean;
  /** Key in d.password */
  error?: 'errMismatch' | 'errRecent' | 'errRules' | 'errFailed' | 'errSignedOut';
  problems?: PasswordRule[];
};

/** A password may only be set or changed within this long after signing in with the emailed code or link. */
const RECENT_SIGN_IN_MS = 24 * 3600_000;

export async function setPassword(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  const user = await getSessionUser();
  if (!user) return { error: 'errSignedOut' };
  const password = String(form.get('password') ?? '');
  const confirm = String(form.get('confirm') ?? '');

  const problems = passwordProblems(password);
  if (problems.length) return { error: 'errRules', problems };
  if (password !== confirm) return { error: 'errMismatch' };

  const supabase = await createUserClient();
  const { data: auth } = await supabase.auth.getUser();
  const lastSignIn = auth.user?.last_sign_in_at ? new Date(auth.user.last_sign_in_at).getTime() : 0;
  if (Date.now() - lastSignIn > RECENT_SIGN_IN_MS) return { error: 'errRecent' };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    // Supabase applies its own password rules too; report them the same way.
    return /weak|password/i.test(error.message) ? { error: 'errRules', problems: passwordProblems(password) } : { error: 'errFailed' };
  }

  const db = createServiceClient();
  const { data: before } = await db.from('profiles').select('password_set_at').eq('id', user.id).maybeSingle();
  await db.from('profiles').update({ password_set_at: new Date().toISOString() }).eq('id', user.id);
  await audit({ actor: user, action: before?.password_set_at ? 'password.changed' : 'password.set', entityType: 'profile', entityId: user.id });
  revalidatePath('/account');
  return { ok: true };
}
