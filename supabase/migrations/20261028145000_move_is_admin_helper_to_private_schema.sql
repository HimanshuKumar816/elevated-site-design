-- Move the SECURITY DEFINER admin helper out of the public PostgREST API schema.
-- RLS still uses it to allow administrators to view profiles; authenticated users
-- can execute it in SQL policy evaluation, but it is no longer exposed as /rpc/is_admin.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  );
$function$;

REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;

ALTER POLICY "Own profile or admin can view profiles"
ON public.profiles
USING (
  ((SELECT auth.uid()) = id)
  OR (SELECT private.is_admin())
);

DROP FUNCTION IF EXISTS public.is_admin();

COMMIT;
