import 'server-only';
import { cache } from 'react';
import { paymentMode, type PaymentMode } from './env';
import { createServiceClient } from './supabase/server';
import type { Locale } from './i18n/config';
import type { Settings } from './types';

export const getSettings = cache(async (): Promise<Settings> => {
  const { data, error } = await createServiceClient().from('app_settings').select('*').eq('id', 1).single();
  if (error || !data) throw new Error('Settings row is missing. Have the migrations been applied?');
  return data as Settings;
});

export function localized(settings: Settings, field: 'pickup_instructions' | 'operating_hours' | 'cancellation_terms', locale: Locale): string {
  const primary = settings[`${field}_${locale}`];
  return (primary || settings[`${field}_${locale === 'ms' ? 'en' : 'ms'}`] || '').trim();
}

export type LaunchItem = { key: string; done: boolean; ms: string; en: string; href: string };

export type LaunchStatus = {
  items: LaunchItem[];
  complete: boolean;
  paymentMode: PaymentMode;
  /** Whether a visitor may start checkout right now. */
  bookingsOpen: boolean;
};

/**
 * Launch checklist. Real (live) payments stay off until the operator has
 * confirmed every item and switched live payments on. With test keys the
 * site is bookable so the whole journey can be rehearsed.
 */
export const getLaunchStatus = cache(async (): Promise<LaunchStatus> => {
  const db = createServiceClient();
  const settings = await getSettings();
  const [{ data: templates }, { data: units }] = await Promise.all([
    db.from('agreement_templates').select('locale').eq('status', 'published'),
    db.from('vehicles').select('registration_no, vehicle_models!inner(status)').eq('active', true).eq('vehicle_models.status', 'bookable'),
  ]);
  const published = new Set((templates ?? []).map((t) => t.locale));
  const bookableUnits = units ?? [];
  const mode = paymentMode();

  const items: LaunchItem[] = [
    { key: 'company', done: !!settings.company_name.trim() && !!settings.contact_phone.trim(), ms: 'Nama syarikat dan nombor telefon', en: 'Company name and contact phone', href: '/admin/settings' },
    { key: 'pickup', done: !!settings.pickup_instructions_ms.trim() && !!settings.pickup_instructions_en.trim(), ms: 'Arahan ambil kereta (BM dan English)', en: 'Pickup instructions (BM and English)', href: '/admin/settings' },
    { key: 'cancellation', done: !!settings.cancellation_terms_ms.trim() && !!settings.cancellation_terms_en.trim(), ms: 'Terma pembatalan (BM dan English)', en: 'Cancellation terms (BM and English)', href: '/admin/settings' },
    { key: 'rates', done: settings.rates_confirmed, ms: 'Kadar sewa sebenar disahkan', en: 'Real rental rates confirmed', href: '/admin/fleet' },
    { key: 'deposit', done: settings.deposit_confirmed, ms: 'Jumlah deposit disahkan', en: 'Deposit amount confirmed', href: '/admin/fleet' },
    { key: 'units', done: bookableUnits.length > 0 && bookableUnits.every((u) => u.registration_no.trim() !== ''), ms: 'No. pendaftaran untuk setiap kereta yang boleh ditempah', en: 'Registration number for every bookable car', href: '/admin/fleet' },
    { key: 'agreement', done: published.has('ms') && published.has('en'), ms: 'Perjanjian diterbitkan (BM dan English)', en: 'Agreement published (BM and English)', href: '/admin/agreement' },
    { key: 'email', done: !!(settings.email_from.trim() || process.env.EMAIL_FROM) && !!process.env.RESEND_API_KEY, ms: 'Emel penghantar dan kunci Resend', en: 'Sender email and Resend key', href: '/admin/settings' },
    { key: 'stripe', done: mode !== 'unconfigured' && !!process.env.STRIPE_WEBHOOK_SECRET, ms: 'Kunci Stripe dan rahsia webhook', en: 'Stripe keys and webhook secret', href: '/admin/settings' },
  ];
  const complete = items.every((i) => i.done);
  const bookingsOpen = mode === 'test' || (mode === 'live' && complete && settings.live_payments_enabled);
  return { items, complete, paymentMode: mode, bookingsOpen };
});
