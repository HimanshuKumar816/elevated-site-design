-- CampusFind smart match notifications and optional student mobile contact.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone_number text,
  sms_notifications_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phone_number_format CHECK (phone_number IS NULL OR phone_number ~ '^\\+?[1-9][0-9]{9,14}
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.items(id) ON DELETE CASCADE,
  matched_item_id uuid REFERENCES public.items(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users mark own notifications read" ON public.notifications;
CREATE POLICY "Users mark own notifications read" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.notify_item_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate public.items%ROWTYPE;
  match_score integer;
BEGIN
  FOR candidate IN
    SELECT i.*
    FROM public.items i
    WHERE i.user_id <> NEW.user_id
      AND i.type <> NEW.type
      AND (
        i.category = NEW.category
        OR similarity(lower(i.name), lower(NEW.name)) >= 0.25
      )
      AND i.created_at > now() - interval '180 days'
    ORDER BY similarity(lower(i.name), lower(NEW.name)) DESC
    LIMIT 25
  LOOP
    match_score := 0;
    IF candidate.category = NEW.category THEN match_score := match_score + 35; END IF;
    match_score := match_score + round(similarity(lower(candidate.name), lower(NEW.name)) * 50)::integer;
    IF similarity(lower(candidate.location), lower(NEW.location)) >= 0.2 THEN
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
$$;

DROP TRIGGER IF EXISTS items_notify_possible_match ON public.items;
CREATE TRIGGER items_notify_possible_match
AFTER INSERT ON public.items
FOR EACH ROW EXECUTE FUNCTION public.notify_item_match();
)
);
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users manage own notification preferences" ON public.notification_preferences
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.items(id) ON DELETE CASCADE,
  matched_item_id uuid REFERENCES public.items(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users mark own notifications read" ON public.notifications;
CREATE POLICY "Users mark own notifications read" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.notify_item_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate public.items%ROWTYPE;
  match_score integer;
BEGIN
  FOR candidate IN
    SELECT i.*
    FROM public.items i
    WHERE i.user_id <> NEW.user_id
      AND i.type <> NEW.type
      AND (
        i.category = NEW.category
        OR similarity(lower(i.name), lower(NEW.name)) >= 0.25
      )
      AND i.created_at > now() - interval '180 days'
    ORDER BY similarity(lower(i.name), lower(NEW.name)) DESC
    LIMIT 25
  LOOP
    match_score := 0;
    IF candidate.category = NEW.category THEN match_score := match_score + 35; END IF;
    match_score := match_score + round(similarity(lower(candidate.name), lower(NEW.name)) * 50)::integer;
    IF similarity(lower(candidate.location), lower(NEW.location)) >= 0.2 THEN
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
$$;

DROP TRIGGER IF EXISTS items_notify_possible_match ON public.items;
CREATE TRIGGER items_notify_possible_match
AFTER INSERT ON public.items
FOR EACH ROW EXECUTE FUNCTION public.notify_item_match();
