import Link from 'next/link';
import { Brand } from '@/components/SiteChrome';
import { getI18n } from '@/lib/i18n/server';

export default async function NotFound() {
  const { d } = await getI18n();
  return (
    <main className="container-narrow py-10">
      <Brand />
      <div className="card mt-8">
        <h1 className="h-display text-3xl">{d.common.notFoundTitle}</h1>
        <p className="mt-3 leading-relaxed">{d.common.notFoundBody}</p>
        <Link href="/" className="btn mt-5">{d.common.goHome}</Link>
      </div>
    </main>
  );
}
