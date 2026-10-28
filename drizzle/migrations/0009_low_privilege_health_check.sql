-- Minimal invoker-only database health check for the Render readiness route.
-- It returns no application data and does not need a privileged credential.

BEGIN;

CREATE OR REPLACE FUNCTION public.health_check()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO pg_catalog
AS $function$
  SELECT true;
$function$;

REVOKE ALL ON FUNCTION public.health_check() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.health_check() TO anon, authenticated;

COMMIT;
