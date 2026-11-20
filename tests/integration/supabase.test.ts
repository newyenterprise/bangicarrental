import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Runs against a REAL Supabase project (the dedicated Bangi project while it
 * still only holds test data). It covers what the embedded database cannot:
 * true concurrency over separate connections, real Auth sessions and Storage.
 *
 *   RUN_SUPABASE_TESTS=1 pnpm test:integration
 *
 * Uses SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from
 * .env.local. All records use *@example.test and are removed afterwards.
 */
config({ path: '.env.local', quiet: true });

const url = process.env.SUPABASE_URL ?? '';
const anonKey = process.env.SUPABASE_ANON_KEY ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const enabled = process.env.RUN_SUPABASE_TESTS === '1' && !!url && !!anonKey && !!serviceKey;

const run = Date.now().toString(36);
const email = (name: string) => `it-${run}-${name}@example.test`;
// Far in the future (Kuala Lumpur time) so it never collides with real availability.
const at = (dayOffset: number, hour = 10) => new Date(Date.UTC(2032, 5, 1, hour - 8) + dayOffset * 86_400_000).toISOString();

describe.skipIf(!enabled)('real Supabase project', () => {
  let admin: SupabaseClient;
  let serena: string;
  let vellfire: string;
  let unit: string;
  const bookingIds: string[] = [];
  const userIds: string[] = [];
  const blockIds: string[] = [];
  const objectPaths: string[] = [];

  const anon = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const hold = (modelId: string, start: string, end: string, who: string) =>
    admin.rpc('create_booking_hold', {
      p_model_id: modelId, p_starts_at: start, p_ends_at: end,
      p_name: 'Integration Test', p_email: email(who), p_phone: '0123456789', p_locale: 'ms',
    });

  /** Signs a fictional renter in exactly as the site does: an emailed one-time code. */
  async function signIn(who: string): Promise<{ client: SupabaseClient; id: string }> {
    const address = email(who);
    const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: address });
    if (error || !link.properties?.email_otp) throw new Error(`generateLink failed: ${error?.message}`);
    const client = anon();
    const { data, error: verifyError } = await client.auth.verifyOtp({ email: address, token: link.properties.email_otp, type: 'email' });
    if (verifyError || !data.user) throw new Error(`verifyOtp failed: ${verifyError?.message}`);
    userIds.push(data.user.id);
    return { client, id: data.user.id };
  }

  beforeAll(async () => {
    admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: models, error } = await admin.from('vehicle_models').select('id, slug');
    if (error) throw new Error(`Is the schema migrated? ${error.message}`);
    serena = models!.find((m) => m.slug === 'nissan-serena')!.id;
    vellfire = models!.find((m) => m.slug === 'toyota-vellfire')!.id;
    const { data: units } = await admin.from('vehicles').select('id').eq('model_id', serena).eq('active', true);
    expect(units, 'this test expects exactly one active Serena').toHaveLength(1);
    unit = units![0].id;
  });

  afterAll(async () => {
    if (!admin) return;
    if (blockIds.length) await admin.from('occupancy').delete().in('id', blockIds);
    for (const bucket of ['renter-documents', 'agreements']) {
      const paths = objectPaths.filter((p) => p.startsWith(`${bucket}:`)).map((p) => p.slice(bucket.length + 1));
      if (paths.length) await admin.storage.from(bucket).remove(paths);
    }
    await admin.from('bookings').delete().like('customer_email', `it-${run}-%@example.test`);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  it('lets exactly one of several concurrent customers hold the last Serena', async () => {
    const results = await Promise.all(['c1', 'c2', 'c3', 'c4', 'c5'].map((who) => hold(serena, at(0), at(2), who)));
    const winners = results.filter((r) => !r.error);
    const losers = results.filter((r) => r.error);
    winners.forEach((w) => bookingIds.push(w.data.booking_id));
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(4);
    for (const loser of losers) expect(loser.error!.message).toContain('UNAVAILABLE');
    const { count } = await admin.from('occupancy').select('id', { count: 'exact', head: true }).eq('vehicle_id', unit).overlaps('period', `[${at(0)},${at(2)})`);
    expect(count).toBe(1);
  });

  it('rejects an overlapping admin block, and a block racing a customer hold', async () => {
    const overlapping = await admin.from('occupancy').insert({ vehicle_id: unit, period: `[${at(1)},${at(1, 15)})`, kind: 'block', reason: 'maintenance' }).select('id');
    expect(overlapping.error?.code).toBe('23P01');

    const [block, customer] = await Promise.all([
      admin.from('occupancy').insert({ vehicle_id: unit, period: `[${at(10)},${at(12)})`, kind: 'block', reason: 'personal' }).select('id'),
      hold(serena, at(10), at(12), 'race'),
    ]);
    if (block.data?.[0]) blockIds.push(block.data[0].id);
    if (customer.data) bookingIds.push(customer.data.booking_id);
    expect([!block.error, !customer.error].filter(Boolean)).toHaveLength(1);
  });

  it('refuses preview models and anonymous callers at the API', async () => {
    const preview = await hold(vellfire, at(20), at(21), 'preview');
    expect(preview.error?.message).toContain('MODEL_NOT_BOOKABLE');
    const direct = await anon().rpc('create_booking_hold', {
      p_model_id: serena, p_starts_at: at(20), p_ends_at: at(21), p_name: 'x', p_email: email('anon'), p_phone: '0123456789', p_locale: 'ms',
    });
    expect(direct.error).not.toBeNull();
    const paid = await anon().rpc('record_payment_success', { p_booking_id: bookingIds[0], p_checkout_session_id: 'x', p_payment_intent_id: 'y', p_amount_sen: 1 });
    expect(paid.error).not.toBeNull();
    const catalogue = await anon().from('vehicle_models').select('slug');
    expect(catalogue.data?.map((m) => m.slug).sort()).toEqual(['nissan-serena', 'toyota-alphard', 'toyota-vellfire']);
    expect((await anon().from('bookings').select('id')).data ?? []).toHaveLength(0);
    expect((await anon().from('vehicles').select('id')).data ?? []).toHaveLength(0);
  });

  it('is idempotent for duplicate payment events: one paid booking, one confirmation email', async () => {
    const { data, error } = await hold(serena, at(30), at(31), 'paid');
    expect(error).toBeNull();
    bookingIds.push(data.booking_id);
    const args = { p_booking_id: data.booking_id, p_checkout_session_id: `cs_test_it_${run}`, p_payment_intent_id: `pi_it_${run}`, p_amount_sen: 35000 };
    const outcomes = await Promise.all([admin.rpc('record_payment_success', args), admin.rpc('record_payment_success', args), admin.rpc('record_payment_success', args)]);
    expect(outcomes.map((o) => o.data).sort()).toEqual(['already_paid', 'already_paid', 'paid']);
    const emails = await admin.from('email_outbox').select('id', { count: 'exact', head: true }).eq('booking_id', data.booking_id).eq('template', 'payment_confirmed');
    expect(emails.count).toBe(1);
    const payments = await admin.from('payments').select('id', { count: 'exact', head: true }).eq('booking_id', data.booking_id);
    expect(payments.count).toBe(1);
  });

  it('keeps two unrelated renters apart: bookings, documents, agreements and files', async () => {
    const make = async (who: string, day: number) => {
      const { data, error } = await hold(serena, at(day), at(day + 1), who);
      expect(error).toBeNull();
      bookingIds.push(data.booking_id);
      await admin.rpc('record_payment_success', { p_booking_id: data.booking_id, p_checkout_session_id: `cs_test_${who}_${run}`, p_payment_intent_id: `pi_${who}_${run}`, p_amount_sen: 35000 });
      return data.booking_id as string;
    };
    const bookingA = await make('renter-a', 40);
    const bookingB = await make('renter-b', 43);
    const a = await signIn('renter-a');
    const b = await signIn('renter-b');
    await admin.from('bookings').update({ renter_id: a.id }).eq('id', bookingA);
    await admin.from('bookings').update({ renter_id: b.id }).eq('id', bookingB);

    const { data: template } = await admin.from('agreement_templates').select('id').eq('locale', 'ms').limit(1).single();
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
    const pdf = new TextEncoder().encode('%PDF-1.4\n% integration test\n');
    for (const id of [bookingA, bookingB]) {
      const { data: driver } = await admin.from('drivers').select('id').eq('booking_id', id).single();
      const docPath = `${id}/${driver!.id}/licence-${run}.jpg`;
      const pdfPath = `${id}/agreement-${run}.pdf`;
      expect((await admin.storage.from('renter-documents').upload(docPath, jpeg, { contentType: 'image/jpeg' })).error).toBeNull();
      expect((await admin.storage.from('agreements').upload(pdfPath, pdf, { contentType: 'application/pdf' })).error).toBeNull();
      objectPaths.push(`renter-documents:${docPath}`, `agreements:${pdfPath}`);
      await admin.from('documents').insert({ booking_id: id, driver_id: driver!.id, kind: 'licence', storage_path: docPath, mime_type: 'image/jpeg', size_bytes: jpeg.length });
      await admin.from('agreements').insert({ booking_id: id, version: 1, template_id: template!.id, locale: 'ms', title: 't', rendered_body: 'b', details_hash: 'h', status: 'signed', pdf_path: pdfPath });
    }

    for (const table of ['bookings', 'drivers', 'documents', 'agreements', 'payments'] as const) {
      const column = table === 'bookings' ? 'id' : 'booking_id';
      const mine = await a.client.from(table).select(column);
      expect(mine.error, table).toBeNull();
      expect(mine.data!.map((r) => (r as Record<string, string>)[column]), table).toEqual([bookingA]);
      const theirs = await a.client.from(table).select(column).eq(column, bookingB);
      expect(theirs.data ?? [], table).toHaveLength(0);
    }

    // Direct storage access is closed to renters, even for their own files: only short-lived server links work.
    const theirDoc = objectPaths.find((p) => p.startsWith(`renter-documents:${bookingB}`))!.split(':')[1];
    const theirPdf = objectPaths.find((p) => p.startsWith(`agreements:${bookingB}`))!.split(':')[1];
    expect((await a.client.storage.from('renter-documents').download(theirDoc)).error).not.toBeNull();
    expect((await a.client.storage.from('agreements').download(theirPdf)).error).not.toBeNull();
    expect((await a.client.storage.from('renter-documents').createSignedUrl(theirDoc, 60)).error).not.toBeNull();
    expect((await a.client.storage.from('renter-documents').list(bookingB)).data ?? []).toHaveLength(0);
    expect((await anon().storage.from('agreements').download(theirPdf)).error).not.toBeNull();

    // Renters cannot change roles, prices, payment state or decisions.
    const attempts = await Promise.all([
      a.client.from('profiles').update({ role: 'admin' }).eq('id', a.id).select('id'),
      a.client.from('bookings').update({ payment_status: 'refunded', rental_total_sen: 1 }).eq('id', bookingA).select('id'),
      a.client.from('drivers').update({ status: 'approved' }).eq('booking_id', bookingA).select('id'),
      a.client.from('vehicle_models').update({ daily_rate_sen: 1 }).eq('id', serena).select('id'),
    ]);
    for (const attempt of attempts) expect(attempt.data ?? []).toHaveLength(0);
    const { data: profile } = await admin.from('profiles').select('role').eq('id', a.id).single();
    expect(profile!.role).toBe('renter');
    const { data: still } = await admin.from('bookings').select('payment_status, rental_total_sen').eq('id', bookingA).single();
    expect(still).toEqual({ payment_status: 'paid', rental_total_sen: 35000 });

    // The service role (the server, after its own ownership check) can issue a short-lived link.
    const signed = await admin.storage.from('agreements').createSignedUrl(theirPdf, 60);
    expect(signed.error).toBeNull();
    expect((await fetch(signed.data!.signedUrl)).status).toBe(200);
  });
});
