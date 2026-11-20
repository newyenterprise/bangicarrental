import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { DateSearch } from '@/components/DateSearch';
import { SiteHeader } from '@/components/SiteChrome';
import { defaultPeriod, getPublicModels, getQuote, readPeriod } from '@/lib/catalogue';
import { fmt } from '@/lib/i18n/config';
import { getI18n } from '@/lib/i18n/server';
import { formatRM } from '@/lib/money';
import { getLaunchStatus, getSettings, localized } from '@/lib/settings';
import { formatDateTime } from '@/lib/time';
import { CheckoutForm } from './CheckoutForm';

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: d.book.metaTitle, robots: { index: false } };
}

function Message({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="card mt-4">
      <h1 className="h-display text-3xl">{title}</h1>
      <p className="mt-3 leading-relaxed">{body}</p>
      {children}
    </div>
  );
}

export default async function BookPage({ searchParams }: PageProps<'/book'>) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const [models, settings, launch] = await Promise.all([getPublicModels(), getSettings(), getLaunchStatus()]);
  const defaults = defaultPeriod(settings.lead_time_hours);
  const period = readPeriod(params);
  const bookable = models.filter((m) => m.status === 'bookable');
  const slug = typeof params.model === 'string' ? params.model : undefined;
  const requested = slug ? models.find((m) => m.slug === slug) : undefined;
  const model = requested ?? (slug ? undefined : bookable[0]);

  const search = (
    <DateSearch
      d={d}
      pickupArea={settings.pickup_area}
      from={period?.from ?? defaults.from}
      to={period?.to ?? defaults.to}
      min={defaults.min}
      model={model?.status === 'bookable' ? model.slug : undefined}
      className="mt-5"
    />
  );

  let body: React.ReactNode;

  if (!model || model.status !== 'bookable') {
    // Preview / hidden / unknown models can never reach a quote or a payment link.
    body = (
      <Message title={d.book.notBookableTitle} body={d.book.notBookableBody}>
        <Link href="/#fleet" className="btn mt-5">{d.home.fleetTitle}</Link>
      </Message>
    );
  } else if (!launch.bookingsOpen) {
    body = <Message title={d.book.closedTitle} body={d.book.closedBody} />;
  } else if (!period) {
    body = (
      <>
        <Message title={d.book.pickDatesTitle} body={d.book.pickDatesBody} />
        {search}
      </>
    );
  } else {
    const result = await getQuote(model.id, period);
    if (!result.ok) {
      const text = fmt((d.errors as Record<string, string>)[result.code] ?? d.errors.generic, {
        hours: settings.lead_time_hours,
        days: settings.max_rental_days,
      });
      body = (
        <>
          <Message title={d.home.datesInvalidTitle} body={text} />
          {search}
        </>
      );
    } else if (!result.available) {
      body = (
        <>
          <Message title={d.book.unavailableTitle} body={fmt(d.book.unavailableBody, { model: model.name })} />
          {search}
        </>
      );
    } else {
      const { quote } = result;
      const deadline = new Date(period.start.getTime() - settings.verification_deadline_hours * 3600_000);
      const terms = localized(settings, 'cancellation_terms', locale);
      body = (
        <div className="mt-4 grid gap-5 lg:grid-cols-[1.15fr_1fr] lg:items-start">
          <div className="space-y-5">
            <section className="card" aria-labelledby="summary-title">
              <div className="flex items-center gap-4">
                <Image src={model.image_url} alt="" width={160} height={90} unoptimized className="h-auto w-28 shrink-0 object-contain sm:w-36" />
                <div>
                  <h1 id="summary-title" className="h-display text-2xl sm:text-3xl">{model.name}</h1>
                  <p className="text-sm text-muted">
                    {fmt(d.common.seats, { n: model.seats })} · {model.transmission === 'manual' ? d.common.manual : d.common.automatic}
                  </p>
                </div>
              </div>
              <dl className="mt-3">
                <div className="row-line"><dt>{d.book.pickupAt}</dt><dd>{formatDateTime(period.start, locale)}</dd></div>
                <div className="row-line"><dt>{d.book.returnAt}</dt><dd>{formatDateTime(period.end, locale)}</dd></div>
                <div className="row-line"><dt>{d.book.pickupArea}</dt><dd>{settings.pickup_area}</dd></div>
              </dl>
              <p className="field-hint">{d.book.pickupAreaNote}</p>
              <Link href={`/book?model=${model.slug}`} className="btn-plain -ml-2 mt-1 text-sm underline">{d.book.changeDates}</Link>
            </section>

            <section className="card" aria-labelledby="quote-title">
              <h2 id="quote-title" className="text-xl font-bold tracking-tight">{d.book.quoteTitle}</h2>
              <dl>
                <div className="row-line">
                  <dt>{fmt(d.book.rentalLine, { days: quote.days, rate: formatRM(quote.daily_rate_sen) })}</dt>
                  <dd>{formatRM(quote.rental_total_sen)}</dd>
                </div>
                <div className="row-line bg-mist/60 px-3">
                  <dt>
                    <strong>{d.book.payNow}</strong>
                    <span className="block text-sm text-muted">{d.book.payNowNote}</span>
                  </dt>
                  <dd className="text-xl" data-testid="pay-now">{formatRM(quote.rental_total_sen)}</dd>
                </div>
                {quote.deposit_sen > 0 && (
                  <div className="row-line border-b-0">
                    <dt>
                      {d.book.depositLine} <span className="tag ml-1">{d.book.payAtPickup}</span>
                      <span className="mt-1 block text-sm text-muted">{d.book.depositNote}</span>
                    </dt>
                    <dd data-testid="deposit">{formatRM(quote.deposit_sen)}</dd>
                  </div>
                )}
              </dl>
              <p className="notice mt-2 text-sm">{d.book.roundingNote}</p>
            </section>

            <section className="card" aria-labelledby="terms-title">
              <h2 id="terms-title" className="text-xl font-bold tracking-tight">{d.book.beforeYouPay}</h2>
              <h3 className="mt-3 font-bold">{d.book.verificationTitle}</h3>
              <p className="mt-1 text-sm leading-relaxed">{d.book.verificationBody}</p>
              <p className="mt-1 text-sm leading-relaxed font-semibold">
                {fmt(d.book.verificationDeadline, { deadline: formatDateTime(deadline, locale), hours: settings.verification_deadline_hours })}
              </p>
              <h3 className="mt-4 font-bold">{d.book.cancellationTitle}</h3>
              <p className="mt-1 text-sm leading-relaxed whitespace-pre-line">{terms || d.book.cancellationFallback}</p>
            </section>
          </div>

          <section className="card lg:sticky lg:top-4" aria-labelledby="contact-title">
            <h2 id="contact-title" className="text-xl font-bold tracking-tight">{d.book.contactTitle}</h2>
            <p className="mt-1 mb-4 text-sm text-muted">{d.book.contactIntro}</p>
            <CheckoutForm
              modelId={model.id}
              from={period.from}
              to={period.to}
              amountLabel={formatRM(quote.rental_total_sen)}
              holdMinutes={settings.hold_minutes}
              leadTimeHours={settings.lead_time_hours}
              maxDays={settings.max_rental_days}
            />
          </section>
        </div>
      );
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="container-page pb-6">
        <p className="text-sm font-bold tracking-[0.08em] text-muted uppercase">{d.book.title}</p>
        {body}
      </main>
    </>
  );
}
