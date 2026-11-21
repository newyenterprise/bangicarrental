import { describe, expect, it } from 'vitest';
import { computeSignature, redirectPairs, signatureSource, verifySignature } from '@/lib/billplz';

// Worked examples from the Billplz API documentation (X Signature), using its sample key.
const SAMPLE_KEY = 'S-s7b4yWpp9h7rrkNM1i3Z_g';

describe('Billplz X Signature', () => {
  it('matches the documented redirect example', () => {
    const { pairs, signature, id } = redirectPairs({
      b: '00000000-0000-4000-8000-000000000000',
      'billplz[id]': 'zq0tm2wc',
      'billplz[paid]': 'true',
      'billplz[paid_at]': '2018-09-27 15:15:09 +0800',
      'billplz[x_signature]': '4aab095fe5a39b1d534500988f9a0cb085cd1b6d5bbb55dd4e02ea6fa102b47b',
    });
    expect(id).toBe('zq0tm2wc');
    expect(signatureSource(pairs)).toBe('billplzidzq0tm2wc|billplzpaid_at2018-09-27 15:15:09 +0800|billplzpaidtrue');
    expect(computeSignature(pairs, SAMPLE_KEY)).toBe('4aab095fe5a39b1d534500988f9a0cb085cd1b6d5bbb55dd4e02ea6fa102b47b');
    expect(verifySignature(pairs, signature, SAMPLE_KEY)).toBe(true);
  });

  it('builds the callback source string in the documented order, keeping empty values', () => {
    const fields = {
      id: 'zq0tm2wc',
      collection_id: 'yhx5t1pp',
      paid: 'true',
      state: 'paid',
      amount: '100',
      paid_amount: '100',
      due_at: '2018-9-27',
      email: 'tester@test.com',
      mobile: '',
      name: 'TESTER',
      url: 'http://www.billplz-sandbox.com/bills/zq0tm2wc',
      paid_at: '2018-09-27 15:15:09 +0800',
      x_signature: 'ignored',
    };
    expect(signatureSource(fields)).toBe(
      'amount100|collection_idyhx5t1pp|due_at2018-9-27|emailtester@test.com|idzq0tm2wc|mobile|nameTESTER|paid_amount100|paid_at2018-09-27 15:15:09 +0800|paidtrue|statepaid|urlhttp://www.billplz-sandbox.com/bills/zq0tm2wc',
    );
    const signature = computeSignature(fields, SAMPLE_KEY);
    expect(verifySignature(fields, signature, SAMPLE_KEY)).toBe(true);
  });

  it('rejects tampered, missing or malformed signatures and a missing key', () => {
    const pairs = { billplzid: 'zq0tm2wc', billplzpaid: 'true', billplzpaid_at: '2018-09-27 15:15:09 +0800' };
    const good = computeSignature(pairs, SAMPLE_KEY);
    expect(verifySignature({ ...pairs, billplzpaid: 'false' }, good, SAMPLE_KEY)).toBe(false);
    expect(verifySignature({ ...pairs, billplzid: 'another' }, good, SAMPLE_KEY)).toBe(false);
    expect(verifySignature(pairs, good, 'wrong-key')).toBe(false);
    expect(verifySignature(pairs, null, SAMPLE_KEY)).toBe(false);
    expect(verifySignature(pairs, 'not-hex', SAMPLE_KEY)).toBe(false);
    expect(verifySignature(pairs, good, '')).toBe(false);
  });
});
