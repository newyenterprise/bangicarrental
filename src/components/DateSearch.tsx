import type { Dict } from '@/lib/i18n/ms';

/**
 * Pickup / return date search. A plain GET form, so it works without
 * JavaScript and the chosen dates live in the URL (and survive a language switch).
 */
export function DateSearch({
  d,
  pickupArea,
  from,
  to,
  min,
  model,
  id = 'search',
  className = '',
}: {
  d: Dict;
  pickupArea: string;
  from: string;
  to: string;
  min: string;
  model?: string;
  id?: string;
  className?: string;
}) {
  return (
    <form
      id={id}
      action="/book"
      method="get"
      className={`grid grid-cols-2 items-end gap-3 rounded-[18px] border border-[#dce1d8] bg-white p-4 shadow-[0_7px_20px_#173e2710] md:grid-cols-[1fr_1.4fr_1.4fr_auto] md:gap-4 md:p-[18px] ${className}`}
    >
      {model && <input type="hidden" name="model" value={model} />}
      <div className="col-span-2 md:col-span-1 md:pb-2">
        <small className="mr-2 text-muted md:mb-2 md:block">{d.home.pickupLocation}</small>
        <strong>⌖ {pickupArea}</strong>
      </div>
      <label className="col-span-2 sm:col-span-1">
        <span className="field-label">{d.home.pickup}</span>
        <input className="field-input" type="datetime-local" name="from" defaultValue={from} min={min} step={900} required />
      </label>
      <label className="col-span-2 sm:col-span-1">
        <span className="field-label">{d.home.dropoff}</span>
        <input className="field-input" type="datetime-local" name="to" defaultValue={to} min={min} step={900} required />
      </label>
      <button type="submit" className="btn col-span-2 md:col-span-1">
        {d.home.checkDates} <span aria-hidden>→</span>
      </button>
    </form>
  );
}
