import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { computeBookingState, driverDetailsComplete, missingDocuments } from '@/lib/booking-state';
import { renderEmail, type EmailTemplate } from '@/lib/email/templates';
import { fmt } from '@/lib/i18n/config';
import { en } from '@/lib/i18n/en';
import { ms } from '@/lib/i18n/ms';
import { formatRM, parseRM } from '@/lib/money';
import { renderAgreementPdf } from '@/lib/pdf';
import { sniffFile } from '@/lib/storage';
import { formatDateTime, klDateKey, parseKlLocal, rentalDays, toKlLocal } from '@/lib/time';
import { parseRange, type Booking, type DocumentRow, type Driver, type Settings } from '@/lib/types';

function shape(value: unknown, path = ''): string[] {
  if (typeof value === 'string') return [path];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => shape(child, path ? `${path}.${key}` : key));
}
function leaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Object.values(value as Record<string, unknown>).flatMap(leaves);
}
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  it('has the same keys in Bahasa Melayu and English', () => {
    expect(shape(en)).toEqual(shape(ms));
  });

  it('has no empty strings and matching placeholders', () => {
    const bm = leaves(ms);
    const eng = leaves(en);
    const keys = shape(ms);
    bm.forEach((text, i) => {
      expect(text.trim(), keys[i]).not.toBe('');
      expect(eng[i].trim(), keys[i]).not.toBe('');
      expect(placeholders(eng[i]), keys[i]).toEqual(placeholders(text));
    });
  });

  it('uses the agreed launch copy', () => {
    expect(`${ms.home.heroLine1} ${ms.home.heroLine2}`).toBe('Nak ke mana kali ni?');
    expect(`${en.home.heroLine1} ${en.home.heroLine2}`).toBe('Where to this time?');
    expect(ms.home.heroBody).toBe('Balik kampung atau jalan-jalan dengan keluarga? Ambil kereta di Bangi, jom gerak.');
    expect([ms.home.checkDates, en.home.checkDates]).toEqual(['Semak tarikh', 'Check dates']);
    expect([ms.nav.myBookings, en.nav.myBookings]).toEqual(['Tempahan saya', 'My bookings']);
    expect([ms.home.planned, en.home.planned]).toEqual(['Dalam perancangan', 'Planned addition']);
  });

  it('fills placeholders', () => {
    expect(fmt('Sewa {days} hari × {rate}', { days: 2, rate: 'RM350' })).toBe('Sewa 2 hari × RM350');
  });
});

describe('time and money', () => {
  it('treats datetime-local values as Kuala Lumpur time', () => {
    const date = parseKlLocal('2031-01-03T10:00');
    expect(date?.toISOString()).toBe('2031-01-03T02:00:00.000Z');
    expect(toKlLocal(date!)).toBe('2031-01-03T10:00');
    expect(klDateKey('2031-01-03T17:30:00Z')).toBe('2031-01-04');
    expect(parseKlLocal('not-a-date')).toBeNull();
    expect(formatDateTime(date!, 'en')).toMatch(/3 Jan 2031/);
  });

  it('rounds a partial day up (Fri 10am to Sun 10am = 2, Sun 11am = 3)', () => {
    const fri = parseKlLocal('2031-01-03T10:00')!;
    expect(rentalDays(fri, parseKlLocal('2031-01-05T10:00')!)).toBe(2);
    expect(rentalDays(fri, parseKlLocal('2031-01-05T11:00')!)).toBe(3);
    expect(rentalDays(fri, parseKlLocal('2031-01-03T12:00')!)).toBe(1);
  });

  it('formats and parses ringgit as integer sen', () => {
    expect(formatRM(35000)).toBe('RM350');
    expect(formatRM(105050)).toBe('RM1,050.50');
    expect(parseRM('350')).toBe(35000);
    expect(parseRM('RM 1,050.5')).toBe(105050);
    expect(parseRM('12.345')).toBeNull();
    expect(parseRM('-5')).toBeNull();
  });

  it('parses Postgres ranges', () => {
    const { start, end } = parseRange('["2031-01-03 02:00:00+00","2031-01-05 04:00:00+00")');
    expect(start.toISOString()).toBe('2031-01-03T02:00:00.000Z');
    expect(end.toISOString()).toBe('2031-01-05T04:00:00.000Z');
  });
});

const booking = (over: Partial<Booking> = {}): Booking => ({
  id: 'b1',
  reference: 'BCR-TEST22',
  renter_id: 'u1',
  customer_name: 'Aina Binti Ali',
  customer_email: 'aina@example.test',
  customer_phone: '0123456789',
  locale: 'ms',
  source: 'online',
  model_id: 'm1',
  vehicle_id: 'v1',
  starts_at: '2031-01-03T02:00:00Z',
  ends_at: '2031-01-05T02:00:00Z',
  status: 'confirmed',
  payment_status: 'paid',
  rental_status: 'not_started',
  deposit_status: 'due',
  attention_reason: null,
  days: 2,
  daily_rate_sen: 35000,
  rental_total_sen: 70000,
  deposit_sen: 50000,
  quote: {},
  refunded_sen: 0,
  details_version: 1,
  hold_expires_at: null,
  paid_at: '2030-12-20T02:00:00Z',
  cancelled_at: null,
  cancellation_reason: null,
  created_at: '2030-12-20T02:00:00Z',
  updated_at: '2030-12-20T02:00:00Z',
  ...over,
});
const driver = (over: Partial<Driver> = {}): Driver => ({
  id: 'd1',
  booking_id: 'b1',
  is_primary: true,
  full_name: 'Aina Binti Ali',
  id_type: 'mykad',
  id_number: '900101-10-1234',
  date_of_birth: '1990-01-01',
  phone: '0123456789',
  address: '1 Jalan Contoh, Bangi',
  licence_number: 'L1234567',
  licence_expiry: '2032-01-01',
  status: 'draft',
  correction_reason: null,
  submitted_at: null,
  reviewed_at: null,
  created_at: '2030-12-20T02:00:00Z',
  ...over,
});
const doc = (kind: 'identity' | 'licence', over: Partial<DocumentRow> = {}): DocumentRow => ({
  id: `doc-${kind}`,
  booking_id: 'b1',
  driver_id: 'd1',
  kind,
  storage_path: `b1/d1/${kind}.jpg`,
  mime_type: 'image/jpeg',
  size_bytes: 1000,
  status: 'active',
  created_at: '2030-12-20T02:00:00Z',
  ...over,
});
const bothDocs = [doc('identity'), doc('licence')];

describe('next action for the renter', () => {
  const next = (b: Booking, drivers: Driver[], documents: DocumentRow[], agreement: { status: 'pending_signature' | 'signed' } | null = null) =>
    computeBookingState({ booking: b, drivers, documents, agreement });

  it('walks through details, documents, review, signature and pickup in order', () => {
    expect(next(booking(), [driver({ id_number: '' })], []).next).toBe('details');
    expect(next(booking(), [driver()], [doc('identity')]).next).toBe('upload');
    expect(next(booking(), [driver({ status: 'submitted' })], bothDocs).next).toBe('review');
    expect(next(booking(), [driver({ status: 'correction_requested', correction_reason: 'Blurry' })], bothDocs)).toMatchObject({ next: 'correct', driverId: 'd1' });
    expect(next(booking(), [driver({ status: 'approved' })], bothDocs).next).toBe('agreement_pending');
    expect(next(booking(), [driver({ status: 'approved' })], bothDocs, { status: 'pending_signature' }).next).toBe('sign');
    expect(next(booking(), [driver({ status: 'approved' })], bothDocs, { status: 'signed' })).toMatchObject({ next: 'ready', readyForPickup: true });
  });

  it('is only ready for pickup when paid, approved and signed', () => {
    const approved = [driver({ status: 'approved' }), driver({ id: 'd2', is_primary: false, status: 'submitted' })];
    expect(next(booking(), approved, bothDocs, { status: 'signed' }).readyForPickup).toBe(false);
    expect(next(booking({ payment_status: 'needs_attention' }), [driver({ status: 'approved' })], bothDocs, { status: 'signed' })).toMatchObject({
      next: 'payment_attention',
      readyForPickup: false,
    });
    expect(next(booking({ status: 'cancelled' }), [driver({ status: 'approved' })], bothDocs, { status: 'signed' })).toMatchObject({ next: 'cancelled', readyForPickup: false });
  });

  it('reports rental progress and missing pieces', () => {
    expect(next(booking({ rental_status: 'picked_up' }), [driver({ status: 'approved' })], bothDocs, { status: 'signed' }).next).toBe('active');
    expect(next(booking({ rental_status: 'returned' }), [driver({ status: 'approved' })], bothDocs, { status: 'signed' }).next).toBe('completed');
    expect(driverDetailsComplete(driver({ address: '' }))).toBe(false);
    expect(driverDetailsComplete(driver({ is_primary: false, address: '' }))).toBe(true);
    expect(missingDocuments('d1', [doc('identity'), doc('licence', { status: 'superseded' })])).toEqual(['licence']);
  });
});

const settings = {
  display_name: 'Bangi Car Rental',
  company_name: 'Contoh Enterprise',
  verification_deadline_hours: 24,
} as Settings;

describe('emails', () => {
  const templates: EmailTemplate[] = [
    'payment_confirmed', 'payment_attention', 'correction_requested', 'agreement_ready', 'ready_for_pickup', 'request_outcome',
    'booking_cancelled', 'refund_issued', 'admin_booking_paid', 'admin_documents_review', 'admin_payment_attention',
    'admin_request_received', 'admin_agreement_signed',
  ];
  const data = { driver: 'Aina', reason: 'Gambar lesen kabur', kind: 'cancellation', status: 'approved', response: 'OK', amount_sen: 20000 };

  it.each(['ms', 'en'] as const)('renders every template in %s with the reference and no unfilled placeholders', (locale) => {
    for (const template of templates) {
      const email = renderEmail(template, { booking: booking(), modelName: 'Nissan Serena', settings, locale, data, appUrl: 'https://bangicarrental.my' });
      expect(email.subject, template).toContain('BCR-TEST22');
      expect(email.html + email.text, template).not.toMatch(/\{\w+\}|undefined/);
      expect(email.text.length, template).toBeGreaterThan(40);
    }
  });

  it('links back to the dashboard, never attaches documents, and escapes input', () => {
    const email = renderEmail('correction_requested', {
      booking: booking(), modelName: 'Nissan Serena', settings, locale: 'en',
      data: { driver: 'Aina', reason: '<script>alert(1)</script>' }, appUrl: 'https://bangicarrental.my',
    });
    expect(email.html).toContain('https://bangicarrental.my/bookings/b1');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('uses the renter language', () => {
    const args = { booking: booking(), modelName: 'Nissan Serena', settings, data: {}, appUrl: 'https://x.test' };
    expect(renderEmail('payment_confirmed', { ...args, locale: 'ms' }).subject).toContain('Tempahan disahkan');
    expect(renderEmail('payment_confirmed', { ...args, locale: 'en' }).subject).toContain('Booking confirmed');
  });
});

describe('uploads and PDF', () => {
  it('identifies files from their bytes, not their names', () => {
    expect(sniffFile(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))?.mime).toBe('image/jpeg');
    expect(sniffFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))?.mime).toBe('image/png');
    expect(sniffFile(new TextEncoder().encode('%PDF-1.7 ....'))?.mime).toBe('application/pdf');
    expect(sniffFile(new TextEncoder().encode('%PDF-1.7 ....'), false)).toBeNull();
    expect(sniffFile(new TextEncoder().encode('<html><script>'))).toBeNull();
    expect(sniffFile(new TextEncoder().encode('MZ executable ..'))).toBeNull();
  });

  it('renders a multi-page signed agreement PDF', async () => {
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
      (c) => c.charCodeAt(0),
    );
    const body = Array.from({ length: 40 }, (_, i) => `## ${i + 1}. Fasal\nPenyewa bersetuju dengan terma “sewa” ini – termasuk deposit RM500.\n- butiran satu\n- butiran dua`).join('\n\n');
    const bytes = await renderAgreementPdf({
      title: 'Perjanjian Sewa Kenderaan',
      subtitle: 'BCR-TEST22 · Versi 1',
      body,
      signature: { heading: 'Tandatangan Penyewa', image: png, rows: [['Nama', 'Aina Binti Ali'], ['Emel', 'aina@example.test']], footer: 'Ditandatangani secara elektronik.' },
    });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });
});
