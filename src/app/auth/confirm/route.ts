import { redirect } from 'next/navigation';
import type { EmailOtpType } from '@supabase/supabase-js';
import { audit } from '@/lib/audit';
import { claimBookings, safeNext } from '@/lib/auth';
import { createServiceClient, createUserClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const OTP_TYPES: EmailOtpType[] = ['email', 'magiclink', 'signup', 'invite', 'recovery', 'email_change'];

/**
 * Landing point for a sign-in link in the email. Two forms are accepted:
 *  - ?token_hash=...&type=email  (our template's link; works on any device)
 *  - ?code=...                   (Supabase's default link; works in the browser
 *                                 that asked for the code)
 * Either way the link proves control of the email, exactly like the 6-digit code.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'), '');

  const supabase = await createUserClient();
  let userId: string | null = null;
  let email: string | null = null;

  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error && data.user?.email) ({ id: userId, email } = { id: data.user.id, email: data.user.email });
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user?.email) ({ id: userId, email } = { id: data.user.id, email: data.user.email });
  }

  if (!userId || !email) redirect(`/sign-in?error=link${next ? `&next=${encodeURIComponent(next)}` : ''}`);

  const { data: profile } = await createServiceClient().from('profiles').select('role').eq('id', userId).maybeSingle();
  const role = profile?.role === 'admin' ? 'admin' : 'renter';
  const user = { id: userId, email: email.toLowerCase(), role } as const;
  await claimBookings(user);
  if (role === 'admin') await audit({ actor: user, action: 'admin.signed_in', metadata: { via: 'email_link' } });

  // A password-reset link lands on Account, where the new password is set.
  redirect(next || (type === 'recovery' ? '/account' : role === 'admin' ? '/admin' : '/bookings'));
}
