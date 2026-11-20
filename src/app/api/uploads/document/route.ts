import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { audit } from '@/lib/audit';
import { driverEditable, getOwnedDriver } from '@/lib/renter/data';
import { BUCKETS, MAX_UPLOAD_BYTES, removeObjects, sniffFile, uploadPrivate } from '@/lib/storage';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const fail = (error: 'errFileType' | 'errFileSize' | 'errUpload', status: number) =>
  NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Identity / licence upload for a renter's own driver. The file is checked
 * here (size and real file signature) and stored privately by the server;
 * the browser never talks to storage. Nothing about the file contents or
 * name is logged.
 */
export async function POST(request: Request) {
  // Cheap early rejection before reading the body (multipart overhead allowed for).
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return fail('errFileSize', 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail('errUpload', 400);
  }
  const kind = form.get('kind');
  const file = form.get('file');
  if ((kind !== 'identity' && kind !== 'licence') || !(file instanceof File)) return fail('errUpload', 400);

  const owned = await getOwnedDriver(String(form.get('driver_id') ?? ''));
  if (!owned) return fail('errUpload', 404);
  const { user, booking, driver } = owned;
  if (!driverEditable(booking, driver)) return fail('errUpload', 409);

  if (file.size === 0) return fail('errFileType', 415);
  if (file.size > MAX_UPLOAD_BYTES) return fail('errFileSize', 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffFile(bytes);
  if (!type) return fail('errFileType', 415);

  const path = `${booking.id}/${driver.id}/${kind}-${randomUUID()}.${type.ext}`;
  const db = createServiceClient();
  try {
    await uploadPrivate(BUCKETS.documents, path, bytes, type.mime);
  } catch {
    return fail('errUpload', 502);
  }

  const { data: previous } = await db.from('documents').select('id, storage_path').eq('driver_id', driver.id).eq('kind', kind).eq('status', 'active');
  const { data: created, error } = await db
    .from('documents')
    .insert({ booking_id: booking.id, driver_id: driver.id, kind, storage_path: path, mime_type: type.mime, size_bytes: bytes.length, uploaded_by: user.id })
    .select('id, kind')
    .single();
  if (error || !created) {
    await removeObjects(BUCKETS.documents, [path]);
    return fail('errUpload', 500);
  }
  if (previous?.length) {
    await db.from('documents').update({ status: 'superseded', deleted_at: new Date().toISOString() }).in('id', previous.map((p) => p.id));
    await removeObjects(BUCKETS.documents, previous.map((p) => p.storage_path));
  }

  await audit({ actor: user, action: 'document.uploaded', bookingId: booking.id, entityType: 'document', entityId: created.id, metadata: { kind, size_bytes: bytes.length, mime_type: type.mime } });
  return NextResponse.json({ ok: true, document: created }, { headers: { 'Cache-Control': 'no-store' } });
}
