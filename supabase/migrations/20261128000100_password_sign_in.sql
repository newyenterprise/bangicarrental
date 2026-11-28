-- Optional password sign-in.
-- password_set_at is written only by the site's own "set password" action, which
-- requires a session that was obtained by proving control of the email (code or
-- link). Password sign-in is refused for any account without it, so a password
-- created some other way (for example a direct sign-up call to the Auth API)
-- can never be used to reach someone's bookings.
alter table public.profiles add column if not exists password_set_at timestamptz;
