import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { audit } from '@/lib/audit';
import { assertAdmin } from '@/lib/auth';
import { BUCKETS, sniffFile } from '@/lib/storage';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Admin-only upload of a public catalogue image for a model listing. */
export async function POST(request: Request) {
  let actor;
  try {
    actor = await assertAdmin();
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const modelId = String(form.get('model_id') ?? '');
  const file = form.get('file');
  if (!/^[0-9a-f-]{36}$/i.test(modelId) || !(file instanceof File)) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: 'size' }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffFile(bytes, false);
  // The public bucket only accepts web image formats.
  if (!type || type.mime === 'image/heic') return NextResponse.json({ error: 'type' }, { status: 415 });

  const db = createServiceClient();
  const { data: model } = await db.from('vehicle_models').select('id').eq('id', modelId).maybeSingle();
  if (!model) return NextResponse.json({ error: 'invalid' }, { status: 404 });

  const path = `${model.id}/${randomUUID()}.${type.ext}`;
  const bucket = db.storage.from(BUCKETS.modelImages);
  const { error: uploadError } = await bucket.upload(path, bytes, { contentType: type.mime, upsert: false, cacheControl: '31536000' });
  if (uploadError) return NextResponse.json({ error: 'failed' }, { status: 502 });
  const { data: publicUrl } = bucket.getPublicUrl(path);
  const { error } = await db.from('vehicle_models').update({ image_url: publicUrl.publicUrl, updated_at: new Date().toISOString() }).eq('id', model.id);
  if (error) return NextResponse.json({ error: 'failed' }, { status: 500 });

  await audit({ actor, action: 'model.image_updated', entityType: 'vehicle_model', entityId: model.id });
  return NextResponse.json({ ok: true });
}
