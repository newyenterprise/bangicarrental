# Bangi Car Rental

Bilingual (Bahasa Melayu / English) car rental booking site for **bangicarrental.my**: public catalogue and booking, Stripe Checkout in MYR, a renter dashboard ("Tempahan saya") and an owner admin dashboard.

- **Stack:** Next.js 16 (App Router, TypeScript, Tailwind 4), Supabase (Postgres, Auth, private Storage, RLS), Stripe Checkout, Resend, Docker on Coolify.
- **Time zone:** all rental times are Asia/Kuala_Lumpur. Timestamps are stored with time zone; money is stored as integer sen.
- **Design reference:** `design/Bangi-Car-Rental.html`. The three vehicle illustrations in `public/vehicles/` come from it.

## How it fits together

| Area | Where |
|---|---|
| Public site, booking, payment return | `src/app/(site)` |
| Renter dashboard | `src/app/(site)/bookings` |
| Admin dashboard | `src/app/admin` |
| Stripe webhook, scheduler, health, private file links | `src/app/api` |
| Business rules (pricing, holds, payments, refunds, deposit) | `supabase/migrations/*_functions.sql` |
| Access rules (RLS) and storage buckets | `supabase/migrations/*_rls.sql`, `*_storage.sql` |
| Copy in both languages | `src/lib/i18n/ms.ts`, `en.ts` |

Key rules, all enforced in the database:

- **One occupancy table** holds checkout holds, paid and manual bookings and admin blocks. An exclusion constraint makes overlapping periods for the same physical car impossible, even under concurrent requests. Periods are half-open, plus the model's turnaround time.
- **Prices and availability are derived on the server.** A partial 24-hour period rounds up to a full day. The accepted quote is stored on the booking, so later rate changes never alter it.
- **A booking is only marked paid** by a signature-verified Stripe webhook or by the server asking Stripe directly. Replayed or out-of-order events are harmless. A late payment for a car that is no longer free is recorded, flagged for the admin and never confirmed.
- **Renters can only read their own records** (RLS). Every write goes through server code. Identity documents, signed agreements and condition photos are in private buckets and are only reachable through 60-second links issued after an ownership check.

## Local setup

Requirements: Node 22+, pnpm 10, a Supabase project for Bangi Car Rental. Docker is not needed locally.

```bash
pnpm install
cp .env.example .env.local      # then fill in the values (see comments in the file)
pnpm db:push                    # applies supabase/migrations to the linked project (see below)
pnpm dev                        # http://localhost:3000
```

For local development set `APP_URL=http://localhost:3000` and, if you have no Resend key yet, `EMAIL_DELIVERY=log`.

## Supabase

1. Create a **dedicated** project (region Singapore is closest). Never point this app at another product's project.
2. Apply the migrations, in order, with the Supabase CLI:
   ```bash
   supabase link --project-ref <project-ref>
   pnpm db:push
   ```
   The migrations create the schema, functions, RLS policies, storage buckets and starting data: three models (Serena bookable, Vellfire and Alphard as previews), one Serena unit and draft agreement templates. They create no customers, bookings or admin accounts.
3. **Authentication > Sign In / Providers > Email:** keep email enabled, set the OTP length to **6** and turn off "Confirm email" double opt-in prompts if shown. No password sign-in is used.
4. **Authentication > Emails > Templates:** paste `supabase/templates/otp-email.html` into both "Magic Link" and "Confirm signup". The email must show `{{ .Token }}`.
5. **Authentication > Emails > SMTP Settings:** add Resend as custom SMTP (host `smtp.resend.com`, port `465`, user `resend`, password = Resend API key, sender on your verified domain). The built-in Supabase mailer is rate-limited and only delivers to project members, so real renters cannot sign in until this is done.
6. **Authentication > URL Configuration:** Site URL `https://bangicarrental.my`; add redirect URLs `https://bangicarrental.my/**` and `http://localhost:3000/**`.
7. Copy the project URL, the anon/publishable key and the service-role key into the environment variables.

**Migration history on the production project:** the first setup was applied through the Supabase connector (and `supabase/manual/release_and_cancel.sql` by hand), so the versions recorded in the project do not match the file names in `supabase/migrations`. Before the first `pnpm db:push`, mark the existing files as applied: `supabase migration repair --status applied 20261120000100 20261120000200 20261120000300 20261120000400 20261120000500`, and mark the connector-created versions shown by `supabase migration list` as reverted.

New tables added later get no API access by default only if you keep the pattern in `*_rls.sql`: enable RLS, revoke from `anon`/`authenticated`, grant `select` where needed.

## First admin

There is no default or shared admin password. Sign-in is always a one-time 6-digit code sent by email; the admin role is a flag in the database that only the service role can set.

```bash
pnpm admin:grant owner@yourdomain.com     # run once, from a trusted machine with .env.local filled in
```

Then open `/sign-in`, enter that email and the code. Admins land on `/admin`. To remove the role: `pnpm admin:grant owner@yourdomain.com --revoke`.

Alternative without the script (Supabase SQL editor), after the person has signed in once:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'owner@yourdomain.com');
```

## Tests

| Command | What it checks | Needs |
|---|---|---|
| `pnpm typecheck` | TypeScript | nothing |
| `pnpm lint` | ESLint | nothing |
| `pnpm test` | Unit tests, plus the real migration files run in an embedded Postgres: overlap prevention, preview models rejected, abandoned checkout release, duplicate payment events, late payments, refunds, deposit ledger, RLS for two renters | nothing |
| `RUN_SUPABASE_TESTS=1 pnpm test:integration` | The same rules on the real project over separate connections: concurrent customers, real Auth sessions, private Storage | `.env.local` with Supabase keys |
| `pnpm test:e2e` | Browser tests at phone and desktop widths in both languages | running app + Supabase (+ `pnpm exec playwright install chromium` once) |
| `pnpm build` | Production build | nothing |

The browser tests include the full renter and admin journey (`tests/e2e/journey.spec.ts`). Point them at a deployed site with `E2E_BASE_URL=https://bangicarrental.my pnpm test:e2e`; that is more reliable than the dev server, which reloads pages while compiling. A real Stripe test-mode payment is opt-in: `RUN_STRIPE_CHECKOUT=1 pnpm exec playwright test tests/e2e/checkout.spec.ts --project=desktop`.

Tests only create `*@example.test` records. Remove them with `pnpm cleanup:test-data` (dry run) then `--confirm`.

## Stripe test mode

1. In the Bangi Stripe account (Malaysia, MYR), switch to **Test mode** and copy the secret key (`sk_test_...`) into `STRIPE_SECRET_KEY`.
2. **Developers > Webhooks > Add endpoint:** `https://bangicarrental.my/api/stripe/webhook`, events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`.
   Copy its signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.
3. Local webhooks: `stripe listen --forward-to localhost:3000/api/stripe/webhook` and use the secret it prints.
4. Test card `4242 4242 4242 4242`, any future expiry, any CVC. FPX appears in Checkout when it is enabled under **Settings > Payment methods**.

While a test key is configured the site shows a yellow "test mode" banner and bookings are open so the journey can be rehearsed. With a live key, checkout stays closed until the launch checklist is complete **and** "Enable live payments" is switched on in Admin > Settings.

## Coolify deployment

The image is a multi-stage build of the Next.js standalone output (`Dockerfile`). The container is stateless; all data and uploads live in Supabase.

**Environment variables:** none are needed at build time. All values in `.env.example` are runtime variables: add them in Coolify > Application > Environment Variables and leave "Build Variable" unticked. Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `CRON_SECRET`.

**Application settings**

| Setting | Value |
|---|---|
| Source | `https://github.com/newyenterprise/bangicarrental`, branch `main` |
| Build pack | Dockerfile (`/Dockerfile`) |
| Port | `3000` |
| Domains | `https://bangicarrental.my,https://www.bangicarrental.my` (the app redirects `www` to the bare domain) |
| Health check | `GET /api/health`, host `127.0.0.1` (not `localhost`, which resolves to IPv6 inside the container), port 3000, expect 200 |

**Scheduled task** (Coolify > Application > Scheduled Tasks): name `tick`, frequency `* * * * *`, command `node cron-tick.mjs`. It runs inside the app container and calls `/api/cron/tick` with `Authorization: Bearer $CRON_SECRET`. Each run releases expired checkout holds (after closing and re-checking the Stripe session), retries queued emails and, once an hour, applies document retention. Runs are idempotent and safe across restarts and deployments.

**DNS (Cloudflare):** `A bangicarrental.my -> <server IP>` and `CNAME www -> bangicarrental.my`, both proxied, SSL mode Full (strict).

**Deploying a change, in this order**

1. Apply new database migrations first (`pnpm db:push`). Migrations must stay backward compatible with the image that is currently running: add columns and tables first, remove things only in a later release.
2. Push to `main` and deploy in Coolify.
3. Post-deployment checks:
   - `https://bangicarrental.my/api/health` returns 200, and `/api/health?deep=1` returns `"database":"ok"`.
   - The homepage loads in BM and switches to English.
   - `/sign-in` sends a code to your email and lands on `/admin`.
   - Admin > Today shows no failed emails; the scheduled task's last run succeeded.
   - Stripe > Webhooks shows successful deliveries.

**Rollback:** in Coolify open the application > Deployments (or Rollback) and redeploy the previous image. Because migrations are additive, the previous image keeps working against the newer schema. Do not roll the database back unless a migration itself is the fault.

## Launch settings

Admin > Today shows a checklist until every item is done. Live payments cannot be enabled before then.

- Company name and contact phone (Settings)
- Pickup instructions in BM and English (Settings): shown to a renter only once they are ready for pickup
- Cancellation terms in BM and English (Settings): shown before payment and copied into the agreement
- Real rental rate and deposit confirmed (Fleet). The seeded RM350/day and RM500 deposit are development values.
- Registration number for every bookable car (Fleet): used in the private agreement, never shown publicly
- Agreement reviewed and published in BM and English (Agreement). The seeded text is a starter draft, not legal advice.
- Sender email and Resend key; Stripe keys and webhook secret
- Before the first real customer: `pnpm cleanup:test-data --all --confirm=WIPE-ALL-BOOKINGS`, swap `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` to the live values, then switch on "Enable live payments".

Other settings: operating hours, minimum notice (lead time), verification deadline, checkout hold length, maximum rental length, document retention period, email identity.

## Adding the Vellfire or Alphard later

No code change is needed: Admin > Fleet > add a physical unit to the model, set its rate and deposit, then change its status from Preview to Bookable.
