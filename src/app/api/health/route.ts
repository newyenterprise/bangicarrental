import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Liveness + readiness. `GET /api/health` returns 200 as soon as the server is
 * up (used by the container health check). `GET /api/health?deep=1` also
 * checks that the database is reachable and returns 503 when it is not.
 */
export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get('deep') === '1';
  if (!deep) return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const { error } = await createServiceClient().from('app_settings').select('id').eq('id', 1).single();
    if (error) throw new Error('database');
    return NextResponse.json({ status: 'ok', database: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ status: 'degraded', database: 'unreachable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
