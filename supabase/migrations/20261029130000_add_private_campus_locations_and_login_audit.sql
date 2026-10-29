-- Record successful sign-ins for administrator visibility and keep exact map pins private.
-- The map bounds are a campus-area approximation around Chandigarh University, Gharuan.
BEGIN;

CREATE TABLE IF NOT EXISTS public.login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  login_method text NOT NULL CHECK (login_method IN ('password', 'otp', 'signup')),
  logged_in_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_events_logged_in_at_idx
  ON public.login_events (logged_in_at DESC);
CREATE INDEX IF NOT EXISTS login_events_user_id_logged_in_at_idx
  ON public.login_events (user_id, logged_in_at DESC);

ALTER TABLE public.login_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.login_events FROM anon, authenticated;
GRANT INSERT, SELECT ON TABLE public.login_events TO authenticated;

DROP POLICY IF EXISTS "Users record their own login events" ON public.login_events;
CREATE POLICY "Users record their own login events"
  ON public.login_events
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins view login events" ON public.login_events;
CREATE POLICY "Admins view login events"
  ON public.login_events
  FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()));

CREATE TABLE IF NOT EXISTS public.item_locations (
  item_id uuid PRIMARY KEY REFERENCES public.items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_locations_campus_bounds_check
    CHECK (
      latitude BETWEEN 30.761 AND 30.778
      AND longitude BETWEEN 76.560 AND 76.586
    )
);

CREATE INDEX IF NOT EXISTS item_locations_user_id_idx
  ON public.item_locations (user_id);

ALTER TABLE public.item_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.item_locations FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.item_locations TO authenticated;

DROP POLICY IF EXISTS "Owners and admins view exact item locations" ON public.item_locations;
CREATE POLICY "Owners and admins view exact item locations"
  ON public.item_locations
  FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR (SELECT private.is_admin())
  );

DROP POLICY IF EXISTS "Users add exact locations to their own reports" ON public.item_locations;
CREATE POLICY "Users add exact locations to their own reports"
  ON public.item_locations
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1
      FROM public.items i
      WHERE i.id = item_id
        AND i.user_id = (SELECT auth.uid())
    )
  );

COMMIT;
