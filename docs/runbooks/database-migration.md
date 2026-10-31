# Database migration runbook

## Before changing the database

1. Confirm the exact Supabase project used by the target deployment. Check the project ID in dashboard settings and compare it with the app's browser, server, and Edge Function environment. Do not infer the backend from a Render or Lovable hostname.
2. Confirm a recent backup exists. Prefer testing the backup restore into a separate non-production database before a high-risk migration.
3. Review the exact SQL migration and dependencies. Apply migrations in order using the supported migration mechanism or SQL editor for the confirmed project.
4. Never paste the database URI, password, publishable key, or service-role key into chat, screenshots, issues, or committed files.

## Schema and data verification

Verify the expected tables, indexes, triggers, and RLS policies in the intended project, including `profiles`, `items`, `item_claims`, `item_matches`, `notifications`, `saved_items`, `login_events`, `admin_audit_logs`, `admin_item_moderation_notes`, and `item_locations`.

For item photos, verify `public.items.image_path`, the private `item-images` Storage bucket, and Storage policies for the intended student/admin actions.

The newer standalone Supabase project was documented as having its initial schema and optimised RLS policies applied, but historical users, reports, and storage objects were not migrated. Do not assume old users or reports appear in the new project. Before migrating historical data, define and test an explicit export/import plan, preserve Auth user identity references, check UID metadata, and verify image object paths. Never guess or reassign student identities.

## Authentication and product checks

1. Confirm phone sign-in is enabled and the SMS provider is configured in Supabase.
2. Test student signup with full name, unique UID, and phone; verify the OTP; set a password; and confirm the profile was created with the correct role.
3. Test UID/password sign-in, phone-code sign-in, password recovery, expired/wrong codes, duplicate UID/phone handling, sign-out, and session expiry.
4. Test Lost and Found report creation, campus-area validation, JPG/PNG/WebP image upload (up to 5 MB before compression), signed image display, and invalid/oversized file rejection.
5. Test claims, saved items, notifications, matching, administrator review, student verification, and lifecycle status changes.
6. With two student accounts, verify that each user can access only their own profile, claims, reports, notifications, and saved items; verify that only administrators can access admin-only records and actions.

## Rollback

Do not drop profiles, items, Auth users, or storage objects to undo a failed migration. Stop, preserve the error, take a backup, inspect the affected migration, and prepare a reviewed corrective migration. Database changes are not automatically reverted by rolling back application code.
