-- Billplz as a payment provider, with a setting for which provider is primary.
-- Additive and backward compatible: the image that only knows Stripe keeps working.

alter table public.payments drop constraint payments_provider_check;
alter table public.payments
  add constraint payments_provider_check check (provider in ('stripe', 'billplz', 'manual'));

-- For Billplz, payments.checkout_session_id holds the bill id.
comment on column public.payments.checkout_session_id is
  'Provider checkout id: Stripe Checkout Session id, or Billplz bill id.';

alter table public.app_settings
  add column if not exists payment_provider text not null default 'billplz'
  check (payment_provider in ('billplz', 'stripe'));
