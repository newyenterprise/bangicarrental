import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { processOutbox } from '@/lib/email/outbox';
import { env } from '@/lib/env';
import { reconcileExpiredHolds } from '@/lib/payments';
import { purgeExpiredDocuments } from '@/lib/retention';

export const dynamic = 'force-dynamic';

function authorised(request: Request): boolean {
  const secret = env.cronSecret;
  const header = request.headers.get('authorization') ?? '';
  if (!secret || secret.length < 16) return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Scheduled maintenance, called every minute by the Coolify scheduled task
 * (see README). Each step is idempotent and independent, so a failure in one
 * does not stop the others and overlapping runs are safe.
 */
export async function POST(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const run = async <T>(name: string, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      console.error(`[cron] ${name} failed`, err instanceof Error ? err.message : 'error');
      return { error: true };
    }
  };

  const holds = await run('holds', reconcileExpiredHolds);
  const emails = await run('emails', () => processOutbox(25));
  // Retention only needs to run occasionally; once an hour is plenty.
  const retention = new Date().getMinutes() === 7 ? await run('retention', purgeExpiredDocuments) : 'skipped';

  return NextResponse.json({ ok: true, holds, emails, retention });
}
