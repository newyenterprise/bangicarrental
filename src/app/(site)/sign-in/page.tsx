import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/SiteChrome';
import { getSessionUser, safeNext } from '@/lib/auth';
import { getI18n } from '@/lib/i18n/server';
import { SignInForm } from './SignInForm';

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: d.auth.metaTitle, robots: { index: false } };
}

export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === 'string' ? params.next : null, '');
  const user = await getSessionUser();
  if (user) redirect(next || (user.role === 'admin' ? '/admin' : '/bookings'));
  const { d } = await getI18n();

  return (
    <>
      <SiteHeader />
      <main className="container-narrow max-w-md py-6">
        <div className="card">
          <h1 className="h-display text-3xl">{d.auth.title}</h1>
          <p className="mt-2 mb-5 leading-relaxed text-muted">{d.auth.intro}</p>
          {params.error === 'link' && (
            <p role="alert" className="notice notice-warn mb-4 font-semibold">{d.auth.errLink}</p>
          )}
          <SignInForm next={next} />
        </div>
      </main>
    </>
  );
}
