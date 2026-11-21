import { expect, type Page } from '@playwright/test';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const RUN = Date.now().toString(36);
export const testEmail = (name: string) => `e2e-${RUN}-${name}@example.test`;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for e2e tests (.env.local)`);
  return value;
}

/** Service-role client for arranging and cleaning up fictional test data. Never used by the app under test. */
export function serviceClient(): SupabaseClient {
  return createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** "YYYY-MM-DDTHH:mm" in Kuala Lumpur time, `days` from now at the given hour. */
export function klLocal(days: number, hour = 10): string {
  const kl = new Date(Date.now() + 8 * 3600_000 + days * 86_400_000);
  return `${kl.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00`;
}
export const klIso = (local: string) => new Date(`${local}:00+08:00`).toISOString();

/**
 * Signs a fictional user in with a real one-time email code. The code is
 * issued by the Auth admin API (test addresses cannot receive mail) and
 * verified exactly as the site verifies it; the resulting session cookies are
 * then given to the browser. Returns the user id.
 */
export async function signIn(page: Page, email: string): Promise<string> {
  const admin = serviceClient();
  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error || !link.properties?.email_otp) throw new Error(`Could not issue a sign-in code: ${error?.message}`);

  let jar: { name: string; value: string }[] = [];
  const client = createServerClient(required('SUPABASE_URL'), required('SUPABASE_ANON_KEY'), {
    cookies: {
      getAll: () => jar,
      setAll: (list) => {
        for (const cookie of list) {
          jar = jar.filter((c) => c.name !== cookie.name);
          if (cookie.value) jar.push({ name: cookie.name, value: cookie.value });
        }
      },
    },
  });
  const { data, error: verifyError } = await client.auth.verifyOtp({ email, token: link.properties.email_otp, type: 'email' });
  if (verifyError || !data.user) throw new Error(`Could not verify the sign-in code: ${verifyError?.message}`);

  const base = new URL(process.env.E2E_BASE_URL || 'http://localhost:3000');
  await page.context().addCookies(
    jar.map((c) => ({ name: c.name, value: c.value, domain: base.hostname, path: '/', httpOnly: false, secure: base.protocol === 'https:', sameSite: 'Lax' as const })),
  );
  return data.user.id;
}

export async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies({ name: /^sb-/ });
}

/** Fails when anything makes the page wider than the screen. */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  // Let any in-flight refresh settle first (a language switch re-renders the page).
  await page.waitForLoadState('networkidle').catch(() => undefined);
  try {
    await measureOverflow(page, label);
  } catch (error) {
    if (!String(error).includes('Execution context was destroyed')) throw error;
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await measureOverflow(page, label);
  }
}

async function measureOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.position === 'fixed' || style.visibility === 'hidden') continue;
      // Decorative shapes are clipped by their parent on purpose.
      if (el.closest('[aria-hidden="true"]')) continue;
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const overflowX = getComputedStyle(p).overflowX;
        if (overflowX !== 'visible') {
          clipped = true;
          break;
        }
      }
      if (!clipped && (rect.right > width + 1 || rect.left < -1)) {
        offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} [${Math.round(rect.left)}..${Math.round(rect.right)}]`);
      }
    }
    return { scroll: document.documentElement.scrollWidth, width, offenders: offenders.slice(0, 5) };
  });
  expect(overflow.offenders, `${label}: elements wider than the screen`).toEqual([]);
  expect(overflow.scroll, `${label}: page scrolls sideways`).toBeLessThanOrEqual(overflow.width + 1);
}

export async function setLanguage(page: Page, locale: 'ms' | 'en'): Promise<void> {
  await page.getByLabel('Bahasa / Language').selectOption(locale);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}
