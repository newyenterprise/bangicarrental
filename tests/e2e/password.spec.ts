import { expect, test } from '@playwright/test';
import { serviceClient, signIn, signOut, testEmail } from './helpers';

/**
 * Optional password sign-in: a renter signed in with the email code sets a
 * password on /account, then signs in with it. A password that was not set
 * through the site (for example created directly in Supabase Auth) is refused.
 */
test.describe('password sign-in', () => {
  const userIds: string[] = [];

  test.afterAll(async () => {
    const db = serviceClient();
    for (const id of userIds) await db.auth.admin.deleteUser(id);
  });

  test('set a password on Account, then sign in with it', async ({ page }, testInfo) => {
    const email = testEmail(`pw-${testInfo.project.name}`);
    const password = 'Bangi#2026x';
    userIds.push(await signIn(page, email));

    await page.goto('/bookings');
    await page.getByRole('link', { name: 'Akaun' }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByTestId('password-status')).toHaveText('Anda belum menetapkan kata laluan.');

    // A weak password is refused, with the missing rules shown.
    await page.locator('#password').fill('bangi2026');
    await page.locator('#confirm').fill('bangi2026');
    await page.getByRole('button', { name: 'Tetapkan kata laluan' }).click();
    await expect(page.getByText('belum memenuhi semua syarat')).toBeVisible();

    // Mismatched confirmation is refused.
    await page.locator('#password').fill(password);
    await page.locator('#confirm').fill('Bangi#2026y');
    await page.getByRole('button', { name: 'Tetapkan kata laluan' }).click();
    await expect(page.getByText('tidak sama')).toBeVisible();

    await page.locator('#password').fill(password);
    await page.locator('#confirm').fill(password);
    await page.getByRole('button', { name: 'Tetapkan kata laluan' }).click();
    await expect(page.getByTestId('password-saved')).toBeVisible();

    // Signed out, the password gets back in; a wrong one does not.
    await signOut(page);
    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'Masuk dengan kata laluan' }).click();
    await page.locator('#pw-email').fill(email);
    await page.locator('#pw-password').fill('Wrong#2026x');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page.getByText('Emel atau kata laluan salah')).toBeVisible();

    await page.locator('#pw-email').fill(email);
    await page.locator('#pw-password').fill(password);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await page.waitForURL(/\/bookings$/);
    await page.goto('/account');
    await expect(page.getByTestId('password-status')).toHaveText('Kata laluan telah ditetapkan.');
  });

  test('refuses a password that was not set through the site', async ({ page }, testInfo) => {
    const db = serviceClient();
    const email = testEmail(`pw-direct-${testInfo.project.name}`);
    const password = 'Direct#2026x';
    // Simulates someone creating a password straight in Supabase Auth, without the email check.
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    userIds.push(data.user.id);

    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'Masuk dengan kata laluan' }).click();
    await page.locator('#pw-email').fill(email);
    await page.locator('#pw-password').fill(password);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page.getByText('Emel atau kata laluan salah')).toBeVisible();
    await page.goto('/bookings');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
