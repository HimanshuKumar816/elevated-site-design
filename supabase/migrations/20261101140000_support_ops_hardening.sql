-- CampusFind support operations hardening.
-- This migration keeps the inbox private, adds an admin-only read RPC,
-- protects public support writes from abuse, and alerts admins in-app.

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON TABLE public.support_tickets, public.support_messages TO authenticated;
GRANT INSERT ON TABLE public.support_messages TO authenticated;
GRANT UPDATE (status) ON TABLE public.support_tickets TO authenticated;

CREATE INDEX IF NOT EXISTS support_tickets_user_updated_at_idx
  ON public.support_tickets (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_messages_ticket_created_at_idx
  ON public.support_messages (ticket_id, created_at ASC);
CREATE INDEX IF NOT EXISTS support_messages_sender_created_at_idx
  ON public.support_messages (sender_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_list_support_conversations(p_limit integer DEFAULT 500)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  subject text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  user_name text,
  user_uid text,
  messages jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles AS actor
    WHERE actor.id = auth.uid()
      AND actor.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Administrator access required.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    ticket.id,
    ticket.user_id,
    ticket.subject,
    ticket.status::text,
    ticket.created_at,
    ticket.updated_at,
    owner_profile.full_name,
    owner_profile.uid,
    COALESCE(thread.messages, '[]'::jsonb)
  FROM public.support_tickets AS ticket
  LEFT JOIN public.profiles AS owner_profile
    ON owner_profile.id = ticket.user_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', message.id,
        'ticket_id', message.ticket_id,
        'sender_id', message.sender_id,
        'body', message.body,
        'created_at', message.created_at,
        'sender_name', sender_profile.full_name,
        'sender_uid', sender_profile.uid,
        'sender_role', sender_profile.role
      )
      ORDER BY message.created_at ASC
    ) AS messages
    FROM public.support_messages AS message
    LEFT JOIN public.profiles AS sender_profile
      ON sender_profile.id = message.sender_id
    WHERE message.ticket_id = ticket.id
  ) AS thread ON TRUE
  ORDER BY ticket.updated_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 500);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_support_conversations(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_support_conversations(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_support_conversations(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.campusfind_guard_support_ticket_rate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_recent_count integer;
BEGIN
  -- Permit trusted backend jobs that do not carry an end-user JWT.
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Support conversation owner does not match the signed-in user.'
      USING ERRCODE = '42501';
  END IF;

  SELECT profile.role INTO v_role
  FROM public.profiles AS profile
  WHERE profile.id = v_user_id;

  IF v_role = 'admin' THEN
    RETURN NEW;
  END IF;

  IF v_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'A CampusFind student account is required to contact support.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  SELECT count(*) INTO v_recent_count
  FROM public.support_tickets AS ticket
  WHERE ticket.user_id = v_user_id
    AND ticket.created_at >= now() - interval '24 hours';

  IF v_recent_count >= 3 THEN
    RAISE EXCEPTION 'SUPPORT_RATE_LIMITED_TICKETS: You can open up to 3 new support conversations in 24 hours.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.campusfind_guard_support_ticket_rate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.campusfind_guard_support_ticket_rate() FROM anon;
REVOKE ALL ON FUNCTION public.campusfind_guard_support_ticket_rate() FROM authenticated;

DROP TRIGGER IF EXISTS campusfind_support_ticket_rate_limit ON public.support_tickets;
CREATE TRIGGER campusfind_support_ticket_rate_limit
  BEFORE INSERT ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.campusfind_guard_support_ticket_rate();

CREATE OR REPLACE FUNCTION public.campusfind_guard_support_message_rate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_recent_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Support message sender does not match the signed-in user.'
      USING ERRCODE = '42501';
  END IF;

  IF char_length(btrim(COALESCE(NEW.body, ''))) < 1
     OR char_length(NEW.body) > 5000 THEN
    RAISE EXCEPTION 'Support messages must contain between 1 and 5,000 characters.'
      USING ERRCODE = '22023';
  END IF;

  SELECT profile.role INTO v_role
  FROM public.profiles AS profile
  WHERE profile.id = v_user_id;

  IF v_role = 'admin' THEN
    RETURN NEW;
  END IF;

  IF v_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'A valid CampusFind account is required to send support messages.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 1));

  SELECT count(*) INTO v_recent_count
  FROM public.support_messages AS message
  WHERE message.sender_id = v_user_id
    AND message.created_at >= now() - interval '10 minutes';

  IF v_recent_count >= 10 THEN
    RAISE EXCEPTION 'SUPPORT_RATE_LIMITED_MESSAGES: Please wait before sending more support messages.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.campusfind_guard_support_message_rate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.campusfind_guard_support_message_rate() FROM anon;
REVOKE ALL ON FUNCTION public.campusfind_guard_support_message_rate() FROM authenticated;

DROP TRIGGER IF EXISTS campusfind_support_message_rate_limit ON public.support_messages;
CREATE TRIGGER campusfind_support_message_rate_limit
  BEFORE INSERT ON public.support_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.campusfind_guard_support_message_rate();

CREATE OR REPLACE FUNCTION public.campusfind_support_message_after_insert()
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

  -- Any new reply reopens a resolved thread and advances its activity time.
  UPDATE public.support_tickets
  SET status = 'open',
      updated_at = NEW.created_at
  WHERE id = NEW.ticket_id;

  -- Notify administrators only when the student (the ticket owner) writes.
  -- The notification contains no message body or student contact details.
  IF v_ticket_owner IS NOT NULL AND NEW.sender_id = v_ticket_owner THEN
    INSERT INTO public.notifications (user_id, title, body, item_id, matched_item_id)
    SELECT
      profile.id,
      'New CampusFind support message',
      'A student sent a message in a support conversation. Open the Support inbox in the administrator dashboard to reply.',
      NULL,
      NULL
    FROM public.profiles AS profile
    WHERE profile.role = 'admin';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.campusfind_support_message_after_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.campusfind_support_message_after_insert() FROM anon;
REVOKE ALL ON FUNCTION public.campusfind_support_message_after_insert() FROM authenticated;

DROP TRIGGER IF EXISTS campusfind_support_message_admin_alert ON public.support_messages;
CREATE TRIGGER campusfind_support_message_admin_alert
  AFTER INSERT ON public.support_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.campusfind_support_message_after_insert();

NOTIFY pgrst, 'reload schema';
