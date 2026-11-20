import Link from 'next/link';
import { getSessionUser } from '@/lib/auth';
import { getI18n } from '@/lib/i18n/server';
import { getLaunchStatus, getSettings } from '@/lib/settings';
import { LanguageSwitch } from './LanguageSwitch';

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 text-2xl font-black tracking-[-1.5px] sm:text-[28px]" aria-label="Bangi Car Rental">
      <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-green-deep font-serif text-[26px] font-black text-white italic" aria-hidden>
        B
      </span>
      <span className="leading-none">
        Bangi
        <small className="mt-0.5 block text-[10px] font-bold tracking-[2px]">CAR RENTAL</small>
      </span>
    </Link>
  );
}

export async function SiteHeader({ showSectionLinks = false }: { showSectionLinks?: boolean }) {
  const { d } = await getI18n();
  const user = await getSessionUser();
  return (
    <header className="container-page flex h-[72px] items-center justify-between gap-3 sm:h-[86px]">
      <Brand />
      {showSectionLinks && (
        <nav className="hidden items-center gap-6 md:flex" aria-label="Main">
          <a href="#fleet" className="btn-plain">{d.nav.cars}</a>
          <a href="#how" className="btn-plain">{d.nav.how}</a>
        </nav>
      )}
      <div className="flex items-center gap-1 sm:gap-3">
        <LanguageSwitch />
        {user?.role === 'admin' && (
          <Link href="/admin" className="btn-plain hidden text-sm sm:inline-flex">
            {d.nav.admin}
          </Link>
        )}
        <Link href="/bookings" className="btn-plain text-sm sm:text-base">
          {d.nav.myBookings}
        </Link>
      </div>
    </header>
  );
}

export async function TestModeBanner() {
  const { d } = await getI18n();
  const launch = await getLaunchStatus();
  if (launch.paymentMode !== 'test') return null;
  return (
    <p role="status" className="bg-sun px-4 py-2 text-center text-sm font-bold text-ink">
      {d.common.testMode}
    </p>
  );
}

export async function SiteFooter() {
  const { d } = await getI18n();
  const settings = await getSettings();
  return (
    <footer className="container-page mt-auto flex flex-col gap-2 pt-10 pb-7 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p>
        <b>bangicarrental.my</b>
        <span className="text-muted"> · {d.home.footerNote}</span>
      </p>
      <p className="text-muted">
        {settings.company_name ? `${settings.company_name} · ` : ''}
        {settings.contact_phone && <a href={`tel:${settings.contact_phone.replace(/[^+\d]/g, '')}`} className="underline">{settings.contact_phone}</a>}
      </p>
    </footer>
  );
}
