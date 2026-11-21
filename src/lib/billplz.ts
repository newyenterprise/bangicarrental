import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';

/**
 * Billplz API (V3 Bills). Docs: https://www.billplz.com/api
 * Sandbox and production are separate accounts with separate credentials.
 */
export type BillplzBill = {
  id: string;
  collection_id: string;
  paid: boolean;
  state: 'due' | 'paid' | 'deleted';
  amount: number;
  paid_amount: number;
  url: string;
  paid_at?: string | null;
};

export function billplzBaseUrl(): string {
  return env.billplzSandbox ? 'https://www.billplz-sandbox.com' : 'https://www.billplz.com';
}

async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: Record<string, string>): Promise<{ status: number; data: T }> {
  if (!env.billplzApiKey) throw new Error('PAYMENT_UNAVAILABLE');
  const response = await fetch(`${billplzBaseUrl()}/api/v3${path}`, {
    method,
    headers: {
      // HTTP Basic: the API secret key is the username, with an empty password.
      Authorization: `Basic ${Buffer.from(`${env.billplzApiKey}:`).toString('base64')}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });
  const data = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, data };
}

function normalise(raw: Record<string, unknown>): BillplzBill {
  return {
    id: String(raw.id),
    collection_id: String(raw.collection_id ?? ''),
    paid: raw.paid === true || raw.paid === 'true',
    state: raw.state === 'paid' || raw.state === 'deleted' ? raw.state : 'due',
    amount: Number(raw.amount ?? 0),
    paid_amount: Number(raw.paid_amount ?? 0),
    url: String(raw.url ?? ''),
    paid_at: raw.paid_at ? String(raw.paid_at) : null,
  };
}

export async function createBill(input: {
  email: string;
  name: string;
  amountSen: number;
  description: string;
  reference: string;
  callbackUrl: string;
  redirectUrl: string;
}): Promise<BillplzBill> {
  const { status, data } = await request<Record<string, unknown>>('POST', '/bills', {
    collection_id: env.billplzCollectionId,
    email: input.email,
    name: input.name.slice(0, 255),
    amount: String(input.amountSen),
    description: input.description.slice(0, 200),
    callback_url: input.callbackUrl,
    redirect_url: input.redirectUrl,
    reference_1_label: 'Rujukan',
    reference_1: input.reference.slice(0, 120),
  });
  if (status < 200 || status >= 300 || !data.id || !data.url) throw new Error(`Billplz could not create the bill (${status})`);
  return normalise(data);
}

export async function getBill(id: string): Promise<BillplzBill | null> {
  const { status, data } = await request<Record<string, unknown>>('GET', `/bills/${encodeURIComponent(id)}`);
  if (status === 404) return null;
  if (status < 200 || status >= 300 || !data.id) throw new Error(`Billplz could not return the bill (${status})`);
  return normalise(data);
}

/**
 * Deletes an unpaid bill so it leaves the payment page. Returns false when
 * Billplz refuses because the bill has been paid (HTTP 422). Note that Billplz
 * documents that a deleted bill "reappears" if the customer still completes a
 * payment that was already in flight, so a late success remains possible.
 */
export async function deleteBill(id: string): Promise<boolean> {
  const { status } = await request('DELETE', `/bills/${encodeURIComponent(id)}`);
  if (status === 422) return false;
  if (status === 404) return true;
  if (status < 200 || status >= 300) throw new Error(`Billplz could not delete the bill (${status})`);
  return true;
}

/**
 * X Signature source string: every pair except x_signature, each key joined
 * directly to its value, sorted ascending case-insensitively, joined with "|".
 */
export function signatureSource(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .filter(([key]) => key !== 'x_signature')
    .map(([key, value]) => `${key}${value}`)
    .sort((a, b) => {
      const x = a.toLowerCase();
      const y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    })
    .join('|');
}

export function computeSignature(pairs: Record<string, string>, key: string): string {
  return createHmac('sha256', key).update(signatureSource(pairs)).digest('hex');
}

/** Constant-time check of a Billplz X Signature. False when no key is configured. */
export function verifySignature(pairs: Record<string, string>, signature: string | null | undefined, key = env.billplzXSignatureKey): boolean {
  if (!key || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(computeSignature(pairs, key), 'hex');
  const given = Buffer.from(signature.toLowerCase(), 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * The browser redirect carries billplz[id], billplz[paid], billplz[paid_at]...
 * For signing, each key is prefixed with "billplz" without the brackets.
 */
export function redirectPairs(params: Record<string, string | string[] | undefined>): { pairs: Record<string, string>; signature: string | null; id: string | null } {
  const pairs: Record<string, string> = {};
  let signature: string | null = null;
  let id: string | null = null;
  for (const [key, value] of Object.entries(params)) {
    const match = /^billplz\[(\w+)\]$/.exec(key);
    if (!match || typeof value !== 'string') continue;
    if (match[1] === 'x_signature') signature = value;
    else pairs[`billplz${match[1]}`] = value;
    if (match[1] === 'id') id = value;
  }
  return { pairs, signature, id };
}
