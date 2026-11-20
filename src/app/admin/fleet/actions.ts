'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { GENERIC_ERROR, INVALID_INPUT, echo, str, type FormState, type Msg } from '@/lib/admin/form';
import { audit } from '@/lib/audit';
import { assertAdmin, type SessionUser } from '@/lib/auth';
import { parseRM } from '@/lib/money';
import { createServiceClient } from '@/lib/supabase/server';

const FORBIDDEN: Msg = ['Anda tidak dibenarkan melakukan tindakan ini.', 'You are not allowed to do this.'];
const Uuid = z.string().uuid();

async function admin(): Promise<SessionUser | null> {
  try {
    return await assertAdmin();
  } catch {
    return null;
  }
}

const done = () => {
  revalidatePath('/admin/fleet');
  revalidatePath('/admin');
  revalidatePath('/');
};

const Model = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60),
  seats: z.coerce.number().int().min(1).max(20),
  transmission: z.enum(['automatic', 'manual']),
  tagline_ms: z.string().trim().max(120),
  tagline_en: z.string().trim().max(120),
  prep_buffer_minutes: z.coerce.number().int().min(0).max(2880),
  sort_order: z.coerce.number().int().min(0).max(999),
  status: z.enum(['hidden', 'preview', 'bookable']),
});

/** Create or edit a public model listing. A model can only be bookable with a rate and an active unit. */
export async function saveModelAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const values = echo(form);
  const idRaw = str(form, 'model_id');
  const id = idRaw ? Uuid.safeParse(idRaw) : null;
  if (id && !id.success) return { error: INVALID_INPUT, values };
  const parsed = Model.safeParse({
    name: str(form, 'name'),
    slug: str(form, 'slug'),
    seats: str(form, 'seats'),
    transmission: str(form, 'transmission'),
    tagline_ms: str(form, 'tagline_ms'),
    tagline_en: str(form, 'tagline_en'),
    prep_buffer_minutes: str(form, 'prep_buffer_minutes') || '0',
    sort_order: str(form, 'sort_order') || '0',
    status: str(form, 'status'),
  });
  const rate = parseRM(str(form, 'daily_rate') || '0');
  const deposit = parseRM(str(form, 'deposit') || '0');
  if (!parsed.success) {
    return { error: ['Semak nama, slug (huruf kecil, nombor dan sengkang sahaja) dan bilangan tempat duduk.', 'Check the name, slug (lowercase letters, numbers and hyphens only) and seats.'], values };
  }
  if (rate == null || deposit == null) return { error: ['Masukkan kadar dan deposit dalam RM.', 'Enter the rate and deposit in RM.'], values };

  const db = createServiceClient();
  if (parsed.data.status === 'bookable') {
    if (rate <= 0) return { error: ['Model boleh ditempah memerlukan kadar harian melebihi RM0.', 'A bookable model needs a daily rate above RM0.'], values };
    const { count } = id
      ? await db.from('vehicles').select('id', { count: 'exact', head: true }).eq('model_id', id.data).eq('active', true)
      : { count: 0 };
    if (!count) {
      return {
        error: [
          'Model hanya boleh ditempah jika ada sekurang-kurangnya satu kereta fizikal yang aktif. Simpan sebagai Pratonton, tambah unit, kemudian tukar kepada Boleh ditempah.',
          'A model can only be bookable when it has at least one active physical car. Save it as Preview, add a unit, then switch it to Bookable.',
        ],
        values,
      };
    }
  }

  const row = { ...parsed.data, daily_rate_sen: rate, deposit_sen: deposit, updated_at: new Date().toISOString() };
  if (id) {
    const { data: before } = await db.from('vehicle_models').select('*').eq('id', id.data).maybeSingle();
    if (!before) return { error: INVALID_INPUT, values };
    const { error } = await db.from('vehicle_models').update(row).eq('id', id.data);
    if (error) return { error: error.code === '23505' ? ['Slug ini sudah digunakan.', 'That slug is already in use.'] : GENERIC_ERROR, values };
    const changed = Object.keys(row).filter((key) => key !== 'updated_at' && String((before as Record<string, unknown>)[key]) !== String((row as Record<string, unknown>)[key]));
    await audit({
      actor,
      action: 'model.updated',
      entityType: 'vehicle_model',
      entityId: id.data,
      metadata: { changed, ...(changed.includes('daily_rate_sen') ? { daily_rate_sen: [before.daily_rate_sen, rate] } : {}), ...(changed.includes('deposit_sen') ? { deposit_sen: [before.deposit_sen, deposit] } : {}), ...(changed.includes('status') ? { status: [before.status, row.status] } : {}) },
    });
    done();
    return { ok: ['Model disimpan. Tempahan sedia ada kekal dengan harga asal.', 'Model saved. Existing bookings keep their original price.'], values };
  }

  const { data: created, error } = await db.from('vehicle_models').insert(row).select('id').single();
  if (error || !created) return { error: error?.code === '23505' ? ['Slug ini sudah digunakan.', 'That slug is already in use.'] : GENERIC_ERROR, values };
  await audit({ actor, action: 'model.created', entityType: 'vehicle_model', entityId: created.id, metadata: { slug: row.slug, status: row.status } });
  done();
  return { ok: ['Model ditambah. Muat naik gambar dan tambah unit di bawah.', 'Model added. Upload an image and add a unit below.'] };
}

const Unit = z.object({
  model_id: Uuid,
  label: z.string().trim().max(60),
  registration_no: z.string().trim().toUpperCase().max(20),
  colour: z.string().trim().max(40),
  notes: z.string().trim().max(500),
});

/** Create or edit a physical car. These details are private and never shown in the public catalogue. */
export async function saveVehicleAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const values = echo(form);
  const idRaw = str(form, 'vehicle_id');
  const id = idRaw ? Uuid.safeParse(idRaw) : null;
  if (id && !id.success) return { error: INVALID_INPUT, values };
  const parsed = Unit.safeParse({ model_id: str(form, 'model_id'), label: str(form, 'label'), registration_no: str(form, 'registration_no'), colour: str(form, 'colour'), notes: str(form, 'notes') });
  const yearRaw = str(form, 'model_year');
  const year = yearRaw ? Number(yearRaw) : null;
  if (!parsed.success || (year != null && (!Number.isInteger(year) || year < 1990 || year > 2100))) return { error: INVALID_INPUT, values };
  const active = form.get('active') === 'on';
  const db = createServiceClient();
  const row = { ...parsed.data, model_year: year, active };

  if (id) {
    const { data: before } = await db.from('vehicles').select('*, vehicle_models(status)').eq('id', id.data).maybeSingle();
    if (!before) return { error: INVALID_INPUT, values };
    if (before.active && !active) {
      const model = Array.isArray(before.vehicle_models) ? before.vehicle_models[0] : before.vehicle_models;
      const { count } = await db.from('vehicles').select('id', { count: 'exact', head: true }).eq('model_id', before.model_id).eq('active', true);
      if (model?.status === 'bookable' && (count ?? 0) <= 1) {
        return { error: ['Ini satu-satunya kereta aktif untuk model yang boleh ditempah. Tukar model kepada Pratonton dahulu.', 'This is the only active car for a bookable model. Switch the model to Preview first.'], values };
      }
    }
    const { error } = await db.from('vehicles').update(row).eq('id', id.data);
    if (error) return { error: GENERIC_ERROR, values };
    await audit({ actor, action: 'vehicle.updated', entityType: 'vehicle', entityId: id.data, metadata: { active } });
    done();
    return { ok: ['Kereta disimpan.', 'Car saved.'], values: { ...values, ...(active ? { active: 'on' } : { active: '' }) } };
  }

  const { data: created, error } = await db.from('vehicles').insert(row).select('id').single();
  if (error || !created) return { error: GENERIC_ERROR, values };
  await audit({ actor, action: 'vehicle.created', entityType: 'vehicle', entityId: created.id, metadata: { model_id: row.model_id } });
  done();
  return { ok: ['Kereta ditambah.', 'Car added.'] };
}

/** The operator's explicit confirmation that the rates and deposit are the real launch values. */
export async function confirmationsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const rates = form.get('rates_confirmed') === 'on';
  const deposit = form.get('deposit_confirmed') === 'on';
  const { error } = await createServiceClient()
    .from('app_settings')
    .update({ rates_confirmed: rates, deposit_confirmed: deposit, updated_at: new Date().toISOString(), updated_by: actor.id })
    .eq('id', 1);
  if (error) return { error: GENERIC_ERROR };
  await audit({ actor, action: 'settings.updated', entityType: 'app_settings', entityId: '1', metadata: { changed: ['rates_confirmed', 'deposit_confirmed'], rates_confirmed: rates, deposit_confirmed: deposit } });
  done();
  revalidatePath('/admin/settings');
  return { ok: ['Pengesahan disimpan.', 'Confirmation saved.'], values: { rates_confirmed: rates ? 'on' : '', deposit_confirmed: deposit ? 'on' : '' } };
}
