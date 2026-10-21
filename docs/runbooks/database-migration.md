# Database migration runbook

## Why this matters
UID login queries public.profiles. If that table is absent, the UID lookup cannot succeed. A migration in Git does not execute against the live database.

## Safe procedure
1. Confirm the actual backend connected to the Lovable project. Do not infer it from the Lovable runtime hostname alone.
2. Confirm the dashboard project ID matches the environment configuration in the connected project. Never paste secret keys into a terminal transcript, screenshot, or chat.
3. Take or verify a current backup before applying schema changes.
4. Review drizzle/migrations/0001_uid_auth_repair.sql.
5. Apply it in the SQL editor or supported migration mechanism for the exact connected database.
6. Verify public.profiles and public.items exist, the on_auth_user_created trigger exists, and the expected RLS policies are active.
7. Check whether existing Auth users have a UID in user metadata. The migration can backfill only users whose metadata already contains a UID. Resolve missing metadata deliberately; never guess identities.
8. Test a new signup, email confirmation, successful UID login, wrong UID/password, logout, report creation, and cross-user ownership.
9. Record date, target project ID (not secrets), migration filename, and verification results.

## Rollback
Do not drop profiles or items to undo a failed migration. Stop, inspect the migration error, take a backup, and prepare a reviewed corrective migration. Database changes are not automatically reverted by rolling back application code.
