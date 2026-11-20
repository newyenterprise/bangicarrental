'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-checks the server-side payment state every few seconds while it is processing. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
