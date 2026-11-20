import Image from 'next/image';
import Link from 'next/link';
import { DateSearch } from '@/components/DateSearch';
import { SiteHeader } from '@/components/SiteChrome';
import { defaultPeriod, getPublicModels } from '@/lib/catalogue';
import { fmt } from '@/lib/i18n/config';
import { getI18n } from '@/lib/i18n/server';
import { formatRM } from '@/lib/money';
import { getLaunchStatus, getSettings } from '@/lib/settings';

export default async function HomePage() {
  const { d } = await getI18n();
  const [models, settings, launch] = await Promise.all([getPublicModels(), getSettings(), getLaunchStatus()]);
  const defaults = defaultPeriod(settings.lead_time_hours);
  const hero = models.find((m) => m.status === 'bookable') ?? models[0];

  return (
    <>
      <SiteHeader showSectionLinks />
      <main className="container-page">
        <section className="relative isolate mt-2 flex min-h-[355px] items-center overflow-hidden rounded-[26px] bg-sage px-[6%] pt-7 pb-[190px] sm:px-[5%] sm:py-10">
          <div className="absolute right-[4%] -bottom-[10%] -z-20 aspect-square w-[44%] rounded-full bg-sun sm:top-[14%] sm:bottom-auto sm:w-[39%]" aria-hidden />
          <div className="absolute -right-[8%] -bottom-6 -z-10 h-[100px] w-[63%] -rotate-[8deg] bg-sage-deep" aria-hidden />
          <div className="max-w-full sm:max-w-[47%]">
            <span className="text-xs font-bold tracking-[0.08em]">
              <i className="mr-2 inline-block h-[9px] w-[9px] rounded-full bg-[#ed8c36]" aria-hidden />
              {d.home.location}
            </span>
            <h1 className="h-display my-4 text-[clamp(42px,5.2vw,76px)] tracking-[-0.065em] sm:my-5">
              {d.home.heroLine1}
              <br />
              <em className="font-serif font-normal text-leaf italic">{d.home.heroLine2}</em>
            </h1>
            <p className="max-w-[90%] leading-relaxed sm:max-w-[350px]">{d.home.heroBody}</p>
          </div>
          {hero && (
            <Image
              src={hero.image_url}
              alt={hero.name}
              width={640}
              height={360}
              priority
              unoptimized
              className="absolute right-[4%] bottom-[3%] max-h-[172px] w-[78%] object-contain mix-blend-multiply sm:right-[2%] sm:bottom-[9%] sm:max-h-none sm:w-1/2"
            />
          )}
        </section>

        <DateSearch
          d={d}
          pickupArea={settings.pickup_area}
          from={defaults.from}
          to={defaults.to}
          min={defaults.min}
          className="relative mx-0 mt-3 mb-7 sm:mx-[3%] sm:-mt-4 sm:mb-10"
        />

        <section id="fleet" className="scroll-mt-6">
          <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <h2 className="h-display text-[clamp(28px,3vw,40px)]">{d.home.fleetTitle}</h2>
            <small className="text-muted">{d.home.imageCaption}</small>
          </div>
          <div className="my-5 grid grid-cols-1 gap-[18px] md:grid-cols-3">
            {models.map((model) => {
              const bookable = model.status === 'bookable';
              const open = bookable && launch.bookingsOpen;
              return (
                <article key={model.id} className="card flex flex-col" data-testid={`model-${model.slug}`}>
                  <div>
                    <span className={`tag ${open ? 'tag-live' : ''}`}>
                      {open ? d.home.open : bookable ? d.home.openingSoon : d.home.planned}
                    </span>
                  </div>
                  <div className="flex h-[150px] items-center justify-center">
                    <Image src={model.image_url} alt={model.name} width={400} height={225} unoptimized className="max-h-[95%] w-auto max-w-full object-contain" />
                  </div>
                  <h3 className="mt-2 mb-1 text-[23px] font-bold tracking-[-1px]">{model.name}</h3>
                  <p className="text-sm text-muted">
                    {fmt(d.common.seats, { n: model.seats })} · {model.transmission === 'manual' ? d.common.manual : d.common.automatic}
                  </p>
                  <div className="mt-4 flex min-h-[53px] flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
                    {open ? (
                      <>
                        <strong>
                          {formatRM(model.daily_rate_sen)} <small className="font-normal text-muted">{d.common.perDay}</small>
                        </strong>
                        <Link href={`/book?model=${model.slug}`} className="btn btn-sm">
                          {d.home.chooseDates} <span aria-hidden>→</span>
                        </Link>
                      </>
                    ) : (
                      <small className="text-muted">{bookable ? d.home.openingSoon : d.home.notOpenYet}</small>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section id="how" className="my-6 scroll-mt-6 rounded-2xl bg-mist p-6">
          <h2 className="h-display text-[clamp(28px,3vw,40px)]">{d.home.howTitle}</h2>
          <p className="mt-4 max-w-3xl leading-relaxed">{d.home.howBody}</p>
          <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[d.home.step1, d.home.step2, d.home.step3, d.home.step4].map((step, index) => (
              <li key={step} className="flex items-start gap-3 rounded-xl bg-white/70 p-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-green text-sm font-bold text-white" aria-hidden>
                  {index + 1}
                </span>
                <span className="text-sm leading-snug font-semibold">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </>
  );
}
