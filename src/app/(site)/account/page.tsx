import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteChrome';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/i18n/config';
import { getI18n } from '@/lib/i18n/server';
import { createServiceClient } from '@/lib/supabase/server';
import { PasswordForm } from './PasswordForm';

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: d.password.metaTitle, robots: { index: false } };
}

export default async function AccountPage() {
  const user = await requireUser('/account');
  const { d } = await getI18n();
  const { data: profile } = await createServiceClient().from('profiles').select('password_set_at').eq('id', user.id).maybeSingle();
  const hasPassword = !!profile?.password_set_at;

  return (
    <>
      <SiteHeader />
      <main className="container-narrow max-w-md py-4">
        <Link href={user.role === 'admin' ? '/admin' : '/bookings'} className="btn-plain -ml-2 text-sm underline">
          {d.common.back}
        </Link>
        <h1 className="h-display mt-2 text-4xl">{d.password.title}</h1>
        <p className="mt-2 mb-5 text-sm text-muted">{fmt(d.bookings.signedInAs, { email: user.email })}</p>
        <section className="card" aria-labelledby="password-title">
          <h2 id="password-title" className="text-xl font-bold tracking-tight">
            {d.password.section}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{d.password.intro}</p>
          <p className="mt-3 mb-4">
            <span className={hasPassword ? 'tag tag-live' : 'tag'} data-testid="password-status">
              {hasPassword ? d.password.hasPassword : d.password.noPassword}
            </span>
          </p>
          <PasswordForm email={user.email} hasPassword={hasPassword} />
        </section>
      </main>
    </>
  );
}
