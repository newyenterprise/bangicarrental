import { NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { BUCKETS, signedUrl } from '@/lib/storage';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Admin-only: redirects to a short-lived signed link for one condition photo. */
export async function GET(_request: Request, { params }: RouteContext<'/api/admin/handover-photos/[id]'>) {
  try {
    await assertAdmin();
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { data: photo } = await createServiceClient().from('handover_photos').select('storage_path').eq('id', id).maybeSingle();
  if (!photo) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const url = await signedUrl(BUCKETS.handover, photo.storage_path);
  if (!url) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
