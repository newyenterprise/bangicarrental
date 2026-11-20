// Grants the admin role to one email address.
//
//   pnpm admin:grant owner@example.com
//
// There is no shared or default admin password. The person signs in at /sign-in
// with a one-time code sent to this email; this script only marks that account
// as admin. Run it from a trusted machine with the service-role key in .env.local
// (or in the shell environment). It prints no secrets.
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local', quiet: true });
config({ quiet: true });

const email = (process.argv[2] ?? '').trim().toLowerCase();
const revoke = process.argv.includes('--revoke');
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: pnpm admin:grant <email> [--revoke]');
  process.exit(1);
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example).');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUser() {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not list users: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  return null;
}

let user = await findUser();
if (!user && !revoke) {
  // No password is set: the account can only be used through the emailed one-time code.
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw new Error(`Could not create the account: ${error.message}`);
  user = data.user;
  console.log(`Created an account for ${email}.`);
}
if (!user) {
  console.error(`No account found for ${email}.`);
  process.exit(1);
}

const role = revoke ? 'renter' : 'admin';
const { error } = await db.from('profiles').upsert({ id: user.id, role }, { onConflict: 'id' });
if (error) throw new Error(`Could not update the role: ${error.message}`);
await db.from('audit_log').insert({ actor_role: 'system', action: revoke ? 'admin.revoked' : 'admin.granted', entity_type: 'profile', entity_id: user.id });

console.log(`${email} is now ${role === 'admin' ? 'an admin' : 'a renter (admin removed)'}.`);
console.log('Sign in at /sign-in with this email to receive a one-time code.');
