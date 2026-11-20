import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createServiceClient, createUserClient } from './supabase/server';

export type SessionUser = { id: string; email: string; role: 'renter' | 'admin' };

/**
 * The signed-in user, verified with the Supabase auth server (not just read
 * from the cookie). The role comes from the database, never from the client.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) return null;
  const { data: profile } = await createServiceClient()
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();
  return { id: data.user.id, email: data.user.email.toLowerCase(), role: profile?.role === 'admin' ? 'admin' : 'renter' };
});

export async function requireUser(next = '/bookings'): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  return user;
}

export async function requireAdmin(next = '/admin'): Promise<SessionUser> {
  const user = await requireUser(next);
  if (user.role !== 'admin') redirect('/bookings');
  return user;
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function assertAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || user.role !== 'admin') throw new Error('FORBIDDEN');
  return user;
}

/**
 * Attaches paid bookings made with this (now verified) email address to the
 * account. Control of the email was proven by the one-time code, which is the
 * only way a private booking becomes visible.
 */
export async function claimBookings(user: SessionUser): Promise<void> {
  await createServiceClient()
    .from('bookings')
    .update({ renter_id: user.id })
    .is('renter_id', null)
    .eq('customer_email', user.email);
}

/** Only allow same-site relative redirects. */
export function safeNext(next: string | null | undefined, fallback = '/bookings'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  return next;
}
