-- Bangi Car Rental: storage buckets.
--
-- Identity documents, signed agreements and condition photos are private.
-- No storage.objects policies are created for these buckets on purpose:
-- with RLS on and no policy, anon and signed-in users cannot list, read or
-- write objects directly. The server checks ownership, then hands out
-- short-lived signed URLs (or signed upload URLs) using the service role.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('renter-documents', 'renter-documents', false, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']),
  ('agreements', 'agreements', false, 10485760,
   array['application/pdf', 'image/png']),
  ('handover-photos', 'handover-photos', false, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  ('model-images', 'model-images', true, 5242880,
   array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
