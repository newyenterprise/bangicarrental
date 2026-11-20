import 'server-only';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from './config';
import { ms, type Dict } from './ms';
import { en } from './en';

export const DICTS: Record<Locale, Dict> = { ms, en };

/** Bahasa Melayu unless the visitor has chosen English. */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getI18n(): Promise<{ locale: Locale; d: Dict }> {
  const locale = await getLocale();
  return { locale, d: DICTS[locale] };
}

/** Inline bilingual helper used by the admin area: L('Tempahan', 'Bookings'). */
export type Pick2 = (ms: string, en: string) => string;
export function pick(locale: Locale): Pick2 {
  return (bm, eng) => (locale === 'en' ? eng : bm);
}
