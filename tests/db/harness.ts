import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

/**
 * Embedded Postgres with just enough of the Supabase surface (roles, auth and
 * storage schemas) to run the real migration files. It verifies the SQL
 * itself: constraints, functions and RLS policies. It is single-connection,
 * so true concurrency is covered by tests/integration against a real project.
 */
const SHIM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
grant usage on schema public, auth to anon, authenticated, service_role;
`;

export const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

export async function createTestDb() {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(SHIM);
  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return db;
}

/** Runs fn as a signed-in API user (RLS applies), then restores the superuser. */
export async function asUser<T>(db: PGlite, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${userId ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${userId ?? ''}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

export async function createUser(db: PGlite, email: string, admin = false): Promise<string> {
  const { rows } = await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email]);
  if (admin) await db.query("update public.profiles set role = 'admin' where id = $1", [rows[0].id]);
  return rows[0].id;
}
