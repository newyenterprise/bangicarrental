// Removes fictional test data before launch.
//
//   pnpm cleanup:test-data                 dry run: shows what would be removed
//   pnpm cleanup:test-data --confirm       removes records for *@example.test only
//   pnpm cleanup:test-data --all --confirm=WIPE-ALL-BOOKINGS
//                                          removes EVERY booking, payment record, email
//                                          and audit entry (use once, before the first
//                                          real customer; never after)
//
// Fleet, settings, agreement templates and admin accounts are never touched.
// Nothing is deleted without --confirm.
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local', quiet: true });
config({ quiet: true });

const args = process.argv.slice(2);
const all = args.includes('--all');
const confirmArg = args.find((a) => a.startsWith('--confirm'));
const confirmed = all ? confirmArg === '--confirm=WIPE-ALL-BOOKINGS' : confirmArg === '--confirm';
const TEST_DOMAIN = '@example.test';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example).');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
console.log(`Project: ${new URL(url).host}`);

let query = db.from('bookings').select('id, reference, customer_email, status');
if (!all) query = query.like('customer_email', `%${TEST_DOMAIN}`);
const { data: bookings, error } = await query;
if (error) throw new Error(`Could not read bookings: ${error.message}`);

const { data: usersPage } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
const testUsers = (usersPage?.users ?? []).filter((u) => u.email?.toLowerCase().endsWith(TEST_DOMAIN));

console.log(`${all ? 'ALL bookings' : `Bookings for *${TEST_DOMAIN}`}: ${bookings.length}`);
console.log(`Test accounts (*${TEST_DOMAIN}): ${testUsers.length}`);

if (!confirmed) {
  console.log('\nDry run only. Nothing was deleted.');
  console.log(all ? 'To proceed: --all --confirm=WIPE-ALL-BOOKINGS' : 'To proceed: --confirm');
  process.exit(0);
}

async function emptyFolder(bucket, prefix) {
  const { data: entries } = await db.storage.from(bucket).list(prefix, { limit: 1000 });
  for (const entry of entries ?? []) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id === null) await emptyFolder(bucket, path);
    else await db.storage.from(bucket).remove([path]);
  }
}

for (const booking of bookings) {
  for (const bucket of ['renter-documents', 'agreements', 'handover-photos']) await emptyFolder(bucket, booking.id);
}
const ids = bookings.map((b) => b.id);
for (let i = 0; i < ids.length; i += 100) {
  const chunk = ids.slice(i, i + 100);
  // Child rows (drivers, documents, payments, refunds, occupancy, outbox...) cascade.
  const { error: deleteError } = await db.from('bookings').delete().in('id', chunk);
  if (deleteError) throw new Error(`Could not delete bookings: ${deleteError.message}`);
}
if (all) {
  await db.from('payment_events').delete().not('id', 'is', null);
  await db.from('email_outbox').delete().not('id', 'is', null);
  await db.from('audit_log').delete().not('id', 'is', null);
  await db.from('occupancy').delete().eq('kind', 'hold');
}
for (const user of testUsers) await db.auth.admin.deleteUser(user.id);

console.log(`Removed ${bookings.length} booking(s) and ${testUsers.length} test account(s).`);
