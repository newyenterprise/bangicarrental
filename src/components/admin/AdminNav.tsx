'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useL } from '@/lib/i18n/client';

const ITEMS: { href: string; ms: string; en: string }[] = [
  { href: '/admin', ms: 'Hari ini', en: 'Today' },
  { href: '/admin/bookings', ms: 'Tempahan', en: 'Bookings' },
  { href: '/admin/calendar', ms: 'Kalendar', en: 'Calendar' },
  { href: '/admin/review', ms: 'Semakan', en: 'Review' },
  { href: '/admin/fleet', ms: 'Armada', en: 'Fleet' },
  { href: '/admin/agreement', ms: 'Perjanjian', en: 'Agreement' },
  { href: '/admin/settings', ms: 'Tetapan', en: 'Settings' },
  { href: '/admin/audit', ms: 'Audit', en: 'Audit' },
];

/** Horizontally scrollable so every section is one thumb-swipe away on a phone. */
export function AdminNav() {
  const L = useL();
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="sticky top-0 z-20 border-y border-line bg-cream/95 backdrop-blur">
      <ul className="container-page flex gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
        {ITEMS.map((item) => {
          const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold ${active ? 'bg-green text-white' : 'hover:bg-mist'}`}
              >
                {L(item.ms, item.en)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
