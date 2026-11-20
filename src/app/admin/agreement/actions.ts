'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { GENERIC_ERROR, INVALID_INPUT, echo, str, type FormState, type Msg } from '@/lib/admin/form';
import { audit } from '@/lib/audit';
import { assertAdmin, type SessionUser } from '@/lib/auth';
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
  revalidatePath('/admin/agreement');
  revalidatePath('/admin');
};

/** Saves a draft. Published and archived versions are immutable. */
export async function saveDraftAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const values = echo(form);
  const id = Uuid.safeParse(form.get('template_id'));
  const title = str(form, 'title');
  const body = String(form.get('body') ?? '').trim();
  if (!id.success) return { error: INVALID_INPUT, values };
  if (title.length < 3 || body.length < 50) return { error: ['Tajuk dan kandungan perjanjian diperlukan.', 'A title and the agreement text are required.'], values };
  if (body.length > 60_000) return { error: ['Teks terlalu panjang.', 'The text is too long.'], values };

  const { data, error } = await createServiceClient()
    .from('agreement_templates')
    .update({ title, body, updated_at: new Date().toISOString() })
    .eq('id', id.data)
    .eq('status', 'draft')
    .select('id, locale, version');
  if (error) return { error: GENERIC_ERROR, values };
  if (!data?.length) return { error: ['Hanya draf boleh disunting. Buat draf baharu daripada versi yang diterbitkan.', 'Only drafts can be edited. Create a new draft from the published version.'], values };
  await audit({ actor, action: 'agreement_template.draft_saved', entityType: 'agreement_template', entityId: id.data, metadata: { locale: data[0].locale, version: data[0].version } });
  done();
  return { ok: ['Draf disimpan. Ia belum digunakan sehingga diterbitkan.', 'Draft saved. It is not used until published.'], values };
}

/** Starts the next version as a draft, copied from the published one (or the latest). */
export async function newDraftAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const locale = z.enum(['ms', 'en']).safeParse(form.get('locale'));
  if (!locale.success) return { error: INVALID_INPUT };
  const db = createServiceClient();
  const { data: rows } = await db.from('agreement_templates').select('*').eq('locale', locale.data).order('version', { ascending: false });
  const all = rows ?? [];
  if (all.some((t) => t.status === 'draft')) return { warn: ['Sudah ada draf untuk bahasa ini. Sunting draf itu.', 'There is already a draft for this language. Edit that draft.'] };
  const source = all.find((t) => t.status === 'published') ?? all[0];
  const version = (all[0]?.version ?? 0) + 1;
  const { data: created, error } = await db
    .from('agreement_templates')
    .insert({
      locale: locale.data,
      version,
      title: source?.title ?? (locale.data === 'en' ? 'Vehicle Rental Agreement' : 'Perjanjian Sewa Kenderaan'),
      body: source?.body ?? '## 1. …',
      status: 'draft',
    })
    .select('id')
    .single();
  if (error || !created) return { error: GENERIC_ERROR };
  await audit({ actor, action: 'agreement_template.draft_created', entityType: 'agreement_template', entityId: created.id, metadata: { locale: locale.data, version, copied_from: source?.id ?? null } });
  done();
  return { ok: [`Draf versi ${version} dibuat.`, `Draft version ${version} created.`] };
}

/** Publishes a draft as the approved text for its language. Signed agreements are untouched. */
export async function publishAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await admin();
  if (!actor) return { error: FORBIDDEN };
  const id = Uuid.safeParse(form.get('template_id'));
  if (!id.success) return { error: INVALID_INPUT };
  const db = createServiceClient();
  const { data: draft } = await db.from('agreement_templates').select('*').eq('id', id.data).maybeSingle();
  if (!draft || draft.status !== 'draft') return { warn: ['Versi ini bukan draf.', 'This version is not a draft.'] };

  const now = new Date().toISOString();
  // Archive first: the database allows only one published version per language.
  const { data: archived } = await db.from('agreement_templates').update({ status: 'archived', updated_at: now }).eq('locale', draft.locale).eq('status', 'published').select('id, version');
  const { data: published, error } = await db
    .from('agreement_templates')
    .update({ status: 'published', published_at: now, published_by: actor.id, updated_at: now })
    .eq('id', draft.id)
    .eq('status', 'draft')
    .select('id');
  if (error || !published?.length) {
    // Put the previous version back so renters are never left without an agreement.
    if (archived?.length) await db.from('agreement_templates').update({ status: 'published', updated_at: now }).eq('id', archived[0].id);
    return { error: GENERIC_ERROR };
  }
  await audit({ actor, action: 'agreement_template.published', entityType: 'agreement_template', entityId: draft.id, metadata: { locale: draft.locale, version: draft.version, replaced_version: archived?.[0]?.version ?? null } });
  done();
  return {
    ok: [
      `Versi ${draft.version} diterbitkan. Perjanjian baharu akan menggunakan teks ini; perjanjian yang sudah ditandatangani tidak berubah.`,
      `Version ${draft.version} published. New agreements use this text; agreements already signed are unchanged.`,
    ],
  };
}
