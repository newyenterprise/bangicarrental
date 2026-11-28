import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteChrome';
import { safeNext } from '@/lib/auth';
import { getI18n } from '@/lib/i18n/server';
import { ForgotForm } from './ForgotForm';

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: d.forgot.metaTitle, robots: { index: false } };
}

export default async function ForgotPasswordPage({ searchParams }: PageProps<'/forgot-password'>) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === 'string' ? params.next : null, '');
  const { d } = await getI18n();

  return (
    <>
      <SiteHeader />
      <main className="container-narrow max-w-md py-6">
        <div className="card">
          <h1 className="h-display text-3xl">{d.forgot.title}</h1>
          <p className="mt-2 mb-5 leading-relaxed text-muted">{d.forgot.intro}</p>
          <ForgotForm next={next} />
          <p className="mt-5 border-t border-line-soft pt-3 text-center text-sm">
            <Link href={`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-bold underline">
              {d.forgot.backToSignIn}
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}
