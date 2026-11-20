import type { Locale } from './i18n/config';

export const TIME_ZONE = 'Asia/Kuala_Lumpur';
const KL_OFFSET = '+08:00'; // Malaysia has no daylight saving time.

const INTL: Record<Locale, string> = { ms: 'ms-MY', en: 'en-MY' };

/** "2026-11-25T10:00" (a datetime-local value, meaning Kuala Lumpur time) -> Date. */
export function parseKlLocal(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00${KL_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Date -> "YYYY-MM-DDTHH:mm" in Kuala Lumpur time, for datetime-local inputs. */
export function toKlLocal(date: Date | string): string {
  const d = new Date(new Date(date).getTime() + 8 * 3600_000);
  return d.toISOString().slice(0, 16);
}

export function formatDateTime(value: Date | string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL[locale], {
    timeZone: TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(value));
}

export function formatDate(value: Date | string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL[locale], {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function formatTime(value: Date | string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL[locale], {
    timeZone: TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(value));
}

/** "YYYY-MM-DD" of a moment in Kuala Lumpur. */
export function klDateKey(value: Date | string): string {
  return toKlLocal(value).slice(0, 10);
}

/** Start of a Kuala Lumpur calendar day ("YYYY-MM-DD") as a Date. */
export function klDayStart(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00${KL_OFFSET}`);
}

/** A partial 24-hour period rounds up to the next day (mirrors public.rental_days). */
export function rentalDays(start: Date, end: Date): number {
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
}
