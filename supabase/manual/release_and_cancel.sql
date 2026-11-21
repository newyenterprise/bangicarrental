-- Run this once in the Supabase SQL editor for the Bangi Car Rental project
-- (Dashboard > SQL Editor > paste > Run).
--
-- These two functions are part of supabase/migrations/20261120000200_functions.sql.
-- Everything else in that file was applied through the Supabase connector; these
-- two contain DELETE statements, which the connector will not run without an
-- interactive confirmation.

-- Releases an unpaid hold. Call only after the payment session is known to be closed.
create or replace function public.release_booking_hold(p_booking_id uuid, p_payment_status text default 'expired')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found or v_booking.status <> 'pending_payment' then
    return false;
  end if;
  delete from public.occupancy where booking_id = p_booking_id and kind = 'hold';
  update public.bookings
    set status = 'expired',
        payment_status = case when payment_status = 'needs_attention' then payment_status else 'unpaid' end,
        updated_at = now()
    where id = p_booking_id;
  update public.payments
    set status = case when p_payment_status = 'failed' then 'failed' else 'expired' end
    where booking_id = p_booking_id and status in ('open', 'processing');
  insert into public.audit_log (actor_role, action, booking_id, entity_type, entity_id, metadata)
  values ('system', 'booking.hold_released', p_booking_id, 'booking', p_booking_id::text,
          jsonb_build_object('payment_status', p_payment_status));
  return true;
end;
$$;

-- Admin: cancel a booking and free its unit. Refunds are a separate, explicit action.
create or replace function public.cancel_booking(p_booking_id uuid, p_reason text, p_actor uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found or v_booking.status in ('cancelled', 'expired') or v_booking.rental_status <> 'not_started' then
    return false;
  end if;
  delete from public.occupancy where booking_id = p_booking_id;
  update public.bookings
    set status = 'cancelled', cancelled_at = now(), cancellation_reason = p_reason, updated_at = now()
    where id = p_booking_id;
  update public.agreements set status = 'superseded'
    where booking_id = p_booking_id and status = 'pending_signature';
  insert into public.audit_log (actor_id, actor_role, action, booking_id, entity_type, entity_id, metadata)
  values (p_actor, 'admin', 'booking.cancelled', p_booking_id, 'booking', p_booking_id::text,
          jsonb_build_object('reason', p_reason));
  return true;
end;
$$;

-- Only the service role (server-side code) may call them.
revoke all on function public.release_booking_hold(uuid, text) from public, anon, authenticated;
grant execute on function public.release_booking_hold(uuid, text) to service_role;
revoke all on function public.cancel_booking(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.cancel_booking(uuid, text, uuid) to service_role;
