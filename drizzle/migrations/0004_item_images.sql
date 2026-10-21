-- Add optional item photos using a private Supabase Storage bucket.
-- Apply to the exact Supabase project used by the local .env before testing uploads.
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS image_path text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'item-images',
  'item-images',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[];

DROP POLICY IF EXISTS "Authenticated users can view item images" ON storage.objects;
CREATE POLICY "Authenticated users can view item images"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'item-images');

DROP POLICY IF EXISTS "Users upload their own item images" ON storage.objects;
CREATE POLICY "Users upload their own item images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'item-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users delete their own item images" ON storage.objects;
CREATE POLICY "Users delete their own item images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'item-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
