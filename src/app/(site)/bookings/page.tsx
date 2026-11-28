import type { Metadata } from 'next';
import Link from 'next/link';
import { signOut } from '@/app/actions';
import { SiteHeader } from '@/components/SiteChrome';
import { claimBookings, requireUser } from '@/lib/auth';
import { fmt } from '@/lib/i18n/config';
import { getI18n } from '@/lib/i18n/server';
import { splitBookings } from '@/lib/renter/data';
import { createUserClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/time';
import type { Booking } from '@/lib/types';
import { StatusTags } from '@/components/renter/StatusTags';

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: d.bookings.metaTitle, robots: { index: false } };
}

export default async function BookingsPage() {
  const user = await requireUser('/bookings');
  await claimBookings(user);
  const { locale, d } = await getI18n();
  // User-scoped client: Row Level Security limits this to the renter's own bookings.
  const supabase = await createUserClient();
  const { data } = await supabase
    .from('bookings')
    .select('*, vehicle_models(name)')
    .eq('renter_id', user.id)
    // Unpaid/expired checkouts are noise, except when a payment needs attention.
    .or('status.in.(confirmed,cancelled),payment_status.eq.needs_attention')
    .order('starts_at', { ascending: true });
  const bookings = (data ?? []) as (Booking & { vehicle_models: { name: string } | null })[];
  const { upcoming, past } = splitBookings(bookings);

  const list = (items: typeof bookings) => (
    <ul className="space-y-3">
      {items.map((b) => (
        <li key={b.id} className="card">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-xl font-bold tracking-tight">{b.vehicle_models?.name}</h3>
            <StatusTags booking={b} d={d} />
          </div>
          <p className="mt-2 text-sm leading-relaxed">
            {formatDateTime(b.starts_at, locale)}
            <br />
            {formatDateTime(b.ends_at, locale)}
          </p>
          <p className="mt-1 text-sm text-muted">
            {d.bookings.reference}: <strong className="text-ink">{b.reference}</strong>
          </p>
          <Link href={`/bookings/${b.id}`} className="btn mt-4 w-full sm:w-auto">
            {d.bookings.view} <span aria-hidden>→</span>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <SiteHeader />
      <main className="container-narrow py-4">
        <h1 className="h-display text-4xl">{d.bookings.title}</h1>
        <div className="mt-2 mb-5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">{fmt(d.bookings.signedInAs, { email: user.email })}</p>
          <div className="flex items-center gap-1">
            <Link href="/account" className="btn-plain text-sm underline">{d.password.link}</Link>
            <form action={signOut}>
              <button type="submit" className="btn-plain text-sm underline">{d.common.signOut}</button>
            </form>
          </div>
        </div>

        {bookings.length === 0 ? (
          <div className="card">
            <h2 className="text-xl font-bold tracking-tight">{d.bookings.emptyTitle}</h2>
            <p className="mt-2 leading-relaxed text-muted">{d.bookings.emptyBody}</p>
            <Link href="/" className="btn mt-4">{d.bookings.emptyCta}</Link>
          </div>
        ) : (
          <>
            {upcoming.length > 0 && (
              <section aria-labelledby="upcoming-title">
                <h2 id="upcoming-title" className="mb-3 text-lg font-bold">{d.bookings.upcoming}</h2>
                {list(upcoming)}
              </section>
            )}
            {past.length > 0 && (
              <section aria-labelledby="past-title" className="mt-7">
                <h2 id="past-title" className="mb-3 text-lg font-bold">{d.bookings.past}</h2>
                {list(past)}
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
