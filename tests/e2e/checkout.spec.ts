import { expect, test } from '@playwright/test';
import { klLocal, serviceClient, testEmail } from './helpers';

/**
 * A real Stripe TEST-MODE payment through hosted Checkout. Skipped unless
 * RUN_STRIPE_CHECKOUT=1, because it depends on Stripe's hosted page.
 *
 *   RUN_STRIPE_CHECKOUT=1 pnpm exec playwright test tests/e2e/checkout.spec.ts --project=desktop
 */
test.describe('stripe test checkout', () => {
  test.skip(process.env.RUN_STRIPE_CHECKOUT !== '1', 'set RUN_STRIPE_CHECKOUT=1 to run');
  const email = testEmail('checkout');

  test.afterAll(async () => {
    await serviceClient().from('bookings').delete().eq('customer_email', email);
  });

  test('pays with a test card and returns to a confirmed booking', async ({ page }) => {
    test.setTimeout(180_000);
    const db = serviceClient();
    // Far enough ahead to be free, different each run.
    const offset = 200 + (Math.floor(Date.now() / 60_000) % 150);
    await page.goto(`/book?model=nissan-serena&from=${klLocal(offset, 10)}&to=${klLocal(offset + 2, 10)}`);
    await expect(page.getByText('Mod ujian')).toBeVisible();
    await expect(page.getByTestId('pay-now')).toHaveText('RM700');
    await page.locator('#name').fill('Aina Binti Ali');
    await page.locator('#email').fill(email);
    await page.locator('#phone').fill('012-345 6789');
    await page.locator('input[name="agree"]').check();
    await page.getByRole('button', { name: /Teruskan ke bayaran/ }).click();

    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
    // The unit is held while the customer is on Stripe.
    const { data: pending } = await db.from('bookings').select('id, status, payment_status').eq('customer_email', email).single();
    expect(pending).toMatchObject({ status: 'pending_payment', payment_status: 'unpaid' });
    const { data: hold } = await db.from('occupancy').select('kind').eq('booking_id', pending!.id).single();
    expect(hold!.kind).toBe('hold');

    await expect(page.getByText(/RM\s?700|MYR\s?700/).first()).toBeVisible({ timeout: 30_000 });
    // Stripe renders parts of this page in frames and changes its markup over time,
    // so look for each control in every frame.
    const inAnyFrame = async (selectors: string[], timeout = 30_000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        for (const frame of page.frames()) {
          for (const selector of selectors) {
            const found = frame.locator(selector).first();
            if (await found.isVisible().catch(() => false)) return found;
          }
        }
        await page.waitForTimeout(500);
      }
      throw new Error(`Stripe checkout: none of ${selectors.join(' | ')} appeared`);
    };
    const cardSelectors = ['#cardNumber', 'input[name="cardNumber"]', 'input[name="number"]', 'input[autocomplete="cc-number"]'];
    let card = await inAnyFrame(cardSelectors, 4_000).catch(() => null);
    if (!card) {
      // Several payment methods offered: choose the card option first.
      const option = await inAnyFrame(['input[type="radio"][value="card"]', '[data-testid="card-accordion-item"]', 'button[value="card"]', 'text=/^(Kad|Card)$/']);
      await option.click({ force: true });
      card = await inAnyFrame(cardSelectors);
    }
    await card.fill('4242 4242 4242 4242');
    await (await inAnyFrame(['#cardExpiry', 'input[name="cardExpiry"]', 'input[name="expiry"]', 'input[autocomplete="cc-exp"]'])).fill('12 / 34');
    await (await inAnyFrame(['#cardCvc', 'input[name="cardCvc"]', 'input[name="cvc"]', 'input[autocomplete="cc-csc"]'])).fill('123');
    const name = await inAnyFrame(['#billingName', 'input[name="billingName"]', 'input[autocomplete="cc-name"]'], 3_000).catch(() => null);
    if (name) await name.fill('Aina Binti Ali');
    await (await inAnyFrame(['[data-testid="hosted-payment-submit-button"]', 'button[type="submit"]'])).click();

    await page.waitForURL(/\/book\/status\?session_id=cs_test_/, { timeout: 90_000 });
    await expect(page.getByTestId('payment-paid')).toBeVisible({ timeout: 30_000 });
    const reference = (await page.getByTestId('booking-reference').innerText()).trim();
    expect(reference).toMatch(/^BCR-[A-Z2-9]{6}$/);

    const { data: booking } = await db.from('bookings').select('id, reference, status, payment_status').eq('customer_email', email).single();
    expect(booking).toMatchObject({ reference, status: 'confirmed', payment_status: 'paid' });
    const { data: payment } = await db.from('payments').select('status, amount_sen, livemode, payment_intent_id').eq('booking_id', booking!.id).single();
    expect(payment).toMatchObject({ status: 'succeeded', amount_sen: 70000, livemode: false });
    expect(payment!.payment_intent_id).toMatch(/^pi_/);
    const { data: occupancy } = await db.from('occupancy').select('kind').eq('booking_id', booking!.id).single();
    expect(occupancy!.kind).toBe('booking');

    // Reloading the return page (a replay) changes nothing: one payment, one confirmation email.
    await page.reload();
    await expect(page.getByTestId('payment-paid')).toBeVisible();
    const emails = await db.from('email_outbox').select('id', { count: 'exact', head: true }).eq('booking_id', booking!.id).eq('template', 'payment_confirmed');
    expect(emails.count).toBe(1);
    const payments = await db.from('payments').select('id', { count: 'exact', head: true }).eq('booking_id', booking!.id);
    expect(payments.count).toBe(1);
  });
});
