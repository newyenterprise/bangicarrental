'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setLocale } from '@/app/actions';
import { useI18n } from '@/lib/i18n/client';

/**
 * BM / English selector. It saves the choice in a cookie and refreshes the
 * server-rendered text in place, so the current page, the dates in the URL
 * and anything typed into a form are all kept.
 */
export function LanguageSwitch() {
  const { locale } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      aria-label="Bahasa / Language"
      className="min-h-11 rounded-full border border-[#c8d1c8] bg-transparent px-3 py-2 text-sm font-bold"
      value={locale}
      disabled={pending}
      onChange={(event) => {
        const next = event.target.value;
        startTransition(async () => {
          await setLocale(next);
          router.refresh();
        });
      }}
    >
      <option value="ms">BM</option>
      <option value="en">English</option>
    </select>
  );
}
