import 'server-only';
import { env } from '../env';
import { getSettings } from '../settings';
import { createServiceClient } from '../supabase/server';
import type { Locale } from '../i18n/config';
import type { Booking } from '../types';
import { renderEmail, type EmailTemplate } from './templates';

type EnqueueInput = {
  /** Same key = same email. A replayed webhook or double click cannot send it twice. */
  dedupeKey: string;
  /** A real address, or 'admin' to resolve the operator's alert address when sending. */
  to: string;
  locale: Locale;
  template: EmailTemplate;
  bookingId: string;
  data?: Record<string, unknown>;
};

/** Queues an email. Sending happens separately, so a mail outage never loses the action. */
export async function enqueueEmail(input: EnqueueInput): Promise<void> {
  const { error } = await createServiceClient().from('email_outbox').upsert(
    {
      dedupe_key: input.dedupeKey,
      to_email: input.to,
      locale: input.locale,
      template: input.template,
      booking_id: input.bookingId,
      data: input.data ?? {},
    },
    { onConflict: 'dedupe_key', ignoreDuplicates: true },
  );
  if (error) console.error('[email] enqueue failed', input.template, error.code);
}

const MAX_ATTEMPTS = 8;

type OutboxRow = {
  id: string;
  to_email: string;
  locale: Locale;
  template: EmailTemplate;
  data: Record<string, unknown>;
  booking_id: string | null;
  attempts: number;
};

/**
 * Sends due emails. Safe to run from overlapping scheduler ticks and across
 * restarts: rows are claimed with SKIP LOCKED and retried with a growing delay.
 */
export async function processOutbox(limit = 20): Promise<{ sent: number; failed: number; waiting: number }> {
  const db = createServiceClient();
  const { data: rows, error } = await db.rpc('claim_outbox', { p_limit: limit });
  if (error) throw new Error('claim_outbox failed');
  const result = { sent: 0, failed: 0, waiting: 0 };
  if (!rows?.length) return result;

  const settings = await getSettings();
  const from = settings.email_from.trim() || env.emailFrom;
  const replyTo = settings.email_reply_to.trim() || settings.contact_email.trim() || undefined;
  const adminTo = settings.admin_alert_email.trim() || env.adminAlertEmail || settings.contact_email.trim();
  const logOnly = process.env.EMAIL_DELIVERY === 'log';

  for (const row of rows as OutboxRow[]) {
    const fail = async (message: string, final = false) => {
      const giveUp = final || row.attempts >= MAX_ATTEMPTS;
      const delayMinutes = Math.min(360, 2 ** row.attempts);
      await db
        .from('email_outbox')
        .update({
          status: giveUp ? 'failed' : 'pending',
          last_error: message.slice(0, 300),
          next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
        })
        .eq('id', row.id);
      if (giveUp) result.failed += 1;
      else result.waiting += 1;
    };

    try {
      const to = row.to_email === 'admin' ? adminTo : row.to_email;
      if (!to) {
        await fail('No admin alert email configured');
        continue;
      }
      const { data: booking } = await db.from('bookings').select('*').eq('id', row.booking_id).maybeSingle();
      if (!booking) {
        await fail('Booking no longer exists', true);
        continue;
      }
      const { data: model } = await db.from('vehicle_models').select('name').eq('id', booking.model_id).maybeSingle();
      const email = renderEmail(row.template, {
        booking: booking as Booking,
        modelName: model?.name ?? '',
        settings,
        locale: row.locale,
        data: row.data,
        appUrl: env.appUrl,
      });

      if (logOnly) {
        // Development only: subject and recipient domain, never the body.
        console.info(`[email:log] ${row.template} -> *@${to.split('@')[1] ?? '?'} :: ${email.subject}`);
      } else {
        if (!env.resendApiKey || !from) {
          await fail('Email is not configured (RESEND_API_KEY / sender address)');
          continue;
        }
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.resendApiKey}`,
            'Content-Type': 'application/json',
            // Resend also de-duplicates on this key if a send is retried after a timeout.
            'Idempotency-Key': `outbox-${row.id}`,
          },
          body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject: email.subject, html: email.html, text: email.text }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          await fail(`Resend responded ${response.status}`);
          continue;
        }
      }
      await db.from('email_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }).eq('id', row.id);
      result.sent += 1;
    } catch (err) {
      await fail(err instanceof Error ? err.name : 'send error');
    }
  }
  return result;
}
