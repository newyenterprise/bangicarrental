'use client';

import { useI18n } from '@/lib/i18n/client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { d } = useI18n();
  return (
    <main className="container-narrow py-10">
      <div className="card" role="alert">
        <h1 className="h-display text-3xl">{d.common.errorTitle}</h1>
        <p className="mt-3 leading-relaxed">{d.common.errorBody}</p>
        <button type="button" className="btn mt-5" onClick={() => reset()}>
          {d.common.tryAgain}
        </button>
      </div>
    </main>
  );
}
