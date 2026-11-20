import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, createTestDb, createUser } from './harness';

let db: PGlite;
let serena: string;
let vellfire: string;
let unit: string;

// Asia/Kuala_Lumpur is UTC+8 all year.
const at = (day: number, hour = 10) => new Date(Date.UTC(2031, 0, day, hour - 8)).toISOString();

type HoldResult = { booking_id: string; reference: string; quote: { days: number; rental_total_sen: number } };

async function hold(model: string, start: string, end: string, email = 'aina@example.test') {
  const { rows } = await db.query<{ r: HoldResult }>(
    'select public.create_booking_hold($1,$2,$3,$4,$5,$6,$7) as r',
    [model, start, end, 'Aina Test', email, '0123456789', 'ms'],
  );
  return rows[0].r;
}
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

beforeAll(async () => {
  db = await createTestDb();
  serena = (await one<{ id: string }>("select id from vehicle_models where slug='nissan-serena'")).id;
  vellfire = (await one<{ id: string }>("select id from vehicle_models where slug='toyota-vellfire'")).id;
  unit = (await one<{ id: string }>('select id from vehicles where model_id=$1', [serena])).id;
});

describe('catalogue and pricing', () => {
  it('seeds Serena as bookable and the others as unit-less previews', async () => {
    const { rows } = await db.query<{ slug: string; status: string; units: number }>(
      `select m.slug, m.status, (select count(*)::int from vehicles v where v.model_id = m.id) as units
       from vehicle_models m order by sort_order`,
    );
    expect(rows).toEqual([
      { slug: 'nissan-serena', status: 'bookable', units: 1 },
      { slug: 'toyota-vellfire', status: 'preview', units: 0 },
      { slug: 'toyota-alphard', status: 'preview', units: 0 },
    ]);
  });

  it('rounds a partial 24-hour period up to the next day', async () => {
    const q = async (s: string, e: string) =>
      (await one<{ q: { days: number; rental_total_sen: number } }>('select public.quote_rental($1,$2,$3) as q', [serena, s, e])).q;
    expect(await q(at(3, 10), at(5, 10))).toMatchObject({ days: 2, rental_total_sen: 70000 });
    expect(await q(at(3, 10), at(5, 11))).toMatchObject({ days: 3, rental_total_sen: 105000 });
  });

  it('refuses a preview model even through a direct function call', async () => {
    await expect(hold(vellfire, at(3), at(4))).rejects.toThrow(/MODEL_NOT_BOOKABLE/);
    await expect(db.query('select public.quote_rental($1,$2,$3)', [vellfire, at(3), at(4)])).rejects.toThrow(/MODEL_NOT_BOOKABLE/);
  });

  it('enforces the lead time and a sane period', async () => {
    const soon = new Date(Date.now() + 3600_000).toISOString();
    const later = new Date(Date.now() + 90000_000).toISOString();
    await expect(hold(serena, soon, later)).rejects.toThrow(/LEAD_TIME/);
    await expect(hold(serena, at(5), at(4))).rejects.toThrow(/INVALID_PERIOD/);
  });
});

describe('occupancy', () => {
  it('lets only one customer hold the last unit, and rejects an overlapping admin block', async () => {
    const first = await hold(serena, at(10), at(12), 'a@example.test');
    expect(first.reference).toMatch(/^BCR-[A-Z2-9]{6}$/);
    await expect(hold(serena, at(11), at(13), 'b@example.test')).rejects.toThrow(/UNAVAILABLE/);
    await expect(
      db.query(
        `insert into occupancy (vehicle_id, period, kind, reason) values ($1, tstzrange($2,$3,'[)'), 'block', 'maintenance')`,
        [unit, at(11), at(11, 15)],
      ),
    ).rejects.toThrow(/occupancy_no_overlap/);
  });

  it('applies the turnaround buffer with half-open periods', async () => {
    // Serena buffer is 120 minutes; the first hold ends on the 12th at 10:00.
    await expect(hold(serena, at(12, 11), at(13, 11), 'c@example.test')).rejects.toThrow(/UNAVAILABLE/);
    const ok = await hold(serena, at(12, 12), at(13, 12), 'c@example.test');
    expect(ok.booking_id).toBeTruthy();
    // a block may start exactly when the buffered period ends
    await db.query(
      `insert into occupancy (vehicle_id, period, kind, reason) values ($1, tstzrange($2,$3,'[)'), 'block', 'personal')`,
      [unit, at(13, 14), at(14, 14)],
    );
  });

  it('releases an abandoned checkout so the dates can be booked again', async () => {
    const abandoned = await hold(serena, at(20), at(21), 'd@example.test');
    await expect(hold(serena, at(20), at(21), 'e@example.test')).rejects.toThrow(/UNAVAILABLE/);
    expect((await one<{ r: boolean }>('select public.release_booking_hold($1) as r', [abandoned.booking_id])).r).toBe(true);
    expect((await one<{ status: string }>('select status from bookings where id=$1', [abandoned.booking_id])).status).toBe('expired');
    const next = await hold(serena, at(20), at(21), 'e@example.test');
    expect(next.booking_id).toBeTruthy();
    // releasing twice is a no-op
    expect((await one<{ r: boolean }>('select public.release_booking_hold($1) as r', [abandoned.booking_id])).r).toBe(false);
  });

  it('limits unpaid holds per email', async () => {
    await hold(serena, at(40), at(41), 'spam@example.test');
    await hold(serena, at(42), at(43), 'spam@example.test');
    await expect(hold(serena, at(44), at(45), 'spam@example.test')).rejects.toThrow(/TOO_MANY_HOLDS/);
  });
});

describe('payments', () => {
  const pay = async (bookingId: string, session: string, amount: number) =>
    (await one<{ r: string }>('select public.record_payment_success($1,$2,$3,$4) as r', [bookingId, session, 'pi_' + session, amount])).r;

  it('confirms once; duplicate events create one paid booking and one confirmation email', async () => {
    const b = await hold(serena, at(50), at(52), 'pay@example.test');
    expect(await pay(b.booking_id, 'cs_1', 70000)).toBe('paid');
    expect(await pay(b.booking_id, 'cs_1', 70000)).toBe('already_paid');
    expect(await pay(b.booking_id, 'cs_1', 70000)).toBe('already_paid');
    const row = await one<{ status: string; payment_status: string }>('select status, payment_status from bookings where id=$1', [b.booking_id]);
    expect(row).toEqual({ status: 'confirmed', payment_status: 'paid' });
    const counts = await one<{ emails: number; payments: number; drivers: number; kind: string }>(
      `select (select count(*)::int from email_outbox where booking_id=$1 and template='payment_confirmed') as emails,
              (select count(*)::int from payments where booking_id=$1) as payments,
              (select count(*)::int from drivers where booking_id=$1) as drivers,
              (select kind from occupancy where booking_id=$1) as kind`,
      [b.booking_id],
    );
    expect(counts).toEqual({ emails: 1, payments: 1, drivers: 1, kind: 'booking' });
    // a paid booking can no longer be released as an abandoned hold
    expect((await one<{ r: boolean }>('select public.release_booking_hold($1) as r', [b.booking_id])).r).toBe(false);
  });

  it('re-secures the unit for a late payment when it is still free', async () => {
    const b = await hold(serena, at(60), at(61), 'late1@example.test');
    await db.query('select public.release_booking_hold($1)', [b.booking_id]);
    expect(await pay(b.booking_id, 'cs_late1', 35000)).toBe('paid');
  });

  it('never double-books: a late payment for a taken unit is flagged for refund', async () => {
    const b = await hold(serena, at(70), at(71), 'late2@example.test');
    await db.query('select public.release_booking_hold($1)', [b.booking_id]);
    const winner = await hold(serena, at(70), at(71), 'winner@example.test');
    expect(await pay(winner.booking_id, 'cs_winner', 35000)).toBe('paid');
    expect(await pay(b.booking_id, 'cs_late2', 35000)).toBe('needs_attention');
    expect(await pay(b.booking_id, 'cs_late2', 35000)).toBe('needs_attention');
    const row = await one<{ status: string; payment_status: string; attention_reason: string }>(
      'select status, payment_status, attention_reason from bookings where id=$1',
      [b.booking_id],
    );
    expect(row).toEqual({ status: 'expired', payment_status: 'needs_attention', attention_reason: 'late_payment_unit_taken' });
    const alerts = await one<{ n: number }>(
      "select count(*)::int as n from email_outbox where booking_id=$1 and template='admin_payment_attention'",
      [b.booking_id],
    );
    expect(alerts.n).toBe(1);
    const occ = await one<{ n: number }>('select count(*)::int as n from occupancy where booking_id=$1', [b.booking_id]);
    expect(occ.n).toBe(0);
  });

  it('refunds: idempotent per key and never more than was paid', async () => {
    const b = await hold(serena, at(80), at(82), 'refund@example.test');
    await pay(b.booking_id, 'cs_refund', 70000);
    const req = async (amount: number, key: string) =>
      (await one<{ r: { refund_id: string; duplicate: boolean } }>(
        'select public.request_refund($1,$2,$3,$4,null) as r',
        [b.booking_id, amount, 'Customer cancelled', key],
      )).r;
    const first = await req(30000, 'key-1');
    const again = await req(30000, 'key-1');
    expect(again).toMatchObject({ refund_id: first.refund_id, duplicate: true });
    await expect(req(50000, 'key-2')).rejects.toThrow(/EXCEEDS_PAID/);
    await db.query("update refunds set status='succeeded' where id=$1", [first.refund_id]);
    await db.query('select public.sync_refund_totals($1)', [b.booking_id]);
    expect(await one('select payment_status, refunded_sen from bookings where id=$1', [b.booking_id])).toEqual({
      payment_status: 'partially_refunded',
      refunded_sen: 30000,
    });
  });

  it('keeps the security deposit ledger separate from rental revenue', async () => {
    const b = await hold(serena, at(90), at(91), 'deposit@example.test');
    await pay(b.booking_id, 'cs_deposit', 35000);
    const dep = async (kind: string, amount: number, key: string, reason: string | null = null) =>
      (await one<{ r: string }>(
        'select public.record_deposit_transaction($1,$2,$3,$4,$5,$6,null) as r',
        [b.booking_id, kind, amount, 'cash', reason, key],
      )).r;
    expect(await dep('collected', 50000, 'd1')).toBe('recorded');
    expect(await dep('collected', 50000, 'd1')).toBe('duplicate');
    await expect(dep('deduction', 5000, 'd2')).rejects.toThrow(/REASON_REQUIRED/);
    expect(await dep('deduction', 5000, 'd2', 'Fuel short by one bar')).toBe('recorded');
    await expect(dep('returned', 50000, 'd3')).rejects.toThrow(/EXCEEDS_COLLECTED/);
    expect(await dep('returned', 45000, 'd3')).toBe('recorded');
    const row = await one<{ deposit_status: string; payment_status: string; rental_total_sen: number }>(
      'select deposit_status, payment_status, rental_total_sen from bookings where id=$1',
      [b.booking_id],
    );
    expect(row).toEqual({ deposit_status: 'settled', payment_status: 'paid', rental_total_sen: 35000 });
    const revenue = await one<{ n: number }>(
      "select coalesce(sum(amount_sen),0)::int as n from payments where booking_id=$1 and status='succeeded'",
      [b.booking_id],
    );
    expect(revenue.n).toBe(35000);
  });
});

describe('admin booking changes', () => {
  it('rejects a move onto occupied dates and applies a free one', async () => {
    const a = await hold(serena, at(100), at(101), 'move-a@example.test');
    const b = await hold(serena, at(103), at(104), 'move-b@example.test');
    await db.query('select public.record_payment_success($1,$2,$3,$4)', [a.booking_id, 'cs_ma', 'pi_ma', 35000]);
    await db.query('select public.record_payment_success($1,$2,$3,$4)', [b.booking_id, 'cs_mb', 'pi_mb', 35000]);
    await expect(
      db.query('select public.move_booking($1,$2,$3,$4,null)', [a.booking_id, unit, at(103, 12), at(104, 12)]),
    ).rejects.toThrow(/UNAVAILABLE/);
    await db.query('select public.move_booking($1,$2,$3,$4,null)', [a.booking_id, unit, at(106), at(108)]);
    expect(await one('select days, details_version from bookings where id=$1', [a.booking_id])).toEqual({ days: 2, details_version: 2 });
    expect((await one<{ r: boolean }>("select public.cancel_booking($1,'test',null) as r", [b.booking_id])).r).toBe(true);
    expect((await one<{ n: number }>('select count(*)::int as n from occupancy where booking_id=$1', [b.booking_id])).n).toBe(0);
  });

  it('creates a manual booking only when the unit is free', async () => {
    const args = [unit, at(110), at(112), 'Walk In', 'walkin@example.test', '0111111111', 'ms', 70000, 50000, null];
    const made = await one<{ r: { reference: string } }>(
      'select public.create_manual_booking($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as r',
      args,
    );
    expect(made.r.reference).toMatch(/^BCR-/);
    await expect(db.query('select public.create_manual_booking($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', args)).rejects.toThrow(/UNAVAILABLE/);
  });
});

describe('row level security', () => {
  let renterA: string;
  let renterB: string;
  let admin: string;
  let bookingA: string;
  let bookingB: string;

  beforeAll(async () => {
    renterA = await createUser(db, 'renter-a@example.test');
    renterB = await createUser(db, 'renter-b@example.test');
    admin = await createUser(db, 'owner@example.test', true);
    bookingA = (await hold(serena, at(120), at(121), 'renter-a@example.test')).booking_id;
    bookingB = (await hold(serena, at(123), at(124), 'renter-b@example.test')).booking_id;
    for (const [id, session] of [[bookingA, 'cs_ra'], [bookingB, 'cs_rb']]) {
      await db.query('select public.record_payment_success($1,$2,$3,$4)', [id, session, 'pi_' + session, 35000]);
    }
    await db.query('update bookings set renter_id=$1 where id=$2', [renterA, bookingA]);
    await db.query('update bookings set renter_id=$1 where id=$2', [renterB, bookingB]);
    const template = (await one<{ id: string }>("select id from agreement_templates where locale='ms'")).id;
    for (const id of [bookingA, bookingB]) {
      const driver = (await one<{ id: string }>('select id from drivers where booking_id=$1', [id])).id;
      await db.query(
        `insert into documents (booking_id, driver_id, kind, storage_path, mime_type, size_bytes) values ($1,$2,'licence',$3,'image/jpeg',1000)`,
        [id, driver, `${id}/licence.jpg`],
      );
      await db.query(
        `insert into agreements (booking_id, version, template_id, locale, title, rendered_body, details_hash, status) values ($1,1,$2,'ms','t','b','h','signed')`,
        [id, template],
      );
    }
  });

  const count = async (table: string) => (await one<{ n: number }>(`select count(*)::int as n from ${table}`)).n;

  it('shows a renter only their own booking, documents, agreement and payments', async () => {
    await asUser(db, renterA, async () => {
      const { rows } = await db.query<{ id: string }>('select id from bookings');
      expect(rows.map((r) => r.id)).toEqual([bookingA]);
      for (const table of ['drivers', 'documents', 'agreements', 'payments']) {
        expect(await count(table)).toBe(1);
        expect((await one<{ booking_id: string }>(`select booking_id from ${table}`)).booking_id).toBe(bookingA);
      }
      expect((await db.query('select 1 from documents where booking_id=$1', [bookingB])).rows).toHaveLength(0);
      expect((await db.query('select 1 from agreements where booking_id=$1', [bookingB])).rows).toHaveLength(0);
    });
  });

  it('hides private tables from renters and everything but the catalogue from visitors', async () => {
    await asUser(db, renterA, async () => {
      for (const table of ['vehicles', 'occupancy', 'app_settings', 'audit_log', 'email_outbox', 'agreement_templates']) {
        expect(await count(table)).toBe(0);
      }
      expect(await count('profiles')).toBe(1);
    });
    await asUser(db, null, async () => {
      expect(await count('vehicle_models')).toBe(3);
      await expect(db.query('select 1 from bookings')).rejects.toThrow(/permission denied/);
      await expect(db.query('select 1 from vehicles')).rejects.toThrow(/permission denied/);
    });
    await db.query("update vehicle_models set status='hidden' where slug='toyota-alphard'");
    await asUser(db, null, async () => expect(await count('vehicle_models')).toBe(2));
    await db.query("update vehicle_models set status='preview' where slug='toyota-alphard'");
  });

  it('blocks renters from writing roles, prices, payment state, decisions and from calling server functions', async () => {
    await asUser(db, renterA, async () => {
      const denied = [
        `update profiles set role='admin'`,
        `update bookings set payment_status='paid', rental_total_sen=1`,
        `update vehicle_models set daily_rate_sen=1`,
        `update drivers set status='approved'`,
        `insert into verification_decisions (booking_id, driver_id, decision) select booking_id, id, 'approved' from drivers`,
        `delete from documents`,
        `insert into occupancy (vehicle_id, period, kind) select vehicle_id, tstzrange(now(), now() + interval '1 day', '[)'), 'block' from bookings`,
      ];
      for (const sql of denied) await expect(db.query(sql), sql).rejects.toThrow(/permission denied/);
      await expect(db.query('select public.record_payment_success($1,$2,$3,$4)', [bookingA, 'x', 'y', 1])).rejects.toThrow(/permission denied/);
      await expect(
        db.query('select public.create_booking_hold($1,$2,$3,$4,$5,$6,$7)', [serena, at(200), at(201), 'x', 'x@example.test', '1', 'ms']),
      ).rejects.toThrow(/permission denied/);
      await expect(db.query('select public.request_refund($1,$2,$3,$4,null)', [bookingA, 100, 'x', 'k'])).rejects.toThrow(/permission denied/);
    });
    expect((await one<{ role: string }>('select role from profiles where id=$1', [renterA])).role).toBe('renter');
  });

  it('lets an admin read across renters', async () => {
    await asUser(db, admin, async () => {
      expect(await count('bookings')).toBeGreaterThan(2);
      expect(await count('vehicles')).toBe(1);
      expect(await count('agreement_templates')).toBe(2);
    });
  });
});
