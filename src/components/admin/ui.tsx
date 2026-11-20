import Link from 'next/link';
import type { Msg } from '@/lib/admin/form';
import { tagClass } from '@/lib/admin/labels';

type L = (ms: string, en: string) => string;

export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <h1 className="h-display text-3xl">{title}</h1>
      {children}
    </div>
  );
}

export function Section({ id, title, children, aside }: { id?: string; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-20" aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id ? `${id}-title` : undefined} className="text-xl font-bold tracking-tight">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function StatusTag({ status, labels, L }: { status: string; labels: Record<string, Msg>; L: L }) {
  const label = labels[status];
  return <span className={tagClass(status)}>{label ? L(...label) : status}</span>;
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row-line">
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-muted">{children}</p>;
}

/** A tappable list row linking to a booking. */
export function BookingLink({ href, title, meta, tags }: { href: string; title: string; meta: string; tags?: React.ReactNode }) {
  return (
    <Link href={href} className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-line-soft py-3 last:border-b-0 hover:bg-mist/50">
      <span>
        <strong className="block">{title}</strong>
        <span className="block text-sm text-muted">{meta}</span>
      </span>
      <span className="flex flex-wrap gap-1">{tags}</span>
    </Link>
  );
}

/** Collapsible form area so long booking pages stay scannable on a phone. */
export function Disclosure({ summary, children, open }: { summary: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="mt-3 rounded-xl border border-line-soft" open={open}>
      <summary className="flex min-h-12 cursor-pointer items-center px-3 font-bold">{summary}</summary>
      <div className="border-t border-line-soft p-3">{children}</div>
    </details>
  );
}
