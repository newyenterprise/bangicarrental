import { createHash } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expectNoHorizontalOverflow, serviceClient, setLanguage, signIn, testEmail } from './helpers';

/**
 * The whole post-payment journey, through the real pages:
 * renter submits a licence -> admin requests a correction -> renter resubmits
 * -> admin approves -> renter signs -> both download the same signed PDF ->
 * admin records deposit, pickup and return.
 *
 * The rental payment itself is simulated by calling the same database function
 * the Stripe webhook calls. All records use *@example.test and are removed afterwards.
 */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
const photo = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: JPEG });
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test.describe('renter and admin journey', () => {
  test.describe.configure({ mode: 'serial' });

  let db: SupabaseClient;
  let bookingId = '';
  let reference = '';
  let renterEmail = '';
  let adminEmail = '';
  let strangerEmail = '';
  const userIds: string[] = [];
  let publishedForTest: string[] = [];

  async function newPage(browser: Browser, email: string): Promise<Page> {
    const context = await browser.newContext();
    const page = await context.newPage();
    userIds.push(await signIn(page, email));
    return page;
  }

  test.beforeAll(async ({}, testInfo) => {
    db = serviceClient();
    const tag = testInfo.project.name;
    renterEmail = testEmail(`renter-${tag}`);
    adminEmail = testEmail(`admin-${tag}`);
    strangerEmail = testEmail(`stranger-${tag}`);

    // Signing needs a published agreement. If the operator has not published one yet,
    // publish the drafts for the duration of this test only and put them back afterwards.
    const { data: templates } = await db.from('agreement_templates').select('id, locale, status');
    if (!templates?.some((t) => t.status === 'published')) {
      const drafts = (templates ?? []).filter((t) => t.status === 'draft');
      publishedForTest = drafts.map((t) => t.id);
      await db.from('agreement_templates').update({ status: 'published' }).in('id', publishedForTest);
    }

    const { data: model } = await db.from('vehicle_models').select('id').eq('slug', 'nissan-serena').single();
    const month = tag === 'phone' ? 3 : 5; // keep the two projects on different dates
    const start = new Date(Date.UTC(2033, month, 1, 2)).toISOString();
    const end = new Date(Date.UTC(2033, month, 3, 2)).toISOString();
    const { data: hold, error } = await db.rpc('create_booking_hold', {
      p_model_id: model!.id, p_starts_at: start, p_ends_at: end,
      p_name: 'Aina Binti Ali', p_email: renterEmail, p_phone: '012-345 6789', p_locale: 'ms',
    });
    if (error) throw new Error(`Could not create the test booking: ${error.message}`);
    bookingId = hold.booking_id;
    reference = hold.reference;
    const paid = await db.rpc('record_payment_success', {
      p_booking_id: bookingId, p_checkout_session_id: `cs_test_e2e_${bookingId}`, p_payment_intent_id: `pi_e2e_${bookingId}`, p_amount_sen: 70000,
    });
    expect(paid.data).toBe('paid');
  });

  test.afterAll(async () => {
    if (!db) return;
    if (bookingId) {
      for (const bucket of ['renter-documents', 'agreements', 'handover-photos']) {
        const walk = async (prefix: string) => {
          const { data } = await db.storage.from(bucket).list(prefix, { limit: 100 });
          for (const entry of data ?? []) {
            if (entry.id === null) await walk(`${prefix}/${entry.name}`);
            else await db.storage.from(bucket).remove([`${prefix}/${entry.name}`]);
          }
        };
        await walk(bookingId);
      }
      await db.from('bookings').delete().eq('id', bookingId);
    }
    if (publishedForTest.length) await db.from('agreement_templates').update({ status: 'draft', published_at: null, published_by: null }).in('id', publishedForTest);
    for (const id of new Set(userIds)) await db.auth.admin.deleteUser(id);
  });

  test('licence, correction, approval, signature, shared PDF, pickup and return', async ({ browser }) => {
    test.setTimeout(240_000);
    const bookingUrl = `/bookings/${bookingId}`;

    // --- Renter: sees the booking, completes details, uploads documents, submits ---
    const renter = await newPage(browser, renterEmail);
    await renter.goto('/bookings');
    await expect(renter.getByText(reference)).toBeVisible();
    await renter.goto(bookingUrl);
    await expect(renter.getByTestId('reference')).toHaveText(reference);
    await expect(renter.getByTestId('next-details')).toBeVisible();
    await expect(renter.getByTestId('deposit-amount')).toHaveText('RM500');
    await expectNoHorizontalOverflow(renter, 'renter booking (ms)');

    const { data: driver } = await db.from('drivers').select('id').eq('booking_id', bookingId).single();
    const driverUrl = `${bookingUrl}/drivers/${driver!.id}`;
    await renter.goto(driverUrl);
    await renter.locator('#id_number').fill('900101-10-1234');
    await renter.locator('#date_of_birth').fill('1990-01-01');
    await renter.locator('#address').fill('1 Jalan Contoh, 43650 Bandar Baru Bangi');
    await renter.locator('#licence_number').fill('L1234567');
    await renter.locator('#licence_expiry').fill('2035-01-01');
    await renter.getByRole('button', { name: 'Simpan butiran' }).click();
    await expect(renter.getByText('Butiran disimpan.')).toBeVisible();

    for (const kind of ['identity', 'licence'] as const) {
      const box = renter.getByTestId(`doc-${kind}`);
      await box.locator('input[type="file"]').setInputFiles(photo(`${kind}.jpg`));
      await expect(box.getByText('Dimuat naik').first()).toBeVisible({ timeout: 30_000 });
    }
    await expectNoHorizontalOverflow(renter, 'driver page (ms)');
    await renter.reload();
    await renter.getByRole('button', { name: 'Hantar untuk semakan' }).click();
    await expect.poll(async () => (await db.from('drivers').select('status').eq('id', driver!.id).single()).data?.status).toBe('submitted');
    await renter.goto(bookingUrl);
    await expect(renter.getByTestId('next-review')).toBeVisible();

    // --- Admin: asks for a correction with a reason the renter can see ---
    const admin = await newPage(browser, adminEmail);
    await db.from('profiles').update({ role: 'admin' }).eq('id', userIds[userIds.length - 1]);
    const adminUrl = `/admin/bookings/${bookingId}`;
    await admin.goto('/admin');
    await expect(admin).toHaveURL(/\/admin$/);
    await expectNoHorizontalOverflow(admin, 'admin today (ms)');
    await admin.goto(adminUrl);
    const verification = admin.locator('#verification');
    await expect(verification.getByText('Aina Binti Ali').first()).toBeVisible();
    await verification.getByText('Minta pembetulan').click();
    await verification.getByLabel(/Apa yang perlu dibetulkan/).fill('Gambar lesen kabur. Sila ambil semula.');
    await verification.getByRole('button', { name: 'Hantar permintaan' }).click();
    await expect.poll(async () => (await db.from('drivers').select('status').eq('id', driver!.id).single()).data?.status).toBe('correction_requested');

    // --- Renter: sees exactly what to fix, replaces the licence, resubmits ---
    await renter.goto(bookingUrl);
    await expect(renter.getByTestId('next-correct')).toBeVisible();
    await renter.goto(driverUrl);
    await expect(renter.getByTestId('correction-reason')).toContainText('Gambar lesen kabur. Sila ambil semula.');
    const licence = renter.getByTestId('doc-licence');
    await licence.locator('input[type="file"]').setInputFiles(photo('licence-retake.jpg'));
    await expect.poll(async () => (await db.from('documents').select('id', { count: 'exact', head: true }).eq('driver_id', driver!.id).eq('kind', 'licence').eq('status', 'superseded')).count).toBe(1);
    await renter.reload();
    await renter.getByRole('button', { name: 'Hantar untuk semakan' }).click();
    await expect.poll(async () => (await db.from('drivers').select('status').eq('id', driver!.id).single()).data?.status).toBe('submitted');

    // --- Admin: opens a document privately, then approves ---
    await admin.goto(adminUrl);
    const { data: docs } = await db.from('documents').select('id').eq('driver_id', driver!.id).eq('status', 'active');
    const adminDoc = await admin.request.get(`/api/documents/${docs![0].id}`);
    expect(adminDoc.status()).toBe(200);
    await verification.getByRole('button', { name: 'Luluskan pemandu' }).click();
    await admin.getByRole('button', { name: 'Ya, teruskan' }).click();
    await expect.poll(async () => (await db.from('drivers').select('status').eq('id', driver!.id).single()).data?.status).toBe('approved');
    await expect.poll(async () => (await db.from('agreements').select('status').eq('booking_id', bookingId).maybeSingle()).data?.status).toBe('pending_signature');

    // Recording pickup is refused until the agreement is signed.
    await admin.goto(adminUrl);
    await expect(admin.locator('#handover').getByRole('button', { name: 'Rekod ambil kereta' })).toHaveCount(0);

    // --- Renter: reads the full agreement, accepts and signs ---
    await renter.goto(bookingUrl);
    await expect(renter.getByTestId('next-sign')).toBeVisible();
    await renter.goto(`${bookingUrl}/agreement`);
    const body = renter.getByTestId('agreement-body');
    await expect(body).toContainText(reference);
    await expect(body).toContainText('Aina Binti Ali');
    await expect(body).toContainText('RM700');
    await expect(body).toContainText('RM500');
    await expectNoHorizontalOverflow(renter, 'agreement (ms)');
    await setLanguage(renter, 'en');
    await expectNoHorizontalOverflow(renter, 'agreement (en)');
    await setLanguage(renter, 'ms');

    await renter.locator('input[name="accept"]').check();
    const pad = renter.getByTestId('signature-pad');
    await pad.scrollIntoViewIfNeeded();
    const rect = (await pad.boundingBox())!;
    await renter.mouse.move(rect.x + 20, rect.y + rect.height / 2);
    await renter.mouse.down();
    for (let i = 1; i <= 12; i += 1) await renter.mouse.move(rect.x + 20 + i * 12, rect.y + rect.height / 2 + (i % 2 ? -18 : 18), { steps: 3 });
    await renter.mouse.up();
    await renter.getByRole('button', { name: 'Tandatangan perjanjian' }).click();
    await expect(renter.getByTestId('agreement-signed')).toBeVisible({ timeout: 45_000 });

    const { data: agreement } = await db.from('agreements').select('id, status, signer_email, signed_at, pdf_path').eq('booking_id', bookingId).single();
    expect(agreement).toMatchObject({ status: 'signed', signer_email: renterEmail });
    expect(agreement!.signed_at).toBeTruthy();

    // --- The renter and the admin download the very same signed PDF ---
    const pdfUrl = `/api/agreements/${agreement!.id}/pdf`;
    const renterPdf = await renter.request.get(pdfUrl);
    const adminPdf = await admin.request.get(pdfUrl);
    expect(renterPdf.status()).toBe(200);
    expect(adminPdf.status()).toBe(200);
    const renterBytes = await renterPdf.body();
    expect(renterBytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(sha(await adminPdf.body())).toBe(sha(renterBytes));

    // --- An unrelated renter cannot see any of it ---
    const stranger = await newPage(browser, strangerEmail);
    expect((await stranger.goto(bookingUrl))?.status()).toBe(404);
    expect((await stranger.request.get(pdfUrl)).status()).toBe(404);
    expect((await stranger.request.get(`/api/documents/${docs![0].id}`)).status()).toBe(404);
    await stranger.goto('/bookings');
    await expect(stranger.getByText(reference)).toHaveCount(0);
    await stranger.goto('/admin');
    await expect(stranger).not.toHaveURL(/\/admin/);
    await stranger.context().close();

    // --- Renter: now ready, and the private pickup details appear ---
    await renter.goto(bookingUrl);
    await expect(renter.getByTestId('next-ready')).toBeVisible();

    // --- Admin: deposit collected, pickup, return, deposit returned ---
    await admin.goto(adminUrl);
    await expect(admin.locator('#status').getByText('Sedia untuk diambil')).toBeVisible();
    const deposit = admin.locator('#deposit');
    const recordDeposit = async (kind: string) => {
      await deposit.locator('summary').click();
      await deposit.getByLabel('Jenis').selectOption(kind);
      await deposit.getByLabel(/^Jumlah \(RM\)/).fill('500');
      await deposit.getByRole('button', { name: 'Semak dan rekod' }).click();
      await admin.getByRole('button', { name: 'Ya, teruskan' }).click();
    };
    await recordDeposit('collected');
    await expect.poll(async () => (await db.from('bookings').select('deposit_status').eq('id', bookingId).single()).data?.deposit_status).toBe('collected');

    await admin.goto(adminUrl);
    const handover = admin.locator('#handover');
    await handover.getByLabel('Odometer (km)').first().fill('45210');
    await handover.getByRole('button', { name: 'Rekod ambil kereta' }).click();
    await admin.getByRole('button', { name: 'Ya, teruskan' }).click();
    await expect.poll(async () => (await db.from('bookings').select('rental_status').eq('id', bookingId).single()).data?.rental_status).toBe('picked_up');

    await renter.goto(bookingUrl);
    await expect(renter.getByTestId('next-active')).toBeVisible();

    await admin.goto(adminUrl);
    await handover.getByRole('button', { name: 'Rekod pemulangan' }).scrollIntoViewIfNeeded();
    await handover.getByLabel('Odometer (km)').last().fill('45630');
    await handover.getByRole('button', { name: 'Rekod pemulangan' }).click();
    await admin.getByRole('button', { name: 'Ya, teruskan' }).click();
    await expect.poll(async () => (await db.from('bookings').select('rental_status').eq('id', bookingId).single()).data?.rental_status).toBe('returned');

    await admin.goto(adminUrl);
    await recordDeposit('returned');
    await expect.poll(async () => (await db.from('bookings').select('deposit_status').eq('id', bookingId).single()).data?.deposit_status).toBe('settled');
    await expectNoHorizontalOverflow(admin, 'admin booking (ms)');
    await setLanguage(admin, 'en');
    await expectNoHorizontalOverflow(admin, 'admin booking (en)');

    // --- The books: rental revenue and the deposit are separate, and every step names who did it ---
    const { data: final } = await db.from('bookings').select('payment_status, rental_status, deposit_status, rental_total_sen, refunded_sen').eq('id', bookingId).single();
    expect(final).toEqual({ payment_status: 'paid', rental_status: 'returned', deposit_status: 'settled', rental_total_sen: 70000, refunded_sen: 0 });
    const { data: payments } = await db.from('payments').select('amount_sen, status').eq('booking_id', bookingId);
    expect(payments).toEqual([{ amount_sen: 70000, status: 'succeeded' }]);
    const { data: ledger } = await db.from('deposit_transactions').select('kind, amount_sen, recorded_by').eq('booking_id', bookingId).order('created_at');
    expect(ledger!.map((l) => [l.kind, l.amount_sen])).toEqual([['collected', 50000], ['returned', 50000]]);
    const { data: handovers } = await db.from('handovers').select('kind, mileage_km, recorded_by').eq('booking_id', bookingId).order('recorded_at');
    expect(handovers!.map((h) => [h.kind, h.mileage_km])).toEqual([['pickup', 45210], ['return', 45630]]);
    const adminId = userIds[1];
    for (const row of [...ledger!, ...handovers!]) expect(row.recorded_by).toBe(adminId);
    const { data: auditRows } = await db.from('audit_log').select('action').eq('booking_id', bookingId);
    const actions = new Set(auditRows!.map((a) => a.action));
    for (const action of ['document.uploaded', 'driver.submitted', 'driver.correction_requested', 'driver.approved', 'agreement.generated', 'agreement.signed', 'document.viewed', 'agreement.downloaded', 'handover.pickup', 'handover.return', 'deposit.collected', 'deposit.returned']) {
      expect(actions, `audit entry ${action}`).toContain(action);
    }

    // --- Other admin screens and the finished renter view fit the screen in both languages ---
    for (const path of ['/admin', '/admin/bookings', '/admin/calendar', '/admin/review', '/admin/fleet', '/admin/agreement', '/admin/settings', '/admin/audit']) {
      await admin.goto(path);
      await expectNoHorizontalOverflow(admin, `${path} (en)`);
    }
    await setLanguage(admin, 'ms');
    for (const path of ['/admin/calendar', '/admin/fleet', '/admin/settings']) {
      await admin.goto(path);
      await expectNoHorizontalOverflow(admin, `${path} (ms)`);
    }
    await renter.goto(bookingUrl);
    await expect(renter.getByTestId('next-completed')).toBeVisible();
    await setLanguage(renter, 'en');
    await expectNoHorizontalOverflow(renter, 'renter booking (en)');
    await renter.goto('/bookings');
    await expectNoHorizontalOverflow(renter, 'my bookings (en)');
  });
});
