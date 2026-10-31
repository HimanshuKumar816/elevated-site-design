# CampusFind — 15-layer release readiness

This checklist separates repository implementation from configuration and tests that must be performed against the real provider accounts. A committed file is not proof that a live service is configured or working.

| Layer | Repository work present | Remaining verification |
|---|---|---|
| 0. Agent setup | `AGENTS.md`, `CLAUDE.md`, and repository verification rules | Review diffs and retain exact test evidence for each release |
| 1. System design | Updated roles, workflows, data sensitivity, single-campus scope, and map privacy requirements in `docs/system-design.md` | Confirm privacy notice, retention policy, and university launch assumptions |
| 2. Architecture | Architecture documentation and ADRs describe the application, UID lookup and backend boundaries | Confirm local, preview, and production services use the intended backend |
| 3. Database and storage | Versioned migrations, indexes, RLS policies, signup trigger, item images, claims, matches, notifications, saved items, audit records, and campus-location structures are present in the repository. The readiness history records that the initial schema and optimised RLS policies were applied to the new standalone Supabase project. | Verify the exact target project and migration history. The new project was documented as empty of migrated historical users/reports/storage. Confirm bucket privacy and policies. Run a restore into a separate test database. |
| 4. Authentication and permissions | UID/password sign-in, phone OTP signup/sign-in, phone-based password recovery, UID validation, role checks, and safe auth errors are implemented in application code | Configure the SMS provider. Test OTP delivery, signup, duplicate UID/phone handling, password set/reset, session expiry, logout, and two-account RLS on the intended project |
| 5. APIs and backend | Server-side UID lookup, Supabase Edge Functions, report lifecycle, claims, matching, and bounded search are implemented/documented | Audit each mutation for server-side ownership checks, input limits, safe errors, and correct role enforcement |
| 6. Frontend | Separate student/admin workspaces, browse filters, saved reports, My Reports, report forms, image validation/compression, signed-image display, and status/error states are present | Complete browser, mobile-width, keyboard, focus, accessibility, and real-image upload checks |
| 7. CI/CD and version control | GitHub Actions CI runs lint, tests, production build, and TypeScript checking. Dependabot is configured. | The previously recorded successful CI run predates the latest 30–31 October changes. Require a fresh green run for the release branch/PR and confirm deployment sync/rollback settings |
| 8. Testing | Unit tests cover UID validation and matching logic, including match-notification eligibility | Run the full CI suite and manual end-to-end checklist in `docs/release-acceptance-checklist.md` |
| 9. Hosting and cloud | Render deployment configuration, environment guide, and `/api/health` and `/api/health/live` endpoints are in the repository | Check live HTTPS, correct environment variables/project IDs, backend connectivity, billing alerts, and both health routes |
| 10. Security | Threat model, RLS, server-only admin client, private claims/notes, audit history, safer Edge Function origins, request limits, and secret ignore rules are present | Rotate the previously exposed service-role credential in the original backend and hosting environment if not already done. Inspect Git history and deployed bundles. Test RLS and storage access directly |
| 11. Rate limiting | Matching Edge Function has per-user and per-report limits; signup/auth provider controls are documented | Confirm deployed function and provider-side OTP/login throttles; test repeated requests |
| 12. Caching and CDN | Health responses use no-store; safe caching guidance is documented | Inspect production cache headers and run Lighthouse; ensure private responses are not shared-cached |
| 13. Error tracking and logs | Safer auth diagnostics and incident guidance are present | Configure provider error tracking/request IDs if required; inspect logs for UIDs, phone numbers, tokens, and claim evidence |
| 14. Monitoring and alerts | Health endpoints, operations documentation, and a scheduled backup workflow definition exist | Configure external uptime/alert delivery and confirm a real alert is received |
| 15. Scaling | Indexes, pagination, bounded search and a documented capacity plan exist | Measure real query plans, latency, load and cost before scaling infrastructure |

## Backup evidence and limitations

- A local custom-format database dump was listed successfully with `pg_restore --list`. This confirms that the archive can be read as a PostgreSQL archive; it does **not** prove that a full restore succeeds.
- A macOS backup script uses the macOS Keychain and writes local dump files. The LaunchAgent template schedules a daily run. Confirm the live LaunchAgent and latest successful log on the Mac.
- Google Drive for desktop was installed according to the operator's setup notes, but remote Drive synchronization has not been verified.
- A GitHub Actions workflow is configured for daily backups. It requires the `SUPABASE_DB_URL` and `CAMPUSFIND_BACKUP_PASSPHRASE` repository secrets. It must complete successfully and create an encrypted `.gpg` artifact before it can be counted as operational.
- Restore drills must use a separate non-production database, never the production database.

## Remaining release blockers

1. Confirm the correct Supabase project ID and ensure local, Render, and Edge Function environment variables all point to that same intended project.
2. Confirm the historical data migration plan. The new standalone project was documented as not containing imported historical users, reports, or storage objects.
3. Rotate the service-role credential exposed in earlier Git history if it has not already been rotated; update the hosting secret without pasting it into chat.
4. Configure and verify the SMS provider and all OTP/password recovery flows.
5. Add the two GitHub Actions backup secrets, run the workflow manually, and verify the encrypted artifact. Run a restore drill in a separate database.
6. Verify Google Drive contains a recent backup file in the cloud, not merely in the local synced folder.
7. Complete the manual test plan in `docs/release-acceptance-checklist.md`.
8. Confirm a fresh successful GitHub Actions CI run and verify the deployed site after the release is merged.

## Release rule

Never mark live login, SQL migration, deployment, backup sync, restore, alert delivery, or production security testing complete based only on a repository file or a local archive listing. Record the date, target project ID (never credentials), exact action, and result.
