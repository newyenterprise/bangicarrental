'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { GENERIC_ERROR, echo, str, type FormState, type Msg } from '@/lib/admin/form';
import { audit } from '@/lib/audit';
import { assertAdmin, type SessionUser } from '@/lib/auth';
import { getLaunchStatus, getSettings } from '@/lib/settings';
import { createServiceClient } from '@/lib/supabase/server';

const FORBIDDEN: Msg = ['Anda tidak dibenarkan melakukan tindakan ini.', 'You are not allowed to do this.'];

async function admin(): Promise<SessionUser | null> {
  try {
    return await assertAdmin();
  } catch {
    return null;
  }
}

const optionalEmail = z.union([z.literal(''), z.string().trim().email().max(200)]);
// "Bangi Car Rental <tempahan@bangicarrental.my>" or a bare address.
const sender = z.union([z.literal(''), z.string().trim().max(200).regex(/^([^<>]+<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>|[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)$/)]);
const text = (max: number) => z.string().trim().max(max);
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const Settings = z.object({
  company_name: text(160),
  display_name: text(80).min(2),
  contact_phone: text(30),
  contact_email: optionalEmail,
  pickup_area: text(80).min(2),
  pickup_instructions_ms: text(4000),
  pickup_instructions_en: text(4000),
  operating_hours_ms: text(500),
  operating_hours_en: text(500),
  cancellation_terms_ms: text(4000),
  cancellation_terms_en: text(4000),
  lead_time_hours: int(0, 720),
  verification_deadline_hours: int(0, 720),
  hold_minutes: int(30, 120),
  max_rental_days: int(1, 365),
  document_retention_days: int(0, 3650),
  email_from: sender,
  email_reply_to: optionalEmail,
  admin_alert_email: optionalEmail,
  payment_provider: z.enum(['billplz', 'stripe']),
});

export async function saveSettingsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const values = echo(form);
  const input = Object.fromEntries(Object.keys(Settings.shape).map((key) => [key, str(form, key)]));
  const parsed = Settings.safeParse(input);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].join(', ');
    return { error: [`Semak medan ini: ${fields}`, `Check these fields: ${fields}`], values };
  }

  const before = await getSettings();
  const changed = Object.keys(parsed.data).filter((key) => String((before as unknown as Record<string, unknown>)[key]) !== String((parsed.data as Record<string, unknown>)[key]));
  if (changed.length === 0) return { ok: ['Tiada perubahan.', 'Nothing changed.'], values };
  const { error } = await createServiceClient()
    .from('app_settings')
    .update({ ...parsed.data, updated_at: new Date().toISOString(), updated_by: actor.id })
    .eq('id', 1);
  if (error) return { error: GENERIC_ERROR, values };
  // Field names only: the audit log does not copy addresses or instructions.
  await audit({ actor, action: 'settings.updated', entityType: 'app_settings', entityId: '1', metadata: { changed } });
  revalidatePath('/admin/settings');
  revalidatePath('/admin');
  revalidatePath('/');
  return { ok: ['Tetapan disimpan.', 'Settings saved.'], values };
}

/** Live payments can only be switched on once every launch item is complete. Enforced here, not in the UI. */
export async function setLivePaymentsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const enable = form.get('enable') === 'true';
  if (enable) {
    const launch = await getLaunchStatus();
    if (!launch.complete) {
      const todoMs = launch.items.filter((i) => !i.done).map((i) => `• ${i.ms}`).join('\n');
      const todoEn = launch.items.filter((i) => !i.done).map((i) => `• ${i.en}`).join('\n');
      return { error: [`Lengkapkan dahulu:\n${todoMs}`, `Complete these first:\n${todoEn}`] };
    }
    if (launch.paymentMode !== 'live') {
      return { error: ['Kunci Stripe yang dipasang ialah kunci ujian. Pasang kunci live (sk_live_…) dan rahsia webhook live dahulu.', 'The installed Stripe key is a test key. Install the live key (sk_live_…) and the live webhook secret first.'] };
    }
  }
  const { error } = await createServiceClient()
    .from('app_settings')
    .update({ live_payments_enabled: enable, updated_at: new Date().toISOString(), updated_by: actor.id })
    .eq('id', 1);
  if (error) return { error: GENERIC_ERROR };
  await audit({ actor, action: enable ? 'settings.live_payments_enabled' : 'settings.live_payments_disabled', entityType: 'app_settings', entityId: '1' });
  revalidatePath('/admin/settings');
  revalidatePath('/admin');
  revalidatePath('/');
  return enable
    ? { ok: ['Bayaran sebenar dihidupkan. Pelanggan kini dicaj wang sebenar.', 'Live payments enabled. Customers are now charged real money.'] }
    : { ok: ['Bayaran sebenar dimatikan. Tempahan awam ditutup dalam mod live.', 'Live payments disabled. Public bookings are closed in live mode.'] };
}
