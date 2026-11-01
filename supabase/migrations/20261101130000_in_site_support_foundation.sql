-- CampusFind private in-site support foundation.
-- This migration is intentionally idempotent: the production support tables
-- were originally introduced directly in the project database before they
-- were versioned in this repository.

CREATE SCHEMA IF NOT EXISTS private;

-- Notifications are part of the support reply experience. Keep them scoped
-- to their recipient; background triggers write them as the table owner.
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  item_id uuid REFERENCES public.items(id) ON DELETE SET NULL,
  matched_item_id uuid REFERENCES public.items(id) ON DELETE SET NULL,
  read_at timestamptz
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON TABLE public.notifications TO authenticated;

DROP POLICY IF EXISTS campusfind_notifications_owner_read
  ON public.notifications;
CREATE POLICY campusfind_notifications_owner_read
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS campusfind_notifications_owner_update
  ON public.notifications;
CREATE POLICY campusfind_notifications_owner_update
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_tickets_subject_length_check
    CHECK (char_length(btrim(subject)) BETWEEN 3 AND 160)
);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_messages_body_length_check
    CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000)
);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public, private TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.support_tickets TO authenticated;
GRANT SELECT, INSERT ON TABLE public.support_messages TO authenticated;

CREATE OR REPLACE FUNCTION private.is_campusfind_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
      AND profile.role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION private.is_campusfind_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_campusfind_admin() FROM anon;
GRANT EXECUTE ON FUNCTION private.is_campusfind_admin() TO authenticated;

DROP POLICY IF EXISTS campusfind_support_tickets_owner_or_admin_read
  ON public.support_tickets;
CREATE POLICY campusfind_support_tickets_owner_or_admin_read
  ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT private.is_campusfind_admin()));

DROP POLICY IF EXISTS campusfind_support_tickets_admin_update
  ON public.support_tickets;
CREATE POLICY campusfind_support_tickets_admin_update
  ON public.support_tickets
  FOR UPDATE
  TO authenticated
  USING ((SELECT private.is_campusfind_admin()))
  WITH CHECK ((SELECT private.is_campusfind_admin()));

DROP POLICY IF EXISTS campusfind_support_messages_owner_or_admin_read
  ON public.support_messages;
CREATE POLICY campusfind_support_messages_owner_or_admin_read
  ON public.support_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.support_tickets AS ticket
      WHERE ticket.id = support_messages.ticket_id
        AND (
          ticket.user_id = (SELECT auth.uid())
          OR (SELECT private.is_campusfind_admin())
        )
    )
  );

DROP POLICY IF EXISTS campusfind_support_messages_owner_or_admin_insert
  ON public.support_messages;
CREATE POLICY campusfind_support_messages_owner_or_admin_insert
  ON public.support_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.support_tickets AS ticket
      WHERE ticket.id = support_messages.ticket_id
        AND (
          ticket.user_id = (SELECT auth.uid())
          OR (SELECT private.is_campusfind_admin())
        )
    )
  );

CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_subject text,
  p_message text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_ticket_id uuid;
  v_subject text := btrim(COALESCE(p_subject, ''));
  v_message text := btrim(COALESCE(p_message, ''));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before contacting CampusFind support.'
      USING ERRCODE = '42501';
  END IF;

  SELECT profile.role INTO v_role
  FROM public.profiles AS profile
  WHERE profile.id = v_user_id;

  IF v_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'A student account is required to contact CampusFind support.'
      USING ERRCODE = '42501';
  END IF;

  IF char_length(v_subject) NOT BETWEEN 3 AND 160 THEN
    RAISE EXCEPTION 'The support subject must contain between 3 and 160 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(v_message) NOT BETWEEN 10 AND 5000 THEN
    RAISE EXCEPTION 'The first support message must contain between 10 and 5,000 characters.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.support_tickets (user_id, subject, status)
  VALUES (v_user_id, v_subject, 'open')
  RETURNING id INTO v_ticket_id;

  INSERT INTO public.support_messages (ticket_id, sender_id, body)
  VALUES (v_ticket_id, v_user_id, v_message);

  RETURN v_ticket_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_support_ticket(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_support_ticket(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(text, text) TO authenticated;

-- Preserve the original student notification trigger when it already exists.
-- On a fresh environment, install an equivalent in-site reply notification.
CREATE OR REPLACE FUNCTION public.campusfind_support_notify_student_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ticket_owner uuid;
BEGIN
  SELECT ticket.user_id INTO v_ticket_owner
  FROM public.support_tickets AS ticket
  WHERE ticket.id = NEW.ticket_id;

  IF v_ticket_owner IS NOT NULL AND NEW.sender_id <> v_ticket_owner THEN
    INSERT INTO public.notifications (user_id, title, body, item_id, matched_item_id)
    VALUES (
      v_ticket_owner,
      'CampusFind support replied',
      'An administrator replied to your support conversation. Open Help & Support to continue the conversation.',
      NULL,
      NULL
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.campusfind_support_notify_student_reply() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.campusfind_support_notify_student_reply() FROM anon;
REVOKE ALL ON FUNCTION public.campusfind_support_notify_student_reply() FROM authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_entry
    JOIN pg_proc AS function_entry
      ON function_entry.oid = trigger_entry.tgfoid
    JOIN pg_namespace AS function_schema
      ON function_schema.oid = function_entry.pronamespace
    WHERE trigger_entry.tgrelid = 'public.support_messages'::regclass
      AND NOT trigger_entry.tgisinternal
      AND function_schema.nspname = 'private'
  ) THEN
    DROP TRIGGER IF EXISTS campusfind_support_student_reply_notification
      ON public.support_messages;
    CREATE TRIGGER campusfind_support_student_reply_notification
      AFTER INSERT ON public.support_messages
      FOR EACH ROW
      EXECUTE FUNCTION public.campusfind_support_notify_student_reply();
  END IF;
END;
$$;

