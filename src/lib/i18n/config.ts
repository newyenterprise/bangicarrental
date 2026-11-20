export const LOCALES = ['ms', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ms';
export const LOCALE_COOKIE = 'bcr_locale';

export function isLocale(value: unknown): value is Locale {
  return value === 'ms' || value === 'en';
}

/** Replaces {name} placeholders. */
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));
}
