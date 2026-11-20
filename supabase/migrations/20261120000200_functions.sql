-- Bangi Car Rental: server-side business rules.
-- Every function here is callable by the service role only (see the grants at the end).
-- Business errors are raised with a short machine-readable message.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- A partial 24-hour period is rounded up to the next full day.
create or replace function public.rental_days(p_starts_at timestamptz, p_ends_at timestamptz)
returns int
language sql
immutable
as $$
  select greatest(1, ceil(extract(epoch from (p_ends_at - p_starts_at)) / 86400.0)::int);
$$;

create or replace function public.new_booking_reference()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_ref text;
  i int;
begin
  loop
    v_ref := 'BCR-';
    for i in 1..6 loop
      v_ref := v_ref || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.bookings where reference = v_ref);
  end loop;
  return v_ref;
end;
$$;

-- Server-derived quote. Raises when the model cannot be booked for the period.
create or replace function public.quote_rental(
  p_model_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_model public.vehicle_models;
  v_settings public.app_settings;
  v_days int;
begin
  select * into v_settings from public.app_settings where id = 1;
  select * into v_model from public.vehicle_models where id = p_model_id;
  if not found or v_model.status <> 'bookable' or v_model.daily_rate_sen <= 0 then
    raise exception 'MODEL_NOT_BOOKABLE';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'INVALID_PERIOD';
  end if;
  if p_starts_at < now() + make_interval(hours => v_settings.lead_time_hours) then
    raise exception 'LEAD_TIME';
  end if;
  v_days := public.rental_days(p_starts_at, p_ends_at);
  if v_days > v_settings.max_rental_days then
    raise exception 'TOO_LONG';
  end if;
  return jsonb_build_object(
    'model_id', v_model.id,
    'model_name', v_model.name,
    'starts_at', p_starts_at,
    'ends_at', p_ends_at,
    'days', v_days,
    'daily_rate_sen', v_model.daily_rate_sen,
    'rental_total_sen', v_days * v_model.daily_rate_sen,
    'deposit_sen', v_model.deposit_sen,
    'prep_buffer_minutes', v_model.prep_buffer_minutes,
    'rounding', 'partial_day_rounds_up',
    'currency', 'myr'
  );
end;
$$;

-- Advisory availability for the public site. The hold below is what actually secures a unit.
create or replace function public.model_is_available(
  p_model_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.vehicles v
    join public.vehicle_models m on m.id = v.model_id
    where v.model_id = p_model_id
      and v.active
      and m.status = 'bookable'
      and not exists (
        select 1 from public.occupancy o
        where o.vehicle_id = v.id
          and o.period && tstzrange(p_starts_at, p_ends_at + make_interval(mins => m.prep_buffer_minutes), '[)')
      )
  );
$$;

-- Atomically creates a pending booking plus a hold on one free physical unit.
create or replace function public.create_booking_hold(
  p_model_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_name text,
  p_email text,
  p_phone text,
  p_locale text,
  p_cancellation_terms text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote jsonb;
  v_settings public.app_settings;
  v_vehicle record;
  v_booking_id uuid;
  v_reference text;
  v_expires timestamptz;
  v_period tstzrange;
  v_pending int;
begin
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_email), '') = '' or coalesce(trim(p_phone), '') = '' then
    raise exception 'INVALID_CONTACT';
  end if;
  v_quote := public.quote_rental(p_model_id, p_starts_at, p_ends_at);
  select * into v_settings from public.app_settings where id = 1;

  select count(*) into v_pending
  from public.bookings
  where lower(customer_email) = lower(trim(p_email)) and status = 'pending_payment';
  if v_pending >= 2 then
    raise exception 'TOO_MANY_HOLDS';
  end if;

  -- The hold outlives the payment session by a short margin so the session is
  -- always closed (and reconciled) before the unit is released.
  v_expires := now() + make_interval(mins => v_settings.hold_minutes + 3);
  v_period := tstzrange(
    p_starts_at,
    p_ends_at + make_interval(mins => (v_quote ->> 'prep_buffer_minutes')::int),
    '[)'
  );
  v_reference := public.new_booking_reference();

  for v_vehicle in
    select id from public.vehicles where model_id = p_model_id and active order by created_at, id
  loop
    begin
      v_booking_id := gen_random_uuid();
      insert into public.bookings (
        id, reference, customer_name, customer_email, customer_phone, locale, source,
        model_id, vehicle_id, starts_at, ends_at, status, payment_status,
        deposit_status, days, daily_rate_sen, rental_total_sen, deposit_sen, quote, hold_expires_at
      ) values (
        v_booking_id, v_reference, trim(p_name), lower(trim(p_email)), trim(p_phone),
        case when p_locale = 'en' then 'en' else 'ms' end, 'online',
        p_model_id, v_vehicle.id, p_starts_at, p_ends_at, 'pending_payment', 'unpaid',
        case when (v_quote ->> 'deposit_sen')::int > 0 then 'due' else 'not_required' end,
        (v_quote ->> 'days')::int, (v_quote ->> 'daily_rate_sen')::int,
        (v_quote ->> 'rental_total_sen')::int, (v_quote ->> 'deposit_sen')::int,
        v_quote || jsonb_build_object('quoted_at', now(), 'cancellation_terms', coalesce(p_cancellation_terms, '')),
        v_expires
      );
      insert into public.occupancy (vehicle_id, period, kind, booking_id, expires_at)
      values (v_vehicle.id, v_period, 'hold', v_booking_id, v_expires);

      return jsonb_build_object(
        'booking_id', v_booking_id,
        'reference', v_reference,
        'hold_expires_at', v_expires,
        'hold_minutes', v_settings.hold_minutes,
        'quote', v_quote
      );
    exception when exclusion_violation then
      -- this unit is taken for the period; try the next one
      null;
    end;
  end loop;

  raise exception 'UNAVAILABLE';
end;
$$;

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

-- Records a verified successful payment. Idempotent: replays return 'already_paid'
-- and never create a second confirmation email. If the unit can no longer be
-- secured the payment is recorded and flagged for a refund; it is never
-- silently confirmed as a double booking.
create or replace function public.record_payment_success(
  p_booking_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_amount_sen int,
  p_method text default null,
  p_receipt_url text default null,
  p_livemode boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_model public.vehicle_models;
  v_secured boolean := false;
  v_reason text;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    return 'not_found';
  end if;

  insert into public.payments (
    booking_id, provider, checkout_session_id, payment_intent_id, amount_sen,
    status, method, receipt_url, livemode, paid_at
  ) values (
    p_booking_id, 'stripe', p_checkout_session_id, p_payment_intent_id, p_amount_sen,
    'succeeded', p_method, p_receipt_url, p_livemode, now()
  )
  on conflict (checkout_session_id) do update set
    status = 'succeeded',
    payment_intent_id = coalesce(excluded.payment_intent_id, public.payments.payment_intent_id),
    amount_sen = excluded.amount_sen,
    method = coalesce(excluded.method, public.payments.method),
    receipt_url = coalesce(excluded.receipt_url, public.payments.receipt_url),
    livemode = excluded.livemode,
    paid_at = coalesce(public.payments.paid_at, now());

  if v_booking.payment_status in ('paid', 'partially_refunded', 'refunded') then
    return 'already_paid';
  end if;
  if v_booking.payment_status = 'needs_attention' then
    return 'needs_attention';
  end if;

  if v_booking.status = 'cancelled' then
    v_reason := 'paid_after_cancellation';
  elsif p_amount_sen <> v_booking.rental_total_sen then
    v_reason := 'amount_mismatch';
  else
    update public.occupancy set kind = 'booking', expires_at = null where booking_id = p_booking_id;
    if found then
      v_secured := true;
    else
      -- the hold was already released (late payment): try to take the unit back
      select * into v_model from public.vehicle_models where id = v_booking.model_id;
      begin
        insert into public.occupancy (vehicle_id, period, kind, booking_id)
        values (
          v_booking.vehicle_id,
          tstzrange(v_booking.starts_at,
                    v_booking.ends_at + make_interval(mins => coalesce(v_model.prep_buffer_minutes, 0)), '[)'),
          'booking', p_booking_id
        );
        v_secured := true;
      exception when exclusion_violation then
        v_reason := 'late_payment_unit_taken';
      end;
    end if;
  end if;

  if not v_secured then
    update public.bookings
      set payment_status = 'needs_attention', attention_reason = v_reason,
          paid_at = now(), updated_at = now()
      where id = p_booking_id;
    insert into public.email_outbox (dedupe_key, to_email, locale, template, booking_id, data)
    values
      ('payment_attention_admin:' || p_booking_id, 'admin', 'ms', 'admin_payment_attention', p_booking_id,
       jsonb_build_object('reason', v_reason)),
      ('payment_attention_renter:' || p_booking_id, v_booking.customer_email, v_booking.locale,
       'payment_attention', p_booking_id, '{}'::jsonb)
    on conflict (dedupe_key) do nothing;
    insert into public.audit_log (actor_role, action, booking_id, entity_type, entity_id, metadata)
    values ('system', 'payment.needs_attention', p_booking_id, 'booking', p_booking_id::text,
            jsonb_build_object('reason', v_reason, 'amount_sen', p_amount_sen));
    return 'needs_attention';
  end if;

  update public.bookings
    set status = 'confirmed', payment_status = 'paid', attention_reason = null,
        paid_at = now(), hold_expires_at = null, updated_at = now()
    where id = p_booking_id;

  insert into public.drivers (booking_id, is_primary, full_name, phone)
  select p_booking_id, true, v_booking.customer_name, v_booking.customer_phone
  where not exists (select 1 from public.drivers where booking_id = p_booking_id and is_primary);

  insert into public.email_outbox (dedupe_key, to_email, locale, template, booking_id)
  values
    ('payment_confirmed:' || p_booking_id, v_booking.customer_email, v_booking.locale, 'payment_confirmed', p_booking_id),
    ('admin_booking_paid:' || p_booking_id, 'admin', 'ms', 'admin_booking_paid', p_booking_id)
  on conflict (dedupe_key) do nothing;

  insert into public.audit_log (actor_role, action, booking_id, entity_type, entity_id, metadata)
  values ('system', 'payment.succeeded', p_booking_id, 'booking', p_booking_id::text,
          jsonb_build_object('amount_sen', p_amount_sen, 'livemode', p_livemode));
  return 'paid';
end;
$$;

-- Admin: manual booking (phone / walk-in). Secures the unit in the same transaction.
create or replace function public.create_manual_booking(
  p_vehicle_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_name text,
  p_email text,
  p_phone text,
  p_locale text,
  p_rental_total_sen int,
  p_deposit_sen int,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle public.vehicles;
  v_model public.vehicle_models;
  v_booking_id uuid := gen_random_uuid();
  v_reference text;
  v_days int;
begin
  if p_ends_at <= p_starts_at then
    raise exception 'INVALID_PERIOD';
  end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_email), '') = '' then
    raise exception 'INVALID_CONTACT';
  end if;
  select * into v_vehicle from public.vehicles where id = p_vehicle_id;
  if not found then
    raise exception 'VEHICLE_NOT_FOUND';
  end if;
  select * into v_model from public.vehicle_models where id = v_vehicle.model_id;
  v_days := public.rental_days(p_starts_at, p_ends_at);
  v_reference := public.new_booking_reference();

  begin
    insert into public.bookings (
      id, reference, customer_name, customer_email, customer_phone, locale, source,
      model_id, vehicle_id, starts_at, ends_at, status, payment_status, deposit_status,
      days, daily_rate_sen, rental_total_sen, deposit_sen, quote
    ) values (
      v_booking_id, v_reference, trim(p_name), lower(trim(p_email)), coalesce(trim(p_phone), ''),
      case when p_locale = 'en' then 'en' else 'ms' end, 'manual',
      v_model.id, p_vehicle_id, p_starts_at, p_ends_at, 'confirmed', 'unpaid',
      case when p_deposit_sen > 0 then 'due' else 'not_required' end,
      v_days, case when v_days > 0 then p_rental_total_sen / v_days else 0 end,
      p_rental_total_sen, p_deposit_sen,
      jsonb_build_object('days', v_days, 'rental_total_sen', p_rental_total_sen,
                         'deposit_sen', p_deposit_sen, 'source', 'manual', 'quoted_at', now())
    );
    insert into public.occupancy (vehicle_id, period, kind, booking_id, created_by)
    values (
      p_vehicle_id,
      tstzrange(p_starts_at, p_ends_at + make_interval(mins => v_model.prep_buffer_minutes), '[)'),
      'booking', v_booking_id, p_actor
    );
  exception when exclusion_violation then
    raise exception 'UNAVAILABLE';
  end;

  insert into public.drivers (booking_id, is_primary, full_name, phone)
  values (v_booking_id, true, trim(p_name), coalesce(trim(p_phone), ''));

  insert into public.audit_log (actor_id, actor_role, action, booking_id, entity_type, entity_id)
  values (p_actor, 'admin', 'booking.manual_created', v_booking_id, 'booking', v_booking_id::text);

  return jsonb_build_object('booking_id', v_booking_id, 'reference', v_reference);
end;
$$;

-- Admin: move a booking to other dates and/or another unit. The exclusion
-- constraint rejects the move if it would overlap anything else.
create or replace function public.move_booking(
  p_booking_id uuid,
  p_vehicle_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_actor uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_vehicle public.vehicles;
  v_model public.vehicle_models;
begin
  if p_ends_at <= p_starts_at then
    raise exception 'INVALID_PERIOD';
  end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found or v_booking.status <> 'confirmed' or v_booking.rental_status <> 'not_started' then
    raise exception 'NOT_MOVABLE';
  end if;
  select * into v_vehicle from public.vehicles where id = p_vehicle_id;
  if not found then
    raise exception 'VEHICLE_NOT_FOUND';
  end if;
  select * into v_model from public.vehicle_models where id = v_vehicle.model_id;

  begin
    update public.occupancy
      set vehicle_id = p_vehicle_id,
          period = tstzrange(p_starts_at, p_ends_at + make_interval(mins => v_model.prep_buffer_minutes), '[)')
      where booking_id = p_booking_id;
    if not found then
      insert into public.occupancy (vehicle_id, period, kind, booking_id, created_by)
      values (p_vehicle_id,
              tstzrange(p_starts_at, p_ends_at + make_interval(mins => v_model.prep_buffer_minutes), '[)'),
              'booking', p_booking_id, p_actor);
    end if;
  exception when exclusion_violation then
    raise exception 'UNAVAILABLE';
  end;

  update public.bookings
    set vehicle_id = p_vehicle_id, model_id = v_model.id,
        starts_at = p_starts_at, ends_at = p_ends_at,
        days = public.rental_days(p_starts_at, p_ends_at),
        details_version = details_version + 1, updated_at = now()
    where id = p_booking_id;

  insert into public.audit_log (actor_id, actor_role, action, booking_id, entity_type, entity_id, metadata)
  values (p_actor, 'admin', 'booking.moved', p_booking_id, 'booking', p_booking_id::text,
          jsonb_build_object(
            'from', jsonb_build_object('vehicle_id', v_booking.vehicle_id, 'starts_at', v_booking.starts_at, 'ends_at', v_booking.ends_at),
            'to', jsonb_build_object('vehicle_id', p_vehicle_id, 'starts_at', p_starts_at, 'ends_at', p_ends_at)));
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

-- Admin: reserve a refund amount. The booking row lock plus the unique
-- idempotency key stop double clicks and concurrent requests over-refunding.
create or replace function public.request_refund(
  p_booking_id uuid,
  p_amount_sen int,
  p_reason text,
  p_idempotency_key text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_payment public.payments;
  v_existing public.refunds;
  v_committed int;
  v_refund_id uuid;
begin
  if p_amount_sen is null or p_amount_sen <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED';
  end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  select * into v_existing from public.refunds where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('refund_id', v_existing.id, 'duplicate', true, 'status', v_existing.status,
                              'payment_id', v_existing.payment_id);
  end if;

  select * into v_payment from public.payments
    where booking_id = p_booking_id and status = 'succeeded'
    order by paid_at desc limit 1;
  if not found then
    raise exception 'NO_PAYMENT';
  end if;

  select coalesce(sum(amount_sen), 0) into v_committed
    from public.refunds where booking_id = p_booking_id and status in ('pending', 'succeeded');
  if v_committed + p_amount_sen > v_payment.amount_sen then
    raise exception 'EXCEEDS_PAID';
  end if;

  insert into public.refunds (booking_id, payment_id, amount_sen, reason, idempotency_key, requested_by)
  values (p_booking_id, v_payment.id, p_amount_sen, trim(p_reason), p_idempotency_key, p_actor)
  returning id into v_refund_id;

  insert into public.audit_log (actor_id, actor_role, action, booking_id, entity_type, entity_id, metadata)
  values (p_actor, 'admin', 'refund.requested', p_booking_id, 'refund', v_refund_id::text,
          jsonb_build_object('amount_sen', p_amount_sen, 'reason', trim(p_reason)));

  return jsonb_build_object('refund_id', v_refund_id, 'duplicate', false, 'status', 'pending',
                            'payment_id', v_payment.id, 'provider', v_payment.provider,
                            'payment_intent_id', v_payment.payment_intent_id);
end;
$$;

-- Recomputes refunded totals and the payment status from succeeded refunds.
create or replace function public.sync_refund_totals(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refunded int;
  v_paid int;
begin
  perform 1 from public.bookings where id = p_booking_id for update;
  select coalesce(sum(amount_sen), 0) into v_refunded
    from public.refunds where booking_id = p_booking_id and status = 'succeeded';
  select coalesce(sum(amount_sen), 0) into v_paid
    from public.payments where booking_id = p_booking_id and status = 'succeeded';
  update public.bookings
    set refunded_sen = v_refunded,
        payment_status = case
          when v_refunded <= 0 then payment_status
          when v_refunded >= v_paid then 'refunded'
          when payment_status = 'needs_attention' then 'needs_attention'
          else 'partially_refunded'
        end,
        updated_at = now()
    where id = p_booking_id;
end;
$$;

-- Security deposit ledger, separate from rental revenue.
create or replace function public.record_deposit_transaction(
  p_booking_id uuid,
  p_kind text,
  p_amount_sen int,
  p_method text,
  p_reason text,
  p_idempotency_key text,
  p_actor uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_collected int;
  v_out int;
begin
  if p_amount_sen is null or p_amount_sen <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_kind not in ('collected', 'deduction', 'returned') then
    raise exception 'INVALID_KIND';
  end if;
  if p_kind = 'deduction' and coalesce(trim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED';
  end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if exists (select 1 from public.deposit_transactions where idempotency_key = p_idempotency_key) then
    return 'duplicate';
  end if;

  select coalesce(sum(amount_sen) filter (where kind = 'collected'), 0),
         coalesce(sum(amount_sen) filter (where kind in ('deduction', 'returned')), 0)
    into v_collected, v_out
    from public.deposit_transactions where booking_id = p_booking_id;

  if p_kind = 'collected' then
    v_collected := v_collected + p_amount_sen;
  else
    if v_out + p_amount_sen > v_collected then
      raise exception 'EXCEEDS_COLLECTED';
    end if;
    v_out := v_out + p_amount_sen;
  end if;

  insert into public.deposit_transactions (booking_id, kind, amount_sen, method, reason, idempotency_key, recorded_by)
  values (p_booking_id, p_kind, p_amount_sen, p_method, nullif(trim(coalesce(p_reason, '')), ''), p_idempotency_key, p_actor);

  update public.bookings
    set deposit_status = case when v_collected > 0 and v_out >= v_collected then 'settled' else 'collected' end,
        updated_at = now()
    where id = p_booking_id;

  insert into public.audit_log (actor_id, actor_role, action, booking_id, entity_type, entity_id, metadata)
  values (p_actor, 'admin', 'deposit.' || p_kind, p_booking_id, 'booking', p_booking_id::text,
          jsonb_build_object('amount_sen', p_amount_sen, 'method', p_method, 'reason', p_reason));
  return 'recorded';
end;
$$;

-- Claims outbox rows for sending (safe with overlapping scheduler runs).
create or replace function public.claim_outbox(p_limit int default 20)
returns setof public.email_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.email_outbox o
    set status = 'sending', attempts = o.attempts + 1,
        next_attempt_at = now() + interval '10 minutes'
    where o.id in (
      select id from public.email_outbox
      where status in ('pending', 'sending') and next_attempt_at <= now()
      order by created_at
      limit p_limit
      for update skip locked
    )
    returning o.*;
end;
$$;

-- Lock everything down: only the service role (server-side code) may execute these.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.handle_new_user()',
    'public.new_booking_reference()',
    'public.quote_rental(uuid, timestamptz, timestamptz)',
    'public.model_is_available(uuid, timestamptz, timestamptz)',
    'public.create_booking_hold(uuid, timestamptz, timestamptz, text, text, text, text, text)',
    'public.release_booking_hold(uuid, text)',
    'public.record_payment_success(uuid, text, text, int, text, text, boolean)',
    'public.create_manual_booking(uuid, timestamptz, timestamptz, text, text, text, text, int, int, uuid)',
    'public.move_booking(uuid, uuid, timestamptz, timestamptz, uuid)',
    'public.cancel_booking(uuid, text, uuid)',
    'public.request_refund(uuid, int, text, text, uuid)',
    'public.sync_refund_totals(uuid)',
    'public.record_deposit_transaction(uuid, text, int, text, text, text, uuid)',
    'public.claim_outbox(int)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

-- is_admin() is referenced by the public catalogue policy, so anon must be able to call it.
-- It only ever reports on the caller and returns false for visitors.
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;
