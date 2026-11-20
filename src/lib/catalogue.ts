import 'server-only';
import { createServiceClient } from './supabase/server';
import { parseKlLocal, toKlLocal } from './time';
import type { Quote, VehicleModel } from './types';

/** Models shown publicly. Unit details (registration, year, notes) are never selected here. */
export async function getPublicModels(): Promise<VehicleModel[]> {
  const { data, error } = await createServiceClient()
    .from('vehicle_models')
    .select('id, slug, name, seats, transmission, tagline_ms, tagline_en, image_url, daily_rate_sen, deposit_sen, prep_buffer_minutes, status, sort_order')
    .in('status', ['preview', 'bookable'])
    .order('sort_order');
  if (error) throw new Error('Could not load the catalogue');
  return (data ?? []) as VehicleModel[];
}

export type Period = { from: string; to: string; start: Date; end: Date };

/** Reads ?from=&to= (datetime-local values in Kuala Lumpur time). */
export function readPeriod(params: Record<string, string | string[] | undefined>): Period | null {
  const from = typeof params.from === 'string' ? params.from : '';
  const to = typeof params.to === 'string' ? params.to : '';
  const start = parseKlLocal(from);
  const end = parseKlLocal(to);
  if (!start || !end) return null;
  return { from, to, start, end };
}

/** Sensible defaults for the date search: tomorrow 10 am to the day after, Kuala Lumpur time. */
export function defaultPeriod(leadTimeHours: number): { from: string; to: string; min: string } {
  const earliest = new Date(Date.now() + leadTimeHours * 3600_000);
  const base = toKlLocal(new Date(earliest.getTime() + 24 * 3600_000)).slice(0, 10);
  const start = new Date(`${base}T10:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 3600_000);
  return { from: toKlLocal(start), to: toKlLocal(end), min: toKlLocal(earliest) };
}

export type QuoteResult = { ok: true; quote: Quote; available: boolean } | { ok: false; code: string };

const KNOWN_CODES = ['MODEL_NOT_BOOKABLE', 'INVALID_PERIOD', 'LEAD_TIME', 'TOO_LONG', 'UNAVAILABLE', 'TOO_MANY_HOLDS', 'INVALID_CONTACT'];

/** Maps a database business error to its code (see supabase/migrations/*_functions.sql). */
export function errorCode(message: string | undefined): string {
  return KNOWN_CODES.find((code) => message?.includes(code)) ?? 'generic';
}

/** Price and availability, both derived on the server. */
export async function getQuote(modelId: string, period: Period): Promise<QuoteResult> {
  const db = createServiceClient();
  const args = { p_model_id: modelId, p_starts_at: period.start.toISOString(), p_ends_at: period.end.toISOString() };
  const { data: quote, error } = await db.rpc('quote_rental', args);
  if (error || !quote) return { ok: false, code: errorCode(error?.message) };
  const { data: available } = await db.rpc('model_is_available', args);
  return { ok: true, quote: quote as Quote, available: available === true };
}
