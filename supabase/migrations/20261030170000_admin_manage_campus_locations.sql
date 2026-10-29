-- Allow verified administrators to assign or correct private campus pins for any report.
-- Public/student users still cannot write or view other users' exact coordinates.
BEGIN;

GRANT UPDATE ON TABLE public.item_locations TO authenticated;

DROP POLICY IF EXISTS "Admins assign exact item locations" ON public.item_locations;
CREATE POLICY "Admins assign exact item locations"
  ON public.item_locations
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT private.is_admin())
    AND EXISTS (
      SELECT 1 FROM public.items i
      WHERE i.id = item_locations.item_id AND i.user_id = item_locations.user_id
    )
  );

DROP POLICY IF EXISTS "Admins update exact item locations" ON public.item_locations;
CREATE POLICY "Admins update exact item locations"
  ON public.item_locations
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK (
    (SELECT private.is_admin())
    AND EXISTS (
      SELECT 1 FROM public.items i
      WHERE i.id = item_locations.item_id AND i.user_id = item_locations.user_id
    )
  );

COMMIT;
