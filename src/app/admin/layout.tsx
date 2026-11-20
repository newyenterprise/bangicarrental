import type { Metadata } from 'next';
import Link from 'next/link';
import { signOut } from '@/app/actions';
import { AdminNav } from '@/components/admin/AdminNav';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Brand } from '@/components/SiteChrome';
import { requireAdmin } from '@/lib/auth';
import { getLocale, pick } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The role is checked on the server for every admin page and again inside every action.
  const user = await requireAdmin();
  const L = pick(await getLocale());
  return (
    <>
      <header className="container-page flex min-h-[64px] flex-wrap items-center justify-between gap-2 py-2">
        <div className="flex items-center gap-3">
          <Brand />
          <span className="tag">Admin</span>
        </div>
        <div className="flex items-center gap-1">
          <LanguageSwitch />
          <Link href="/" className="btn-plain text-sm">
            {L('Laman', 'Site')}
          </Link>
          <form action={signOut}>
            <button type="submit" className="btn-plain text-sm" title={user.email}>
              {L('Log keluar', 'Sign out')}
            </button>
          </form>
        </div>
      </header>
      <AdminNav />
      <main className="container-page flex-1 py-5 pb-16">{children}</main>
    </>
  );
}
