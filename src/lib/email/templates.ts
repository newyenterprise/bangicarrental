import { fmt, type Locale } from '../i18n/config';
import { ms } from '../i18n/ms';
import { en } from '../i18n/en';
import { formatRM } from '../money';
import { formatDateTime } from '../time';
import type { Booking, Settings } from '../types';

export type EmailTemplate =
  | 'payment_confirmed'
  | 'payment_attention'
  | 'correction_requested'
  | 'agreement_ready'
  | 'ready_for_pickup'
  | 'request_outcome'
  | 'booking_cancelled'
  | 'refund_issued'
  | 'admin_booking_paid'
  | 'admin_documents_review'
  | 'admin_payment_attention'
  | 'admin_request_received'
  | 'admin_agreement_signed';

type Context = {
  booking: Booking;
  modelName: string;
  settings: Settings;
  locale: Locale;
  data: Record<string, unknown>;
  appUrl: string;
};

export type RenderedEmail = { subject: string; html: string; text: string };

const DICT = { ms, en };

const esc = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Block = { p: string } | { quote: string } | { rows: [string, string][] } | { button: [string, string] };

function layout(company: string, blocks: Block[], footer: string): { html: string; text: string } {
  const html: string[] = [];
  const text: string[] = [];
  for (const block of blocks) {
    if ('p' in block) {
      html.push(`<p style="margin:0 0 16px;line-height:1.55">${esc(block.p)}</p>`);
      text.push(block.p);
    } else if ('quote' in block) {
      html.push(
        `<p style="margin:0 0 16px;padding:12px 14px;background:#f3f1e7;border-left:4px solid #f3c566;border-radius:6px;line-height:1.55;white-space:pre-line">${esc(block.quote)}</p>`,
      );
      text.push(`> ${block.quote}`);
    } else if ('rows' in block) {
      html.push(
        `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px">${block.rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:8px 0;border-bottom:1px solid #dde3da;color:#58685e">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #dde3da;text-align:right;font-weight:700">${esc(v)}</td></tr>`,
          )
          .join('')}</table>`,
      );
      text.push(block.rows.map(([k, v]) => `${k}: ${v}`).join('\n'));
    } else {
      const [label, url] = block.button;
      html.push(
        `<p style="margin:8px 0 20px"><a href="${esc(url)}" style="display:inline-block;background:#195642;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:12px">${esc(label)}</a></p>`,
      );
      text.push(`${label}: ${url}`);
    }
  }
  return {
    html: `<!doctype html><html><body style="margin:0;background:#faf9f4;font-family:Arial,Helvetica,sans-serif;color:#163c33;font-size:16px"><div style="max-width:560px;margin:0 auto;padding:28px 20px"><p style="margin:0 0 22px;font-weight:900;font-size:20px;letter-spacing:-0.5px">${esc(company)}</p>${html.join('')}<p style="margin:28px 0 0;font-size:13px;color:#617066;line-height:1.5">${esc(footer)}</p></div></body></html>`,
    text: `${text.join('\n\n')}\n\n${footer}`,
  };
}

export function renderEmail(template: EmailTemplate, ctx: Context): RenderedEmail {
  const { booking, settings, locale, data, appUrl, modelName } = ctx;
  const e = DICT[locale].email;
  const company = settings.display_name || 'Bangi Car Rental';
  const reference = booking.reference;
  const bookingUrl = `${appUrl}/bookings/${booking.id}`;
  const adminUrl = `${appUrl}/admin/bookings/${booking.id}`;
  const footer = fmt(e.footer, { company });
  const greeting: Block = { p: fmt(e.greeting, { name: booking.customer_name.split(' ')[0] || booking.customer_name }) };
  const summary: Block = {
    rows: [
      [e.reference, reference],
      [e.vehicle, modelName],
      [e.pickup, formatDateTime(booking.starts_at, locale)],
      [e.return, formatDateTime(booking.ends_at, locale)],
    ],
  };
  const access: Block = { p: e.accessNote };
  const str = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : '');
  const done = (subject: string, blocks: Block[]) => ({ subject, ...layout(company, blocks, footer) });

  switch (template) {
    case 'payment_confirmed': {
      const deadline = new Date(new Date(booking.starts_at).getTime() - settings.verification_deadline_hours * 3600_000);
      const blocks: Block[] = [
        greeting,
        { p: fmt(e.paymentConfirmedBody, { amount: formatRM(booking.rental_total_sen) }) },
        summary,
        { p: fmt(e.paymentConfirmedNext, { deadline: formatDateTime(deadline, locale) }) },
      ];
      if (booking.deposit_sen > 0) blocks.push({ p: fmt(e.depositReminder, { amount: formatRM(booking.deposit_sen) }) });
      blocks.push({ button: [e.openDashboard, bookingUrl] }, access);
      return done(fmt(e.paymentConfirmedSubject, { reference }), blocks);
    }
    case 'payment_attention':
      return done(fmt(e.paymentAttentionSubject, { reference }), [greeting, { p: e.paymentAttentionBody }, summary]);
    case 'correction_requested':
      return done(fmt(e.correctionSubject, { reference }), [
        greeting,
        { p: fmt(e.correctionBody, { driver: str('driver') }) },
        { quote: str('reason') },
        { button: [e.correctionCta, bookingUrl] },
        access,
      ]);
    case 'agreement_ready':
      return done(fmt(e.agreementReadySubject, { reference }), [
        greeting,
        { p: e.agreementReadyBody },
        summary,
        { button: [e.agreementCta, `${bookingUrl}/agreement`] },
        access,
      ]);
    case 'ready_for_pickup':
      return done(fmt(e.readySubject, { reference }), [greeting, { p: e.readyBody }, summary, { button: [e.openDashboard, bookingUrl] }, access]);
    case 'request_outcome': {
      const approved = str('status') === 'approved';
      const body = !approved ? e.requestDeclined : str('kind') === 'cancellation' ? e.requestApprovedCancellation : e.requestApprovedDateChange;
      const blocks: Block[] = [greeting, { p: body }, summary];
      if (str('response')) blocks.push({ p: e.ownerNote }, { quote: str('response') });
      blocks.push({ button: [e.openDashboard, bookingUrl] });
      return done(fmt(e.requestOutcomeSubject, { reference }), blocks);
    }
    case 'booking_cancelled': {
      const blocks: Block[] = [greeting, { p: e.cancelledBody }, summary];
      if (str('reason')) blocks.push({ p: e.ownerNote }, { quote: str('reason') });
      blocks.push({ button: [e.openDashboard, bookingUrl] });
      return done(fmt(e.cancelledSubject, { reference }), blocks);
    }
    case 'refund_issued': {
      const amount = typeof data.amount_sen === 'number' ? formatRM(data.amount_sen) : '';
      const blocks: Block[] = [greeting, { p: fmt(e.refundBody, { amount }) }];
      if (str('reason')) blocks.push({ p: e.refundReason }, { quote: str('reason') });
      blocks.push({ rows: [[e.reference, reference]] }, { button: [e.openDashboard, bookingUrl] });
      return done(fmt(e.refundSubject, { reference }), blocks);
    }
    // Operator alerts: short, bilingual in one message, link to the admin booking page.
    case 'admin_booking_paid':
      return done(`Tempahan baharu dibayar / New paid booking · ${reference}`, [
        { p: `${booking.customer_name} telah membayar ${formatRM(booking.rental_total_sen)}. / ${booking.customer_name} paid ${formatRM(booking.rental_total_sen)}.` },
        summary,
        { button: ['Buka tempahan / Open booking', adminUrl] },
      ]);
    case 'admin_documents_review':
      return done(`Dokumen untuk disemak / Documents to review · ${reference}`, [
        { p: `Pemandu ${str('driver')} menunggu semakan. / Driver ${str('driver')} is awaiting review.` },
        summary,
        { button: ['Semak sekarang / Review now', adminUrl] },
      ]);
    case 'admin_payment_attention':
      return done(`PERHATIAN bayaran / Payment needs ATTENTION · ${reference}`, [
        {
          p: 'Bayaran diterima tetapi tempahan tidak dapat disahkan. Semak dan buat bayaran balik jika perlu. / A payment was received but the booking could not be confirmed. Review it and refund if needed.',
        },
        { rows: [['Sebab / Reason', str('reason')]] },
        summary,
        { button: ['Buka tempahan / Open booking', adminUrl] },
      ]);
    case 'admin_request_received':
      return done(`Permintaan pelanggan / Customer request · ${reference}`, [
        { p: `Permintaan baharu: ${str('kind')}. / New request: ${str('kind')}.` },
        summary,
        { button: ['Buka tempahan / Open booking', adminUrl] },
      ]);
    case 'admin_agreement_signed':
      return done(`Perjanjian ditandatangani / Agreement signed · ${reference}`, [
        { p: 'Tempahan ini sedia untuk diambil. / This booking is ready for pickup.' },
        summary,
        { button: ['Buka tempahan / Open booking', adminUrl] },
      ]);
  }
}
