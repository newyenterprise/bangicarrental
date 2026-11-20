import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { audit } from '@/lib/audit';
import { assertAdmin } from '@/lib/auth';
import { BUCKETS, MAX_UPLOAD_BYTES, sniffFile, uploadPrivate } from '@/lib/storage';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Admin-only upload of a pickup/return condition photo into the private bucket. */
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
  const handoverId = String(form.get('handover_id') ?? '');
  const file = form.get('file');
  if (!/^[0-9a-f-]{36}$/i.test(handoverId) || !(file instanceof File)) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'size' }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffFile(bytes, false);
  if (!type) return NextResponse.json({ error: 'type' }, { status: 415 });

  const db = createServiceClient();
  const { data: handover } = await db.from('handovers').select('id, booking_id, kind').eq('id', handoverId).maybeSingle();
  if (!handover) return NextResponse.json({ error: 'invalid' }, { status: 404 });

  const path = `${handover.booking_id}/${handover.id}/${randomUUID()}.${type.ext}`;
  try {
    await uploadPrivate(BUCKETS.handover, path, bytes, type.mime);
  } catch {
    return NextResponse.json({ error: 'failed' }, { status: 502 });
  }
  const { data: photo, error } = await db
    .from('handover_photos')
    .insert({ handover_id: handover.id, booking_id: handover.booking_id, storage_path: path, uploaded_by: actor.id })
    .select('id')
    .single();
  if (error || !photo) return NextResponse.json({ error: 'failed' }, { status: 500 });

  await audit({ actor, action: 'handover.photo_added', bookingId: handover.booking_id, entityType: 'handover_photo', entityId: photo.id, metadata: { kind: handover.kind } });
  return NextResponse.json({ id: photo.id });
}
