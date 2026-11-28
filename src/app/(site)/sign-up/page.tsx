import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/SiteChrome';
import { getSessionUser, safeNext } from '@/lib/auth';
import { getI18n } from '@/lib/i18n/server';
import { SignUpForm } from './SignUpForm';

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: d.signup.metaTitle, robots: { index: false } };
}

export default async function SignUpPage({ searchParams }: PageProps<'/sign-up'>) {
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
          <h1 className="h-display text-3xl">{d.signup.title}</h1>
          <p className="mt-2 mb-5 leading-relaxed text-muted">{d.signup.intro}</p>
          <SignUpForm next={next} />
          <p className="mt-5 border-t border-line-soft pt-3 text-center text-sm">
            {d.signup.haveAccount}{' '}
            <Link href={`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-bold underline">
              {d.signup.signInLink}
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}
