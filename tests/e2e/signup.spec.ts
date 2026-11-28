import { expect, test } from '@playwright/test';
import { klLocal, serviceClient, signOut, testEmail } from './helpers';

/**
 * Sign-up from the booking page: name, phone, email and password, confirmed by
 * a 6-digit code, then straight back to the same quote with the details filled.
 *
 * Supabase emails the code; a test address cannot receive it, so after the form
 * is sent the test asks the Auth admin API for a fresh code for the same address.
 * Skipped unless RUN_SIGNUP_TEST=1, because it sends a real sign-up email
 * (Supabase needs custom SMTP configured to deliver it).
 */
test.describe('sign-up before booking', () => {
  test.skip(process.env.RUN_SIGNUP_TEST !== '1', 'set RUN_SIGNUP_TEST=1 to run (sends a sign-up email)');
  const ids: string[] = [];

  test.afterAll(async () => {
    const db = serviceClient();
    for (const id of ids) await db.auth.admin.deleteUser(id);
  });

  test('signs up with a code and returns to the quote with name and phone filled', async ({ page }, testInfo) => {
    const db = serviceClient();
    const email = testEmail(`signup-${testInfo.project.name}`);
    const password = 'Bangi#2026x';
    const from = klLocal(9, 10);
    const to = klLocal(11, 10);

    await page.goto(`/book?model=nissan-serena&from=${from}&to=${to}`);
    await page.getByTestId('account-required').getByRole('link', { name: 'Daftar akaun' }).click();
    await expect(page).toHaveURL(/\/sign-up\?next=/);

    await page.locator('#name').fill('Aina Binti Ali');
    await page.locator('#phone').fill('012-345 6789');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('#confirm').fill(password);
    await page.getByRole('button', { name: 'Daftar', exact: true }).click();
    await expect(page.getByText('Sahkan emel anda')).toBeVisible({ timeout: 20_000 });

    const { data, error } = await db.auth.admin.generateLink({ type: 'signup', email, password });
    if (error || !data.properties?.email_otp) throw new Error(`No sign-up code: ${error?.message}`);
    ids.push(data.user.id);
    await page.locator('#code').fill(data.properties.email_otp);
    await page.getByRole('button', { name: 'Sahkan dan teruskan' }).click();

    await page.waitForURL(/\/book\?model=nissan-serena/);
    await expect(page.getByTestId('account-email')).toHaveText(email);
    await expect(page.locator('#name')).toHaveValue('Aina Binti Ali');
    await expect(page.locator('#phone')).toHaveValue('012-345 6789');

    // The password chosen at sign-up works for the next sign-in.
    await signOut(page);
    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'Masuk dengan kata laluan' }).click();
    await page.locator('#pw-email').fill(email);
    await page.locator('#pw-password').fill(password);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await page.waitForURL(/\/bookings$/);
  });

  test('an email code cannot create an account; it points to sign-up', async ({ page }, testInfo) => {
    await page.goto('/sign-in');
    await page.locator('#email').fill(testEmail(`nobody-${testInfo.project.name}`));
    await page.getByRole('button', { name: 'Hantar kod' }).click();
    await expect(page.getByText('Tiada akaun untuk emel ini. Daftar dahulu.')).toBeVisible();
  });
});
