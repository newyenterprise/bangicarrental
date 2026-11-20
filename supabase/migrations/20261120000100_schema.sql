-- Bangi Car Rental: core schema.
-- Money is integer sen. Timestamps are timestamptz. Rental operations use Asia/Kuala_Lumpur.

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Profiles and roles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'renter' check (role in ('renter', 'admin')),
  locale text not null default 'ms' check (locale in ('ms', 'en')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Business settings (singleton row)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id int primary key default 1 check (id = 1),
  company_name text not null default '',
  display_name text not null default 'Bangi Car Rental',
  contact_phone text not null default '',
  contact_email text not null default '',
  pickup_area text not null default 'Bangi',
  pickup_instructions_ms text not null default '',
  pickup_instructions_en text not null default '',
  operating_hours_ms text not null default '',
  operating_hours_en text not null default '',
  cancellation_terms_ms text not null default '',
  cancellation_terms_en text not null default '',
  lead_time_hours int not null default 12 check (lead_time_hours >= 0),
  verification_deadline_hours int not null default 24 check (verification_deadline_hours >= 0),
  hold_minutes int not null default 30 check (hold_minutes between 30 and 120),
  max_rental_days int not null default 30 check (max_rental_days between 1 and 365),
  document_retention_days int not null default 180 check (document_retention_days >= 0),
  email_from text not null default '',
  email_reply_to text not null default '',
  admin_alert_email text not null default '',
  rates_confirmed boolean not null default false,
  deposit_confirmed boolean not null default false,
  live_payments_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

-- ---------------------------------------------------------------------------
-- Fleet: public model listings and private physical units
-- ---------------------------------------------------------------------------
create table public.vehicle_models (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  seats int not null check (seats between 1 and 20),
  transmission text not null default 'automatic' check (transmission in ('automatic', 'manual')),
  tagline_ms text not null default '',
  tagline_en text not null default '',
  image_url text not null default '',
  daily_rate_sen int not null default 0 check (daily_rate_sen >= 0),
  deposit_sen int not null default 0 check (deposit_sen >= 0),
  prep_buffer_minutes int not null default 0 check (prep_buffer_minutes between 0 and 2880),
  status text not null default 'hidden' check (status in ('hidden', 'preview', 'bookable')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.vehicle_models (id) on delete restrict,
  label text not null default '',
  registration_no text not null default '',
  model_year int,
  colour text not null default '',
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index vehicles_model_idx on public.vehicles (model_id);

-- ---------------------------------------------------------------------------
-- Bookings. Each status dimension is kept separate.
-- ---------------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  renter_id uuid references auth.users (id) on delete set null,
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  locale text not null default 'ms' check (locale in ('ms', 'en')),
  source text not null default 'online' check (source in ('online', 'manual')),
  model_id uuid not null references public.vehicle_models (id),
  vehicle_id uuid not null references public.vehicles (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- lifecycle of the reservation itself
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'confirmed', 'cancelled', 'expired')),
  -- rental charge only (never the deposit)
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'processing', 'paid', 'partially_refunded', 'refunded', 'needs_attention')),
  rental_status text not null default 'not_started'
    check (rental_status in ('not_started', 'picked_up', 'returned')),
  deposit_status text not null default 'due'
    check (deposit_status in ('due', 'collected', 'settled', 'not_required')),
  attention_reason text,
  -- accepted quote snapshot; later rate changes never alter it
  days int not null check (days >= 1),
  daily_rate_sen int not null check (daily_rate_sen >= 0),
  rental_total_sen int not null check (rental_total_sen >= 0),
  deposit_sen int not null check (deposit_sen >= 0),
  quote jsonb not null default '{}'::jsonb,
  refunded_sen int not null default 0 check (refunded_sen >= 0),
  -- bumped whenever material rental details change (drives agreement re-signing)
  details_version int not null default 1,
  hold_expires_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index bookings_renter_idx on public.bookings (renter_id);
create index bookings_email_idx on public.bookings (lower(customer_email));
create index bookings_starts_idx on public.bookings (starts_at);
create index bookings_status_idx on public.bookings (status, payment_status);

-- ---------------------------------------------------------------------------
-- Occupancy: the single source of truth for who holds a physical unit and when.
-- Checkout holds, paid/manual bookings and admin blocks all live here, and the
-- exclusion constraint makes overlaps for one unit impossible.
-- Periods are half-open [start, end) so back-to-back rentals are allowed.
-- ---------------------------------------------------------------------------
create table public.occupancy (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete restrict,
  period tstzrange not null,
  kind text not null check (kind in ('hold', 'booking', 'block')),
  booking_id uuid unique references public.bookings (id) on delete cascade,
  reason text check (reason in ('personal', 'maintenance', 'other')),
  note text not null default '',
  expires_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (not isempty(period)),
  check (lower_inc(period) and not upper_inc(period)),
  check ((kind = 'block') = (booking_id is null)),
  constraint occupancy_no_overlap exclude using gist (vehicle_id with =, period with &&)
);
create index occupancy_expires_idx on public.occupancy (expires_at) where kind = 'hold';

-- ---------------------------------------------------------------------------
-- Drivers, documents, verification decisions
-- ---------------------------------------------------------------------------
create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  is_primary boolean not null default false,
  full_name text not null default '',
  id_type text not null default 'mykad' check (id_type in ('mykad', 'passport')),
  id_number text not null default '',
  date_of_birth date,
  phone text not null default '',
  address text not null default '',
  licence_number text not null default '',
  licence_expiry date,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'correction_requested')),
  correction_reason text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index drivers_booking_idx on public.drivers (booking_id);
create unique index drivers_one_primary on public.drivers (booking_id) where is_primary;

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  driver_id uuid not null references public.drivers (id) on delete cascade,
  kind text not null check (kind in ('identity', 'licence')),
  storage_path text not null unique,
  mime_type text not null,
  size_bytes int not null,
  status text not null default 'active' check (status in ('active', 'superseded', 'deleted')),
  uploaded_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index documents_driver_idx on public.documents (driver_id);
create index documents_booking_idx on public.documents (booking_id);

create table public.verification_decisions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  driver_id uuid not null references public.drivers (id) on delete cascade,
  decision text not null check (decision in ('approved', 'correction_requested')),
  reason text,
  decided_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index verification_decisions_driver_idx on public.verification_decisions (driver_id);

-- ---------------------------------------------------------------------------
-- Agreements: versioned templates and per-booking signed copies
-- ---------------------------------------------------------------------------
create table public.agreement_templates (
  id uuid primary key default gen_random_uuid(),
  locale text not null check (locale in ('ms', 'en')),
  version int not null,
  title text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  published_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (locale, version)
);
create unique index agreement_templates_one_published
  on public.agreement_templates (locale) where status = 'published';

create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  version int not null,
  template_id uuid not null references public.agreement_templates (id),
  locale text not null check (locale in ('ms', 'en')),
  title text not null,
  rendered_body text not null,
  details_hash text not null,
  status text not null default 'pending_signature'
    check (status in ('pending_signature', 'signed', 'superseded')),
  signed_at timestamptz,
  signer_user_id uuid references auth.users (id),
  signer_name text,
  signer_email text,
  signer_ip text,
  signer_user_agent text,
  signature_path text,
  pdf_path text,
  created_at timestamptz not null default now(),
  unique (booking_id, version)
);
create unique index agreements_one_current
  on public.agreements (booking_id) where status in ('pending_signature', 'signed');

-- ---------------------------------------------------------------------------
-- Payments (rental charge), provider events, refunds
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  provider text not null default 'stripe' check (provider in ('stripe', 'manual')),
  checkout_session_id text unique,
  payment_intent_id text,
  amount_sen int not null check (amount_sen >= 0),
  currency text not null default 'myr',
  status text not null default 'open'
    check (status in ('open', 'processing', 'succeeded', 'failed', 'expired')),
  method text,
  receipt_url text,
  note text,
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index payments_booking_idx on public.payments (booking_id);
create index payments_intent_idx on public.payments (payment_intent_id);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  type text not null,
  booking_id uuid references public.bookings (id) on delete set null,
  outcome text,
  created_at timestamptz not null default now()
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  payment_id uuid not null references public.payments (id),
  amount_sen int not null check (amount_sen > 0),
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  idempotency_key text not null unique,
  provider_refund_id text unique,
  failure_reason text,
  requested_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index refunds_booking_idx on public.refunds (booking_id);

-- ---------------------------------------------------------------------------
-- Renter requests (cancellation / date change). A request never changes
-- inventory or money by itself; an admin decision does.
-- ---------------------------------------------------------------------------
create table public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  kind text not null check (kind in ('cancellation', 'date_change')),
  requested_starts_at timestamptz,
  requested_ends_at timestamptz,
  message text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  admin_response text,
  created_by uuid references auth.users (id),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index booking_requests_booking_idx on public.booking_requests (booking_id);
create unique index booking_requests_one_pending
  on public.booking_requests (booking_id, kind) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Handover (pickup / return) and the security deposit ledger.
-- The deposit is tracked separately from rental revenue.
-- ---------------------------------------------------------------------------
create table public.handovers (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  kind text not null check (kind in ('pickup', 'return')),
  mileage_km int check (mileage_km >= 0),
  fuel_eighths int check (fuel_eighths between 0 and 8),
  notes text not null default '',
  recorded_by uuid references auth.users (id),
  recorded_at timestamptz not null default now(),
  unique (booking_id, kind)
);

create table public.handover_photos (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  storage_path text not null unique,
  uploaded_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index handover_photos_handover_idx on public.handover_photos (handover_id);

create table public.deposit_transactions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  kind text not null check (kind in ('collected', 'deduction', 'returned')),
  amount_sen int not null check (amount_sen > 0),
  method text,
  reason text,
  idempotency_key text not null unique,
  recorded_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index deposit_transactions_booking_idx on public.deposit_transactions (booking_id);

-- ---------------------------------------------------------------------------
-- Email outbox (retried by the scheduled task; dedupe_key stops duplicates)
-- ---------------------------------------------------------------------------
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  to_email text not null,
  locale text not null default 'ms' check (locale in ('ms', 'en')),
  template text not null,
  data jsonb not null default '{}'::jsonb,
  booking_id uuid references public.bookings (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts int not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_outbox_due_idx on public.email_outbox (next_attempt_at) where status in ('pending', 'sending');

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  actor_role text not null default 'system',
  action text not null,
  booking_id uuid references public.bookings (id) on delete set null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_booking_idx on public.audit_log (booking_id, created_at desc);
create index audit_log_created_idx on public.audit_log (created_at desc);
