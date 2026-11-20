'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Locale } from './config';
import type { Dict } from './ms';

type I18n = { locale: Locale; d: Dict };
const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ locale, d, children }: I18n & { children: ReactNode }) {
  return <I18nContext.Provider value={{ locale, d }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

/** Inline bilingual helper for admin client components: const L = useL(); L('Simpan', 'Save'). */
export function useL(): (ms: string, en: string) => string {
  const { locale } = useI18n();
  return (bm, eng) => (locale === 'en' ? eng : bm);
}
