-- Move pg_trgm out of the API-exposed public schema and harden the trigger.
-- Apply to the configured Supabase project.

BEGIN;

ALTER EXTENSION pg_trgm SET SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_item_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, pg_temp
AS $function$
DECLARE
  candidate public.items%ROWTYPE;
  match_score integer;
BEGIN
  FOR candidate IN
    SELECT i.*
    FROM public.items AS i
    WHERE i.user_id <> NEW.user_id
      AND i.type <> NEW.type
      AND (
        i.category = NEW.category
        OR extensions.similarity(lower(i.name), lower(NEW.name)) >= 0.25
      )
      AND i.created_at > now() - make_interval(days => 180)
    ORDER BY extensions.similarity(lower(i.name), lower(NEW.name)) DESC
    LIMIT 25
  LOOP
    match_score := 0;
    IF candidate.category = NEW.category THEN
      match_score := match_score + 35;
    END IF;
    match_score := match_score
      + round(extensions.similarity(lower(candidate.name), lower(NEW.name)) * 50)::integer;
    IF extensions.similarity(lower(candidate.location), lower(NEW.location)) >= 0.2 THEN
      match_score := match_score + 15;
    END IF;

    IF match_score >= 45 THEN
      INSERT INTO public.notifications (user_id, item_id, matched_item_id, title, body)
      VALUES (
        candidate.user_id, candidate.id, NEW.id,
        'Possible item match',
        'A new ' || lower(NEW.type) || ' report may match your ' || lower(candidate.type) || ' report: ' || NEW.name || '. Open CampusFind to compare details.'
      );
      INSERT INTO public.notifications (user_id, item_id, matched_item_id, title, body)
      VALUES (
        NEW.user_id, NEW.id, candidate.id,
        'Possible item match',
        'Your ' || lower(NEW.type) || ' report may match an existing ' || lower(candidate.type) || ' report: ' || candidate.name || '. Open CampusFind to compare details.'
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notify_item_match() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_item_match() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_item_match() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.notify_item_match() TO service_role;

COMMIT;
