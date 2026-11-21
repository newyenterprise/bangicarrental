import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, klLocal, setLanguage } from './helpers';

const from = klLocal(5, 10);
const to = klLocal(7, 10);

test.describe('public site', () => {
  test('a new visitor sees Bahasa Melayu, and the health check answers', async ({ page, request }) => {
    expect((await request.get('/api/health')).status()).toBe(200);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ms');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Nak ke mana');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('kali ni?');
    await expect(page.getByText('Balik kampung atau jalan-jalan dengan keluarga?')).toBeVisible();
    await expect(page.getByRole('button', { name: /Semak tarikh/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tempahan saya' })).toBeVisible();
    await expect(page.getByText(/Admin preview|Pratonton admin|demo/i)).toHaveCount(0);
  });

  test('only the Serena can be booked; Vellfire and Alphard are previews', async ({ page }) => {
    await page.goto('/');
    const serena = page.getByTestId('model-nissan-serena');
    await expect(serena.getByRole('link')).toHaveCount(1);
    for (const slug of ['toyota-vellfire', 'toyota-alphard']) {
      const card = page.getByTestId(`model-${slug}`);
      await expect(card).toContainText('Dalam perancangan');
      await expect(card.getByRole('link')).toHaveCount(0);
      await expect(card.getByRole('button')).toHaveCount(0);
      await expect(card).not.toContainText('RM');
      // A hand-typed booking URL gets no quote, form or payment link.
      await page.goto(`/book?model=${slug}&from=${from}&to=${to}`);
      await expect(page.getByText('Model ini belum boleh ditempah').first()).toBeVisible();
      await expect(page.locator('form[action]:has(input[name="email"])')).toHaveCount(0);
      await expect(page.getByTestId('pay-now')).toHaveCount(0);
      await page.goto('/');
    }
    await setLanguage(page, 'en');
    await expect(page.getByTestId('model-toyota-alphard')).toContainText('Planned addition');
  });

  test('date search leads to an itemised quote that separates the deposit', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[name="from"]').fill(from);
    await page.locator('input[name="to"]').fill(to);
    await page.getByRole('button', { name: /Semak tarikh/ }).click();
    await page.waitForURL(/\/book\?/);
    await expect(page.getByTestId('pay-now')).toHaveText('RM700');
    await expect(page.getByText('Sewa 2 hari × RM350')).toBeVisible();
    await expect(page.getByTestId('deposit')).toBeVisible();
    await expect(page.getByText('Bayar semasa ambil', { exact: true })).toBeVisible();
    await expect(page.getByText(/dibundarkan ke hari penuh berikutnya/)).toBeVisible();
    await expect(page.getByText('Pembatalan dan bayaran balik')).toBeVisible();
    // one hour later tips it into a third day
    await page.goto(`/book?model=nissan-serena&from=${from}&to=${klLocal(7, 11)}`);
    await expect(page.getByTestId('pay-now')).toHaveText('RM1,050');
  });

  test('switching language keeps the page, the dates and the form progress', async ({ page }) => {
    await page.goto(`/book?model=nissan-serena&from=${from}&to=${to}`);
    await page.locator('#name').fill('Aina Binti Ali');
    await page.locator('#email').fill('aina@example.test');
    await page.locator('#phone').fill('012-345 6789');
    const url = page.url();

    await setLanguage(page, 'en');
    expect(page.url()).toBe(url);
    await expect(page.getByText('Pay now')).toBeVisible();
    await expect(page.getByTestId('pay-now')).toHaveText('RM700');
    await expect(page.locator('#name')).toHaveValue('Aina Binti Ali');
    await expect(page.locator('#email')).toHaveValue('aina@example.test');
    await expect(page.locator('#phone')).toHaveValue('012-345 6789');

    // The choice persists for the next visit, and can be switched back.
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Where to');
    await setLanguage(page, 'ms');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Nak ke mana');
  });

  test('validation messages are translated and nothing is charged without consent', async ({ page }) => {
    await page.goto(`/book?model=nissan-serena&from=${from}&to=${to}`);
    await page.locator('#name').fill('Aina Binti Ali');
    await page.locator('#email').fill('not-an-email');
    await page.getByRole('button', { name: /Teruskan ke bayaran/ }).click();
    await expect(page.getByText('Masukkan alamat emel yang sah.')).toBeVisible();
    await expect(page.getByText('Tandakan kotak untuk sahkan')).toBeVisible();
    await expect(page.locator('#name')).toHaveValue('Aina Binti Ali');
    await setLanguage(page, 'en');
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  });

  for (const locale of ['ms', 'en'] as const) {
    test(`no text overflow on public pages (${locale})`, async ({ page }) => {
      await page.goto('/');
      await setLanguage(page, locale);
      await expectNoHorizontalOverflow(page, `home ${locale}`);
      const pages = [
        `/book?model=nissan-serena&from=${from}&to=${to}`,
        '/book?model=nissan-serena',
        '/book?model=toyota-vellfire',
        '/sign-in',
        '/book/status?b=00000000-0000-4000-8000-000000000000',
      ];
      for (const path of pages) {
        await page.goto(path);
        await expectNoHorizontalOverflow(page, `${path} ${locale}`);
      }
    });
  }
});
