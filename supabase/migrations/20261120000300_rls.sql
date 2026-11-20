-- Bangi Car Rental: Row Level Security.
--
-- Model: every write goes through server-side code using the service role
-- (after it has checked who is asking). Renters and admins therefore get
-- SELECT policies only; there are deliberately no INSERT/UPDATE/DELETE
-- policies, so a renter can never change roles, prices, payment state,
-- verification decisions or someone else's records through the API.

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.vehicle_models enable row level security;
alter table public.vehicles enable row level security;
alter table public.bookings enable row level security;
alter table public.occupancy enable row level security;
alter table public.drivers enable row level security;
alter table public.documents enable row level security;
alter table public.verification_decisions enable row level security;
alter table public.agreement_templates enable row level security;
alter table public.agreements enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.refunds enable row level security;
alter table public.booking_requests enable row level security;
alter table public.handovers enable row level security;
alter table public.handover_photos enable row level security;
alter table public.deposit_transactions enable row level security;
alter table public.email_outbox enable row level security;
alter table public.audit_log enable row level security;

-- Table privileges: read-only for API roles, nothing for anon except the catalogue.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.vehicle_models to anon, authenticated;
grant select on
  public.profiles, public.bookings, public.drivers, public.documents,
  public.verification_decisions, public.agreements, public.payments, public.refunds,
  public.booking_requests, public.handovers, public.deposit_transactions,
  public.app_settings, public.vehicles, public.occupancy, public.agreement_templates,
  public.payment_events, public.handover_photos, public.email_outbox, public.audit_log
  to authenticated;
grant all on all tables in schema public to service_role;

create or replace function public.owns_booking(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.bookings b where b.id = p_booking_id and b.renter_id = auth.uid()
  );
$$;
revoke all on function public.owns_booking(uuid) from public, anon;
grant execute on function public.owns_booking(uuid) to authenticated, service_role;

-- Public catalogue: never hidden models.
create policy "catalogue is public" on public.vehicle_models
  for select to anon, authenticated
  using (status in ('preview', 'bookable') or public.is_admin());

-- Own profile.
create policy "own profile" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- Renter-owned records.
create policy "own bookings" on public.bookings
  for select to authenticated
  using (renter_id = auth.uid() or public.is_admin());

create policy "own drivers" on public.drivers
  for select to authenticated
  using (public.owns_booking(booking_id) or public.is_admin());

create policy "own documents" on public.documents
  for select to authenticated
  using (public.owns_booking(booking_id) or public.is_admin());

create policy "own verification decisions" on public.verification_decisions
  for select to authenticated
  using (public.owns_booking(booking_id) or public.is_admin());

create policy "own agreements" on public.agreements
  for select to authenticated
  using (public.owns_booking(booking_id) or public.is_admin());

create policy "own payments" on public.payments
  for select to authenticated
  using (public.owns_booking(booking_id) or public.is_admin());

create policy "own refunds" on public.refunds
  for select to authenticated
  using (public.owns_booking(booking_id) or public.is_admin());

create policy "own requests" on public.booking_requests
  for select to authenticated
  using (public.owns_booking(booking_id) or public.is_admin());

create policy "own handovers" on public.handovers
  for select to authenticated
  using (public.owns_booking(booking_id) or public.is_admin());

create policy "own deposit ledger" on public.deposit_transactions
  for select to authenticated
  using (public.owns_booking(booking_id) or public.is_admin());

-- Admin-only tables.
create policy "admin reads settings" on public.app_settings
  for select to authenticated using (public.is_admin());
create policy "admin reads vehicles" on public.vehicles
  for select to authenticated using (public.is_admin());
create policy "admin reads occupancy" on public.occupancy
  for select to authenticated using (public.is_admin());
create policy "admin reads templates" on public.agreement_templates
  for select to authenticated using (public.is_admin());
create policy "admin reads payment events" on public.payment_events
  for select to authenticated using (public.is_admin());
create policy "admin reads handover photos" on public.handover_photos
  for select to authenticated using (public.is_admin());
create policy "admin reads outbox" on public.email_outbox
  for select to authenticated using (public.is_admin());
create policy "admin reads audit log" on public.audit_log
  for select to authenticated using (public.is_admin());
