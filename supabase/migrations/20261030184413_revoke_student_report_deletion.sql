-- Direct report deletion is not part of the CampusFind workflow.
-- Students archive reports through report_status; privileged service operations
-- remain available to service_role for controlled maintenance.
revoke delete on table public.items from anon, authenticated;
