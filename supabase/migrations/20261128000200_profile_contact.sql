-- Customers now sign up before paying. Their name and phone live on the profile
-- and pre-fill the booking form. Written only by server code (service role).
alter table public.profiles add column if not exists full_name text not null default '';
alter table public.profiles add column if not exists phone text not null default '';
