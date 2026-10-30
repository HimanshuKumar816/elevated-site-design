-- Production hardening: least-privilege notifications and private trigger function.
-- Apply to the configured Supabase project.

BEGIN;

-- The matching routine is intended to run only as an items INSERT trigger.
-- Do not allow callers to invoke its SECURITY DEFINER body as an RPC.
REVOKE EXECUTE ON FUNCTION public.notify_item_match() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_item_match() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_item_match() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.notify_item_match() TO service_role;

-- Students may mark their own notification as read, but should not be able
-- to rewrite notification content or reassign item references.
REVOKE UPDATE ON TABLE public.notifications FROM authenticated;
GRANT UPDATE (read_at) ON TABLE public.notifications TO authenticated;

-- Add covering indexes for the notification-to-item foreign keys.
CREATE INDEX IF NOT EXISTS notifications_item_id_idx
  ON public.notifications (item_id);
CREATE INDEX IF NOT EXISTS notifications_matched_item_id_idx
  ON public.notifications (matched_item_id);

COMMIT;
