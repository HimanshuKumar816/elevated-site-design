# Vibe Coding a Real SaaS — 15-Layer Playbook Applied to CampusFind

This checklist follows the uploaded 36-page playbook, including its Part 0 agent memory/verification loop, all 15 layers, and the final pre-launch gate. Repository work and provider actions are deliberately distinguished.

| Layer | Repository work completed | Still needs real verification |
|---|---|---|
| 0. Agent setup and working loop | AGENTS.md and CLAUDE.md; universal don't-fool-me verification rule | Review diffs and test output on each release |
| 1. System design | docs/system-design.md describes roles, flows, privacy, out-of-scope work | Confirm launch assumptions and legal/privacy requirements |
| 2. System architecture | docs/architecture.md and two ADRs document modular monolith and UID mapping | Review with a fresh reviewer before launch |
| 3. Database and storage | Versioned SQL migrations 0000–0002, indexes, RLS, trigger, metadata backfill; database runbook | Migration 0002 is committed but not applied: Lovable free-plan database action limit blocked execution; confirm backups and test restore; no file upload exists yet |
| 4. Auth and permissions | UID validation helper/tests, server-only UID lookup, CU email signup validation, password-reset request and completion UI, safer infrastructure errors | Apply migration 0002; test signup, email confirmation, reset link, login/logout/session expiry and two-account RLS against the live backend |
| 5. APIs and backend logic | API conventions and bounded-input rules documented; UID server validation | Audit all server functions and verify every mutation enforces ownership |
| 6. Frontend | Existing visual design retained; shared UID validation, report validation/error states, browse loading/error handling and password-reset screens | Browser audit for mobile, keyboard/focus, loading/empty/error/success and form accessibility |
| 7. CI/CD and version control | GitHub Actions CI for lint, tests, build and typecheck; .env.example and agent memory | Latest verified successful run before this change: 39555981979 (lint, tests, production build, and typecheck all passed). This commit adds strict calendar-date validation and focused tests; its own CI run must pass before release. Verify Lovable sync, secret scanning and rollback controls |
| 8. Testing | Unit tests for UID normalization/validation | CI output and end-to-end tests for real auth/report workflows still required |
| 9. Hosting and cloud | Hosting/environment guide; /api/health and /api/health/live endpoints | Confirm matching backend keys, HTTPS, live deployment, provider settings and billing alerts |
| 10. Security | Threat model, permission matrix, profile RLS repair migration, server-only admin client | Fresh code review, dependency audit, production bundle inspection and direct RLS abuse tests |
| 11. Rate limiting | Rate-limit and abuse-control requirements documented | Verify provider rate limits and repeated-attempt throttling; no fake in-memory production limiter added |
| 12. Caching and CDN | Safe caching policy documented; health responses use no-store | Inspect production Cache-Control headers and run Lighthouse |
| 13. Error tracking and logs | UID lookup now records safe error codes without logging UID/email/password; incident guidance | Provider error tracking and request IDs are not configured; verify logs contain no sensitive values |
| 14. Monitoring and alerts | Monitoring plan and incident runbook documented; database readiness endpoint added | Configure uptime/alerts externally and test notification delivery |
| 15. Scaling | Transparent illustrative capacity estimate and scaling plan documented | Measure real p50/p95/p99, query plans, load and costs before any scale upgrade |

## Universal verification gate
Before calling a task done, run lint, typecheck, tests, and production build; show exact output; list changed files; list skipped/stubbed work and assumptions. Do not claim live migration, login, deployment, backup restore, monitoring, alerts, or load testing is complete unless actually verified.

## Immediate release blockers
1. Apply drizzle/migrations/0001_uid_auth_repair.sql and 0002_auth_least_privilege.sql to this Lovable project's linked cloud database only. A database action limit currently blocks this operation; do not apply to the separate Supabase project by guesswork.
2. Verify existing Auth users have UID metadata. Backfill cannot infer missing UIDs.
3. Confirm the latest GitHub Actions run passes lint, tests, production build, and typecheck.
4. Test signup, email confirmation, password reset, correct/wrong UID-password, logout, report creation, and cross-user ownership against the intended backend.
5. Rotate the previously exposed service-role credential in the actual connected backend and hosting settings; never paste credentials into chat.

## Assumptions and scope
CampusFind is a single-campus student product, not a multi-tenant paid SaaS. The capacity numbers in docs/capacity-estimate.md are illustrative assumptions, not measured traffic. No payment, file-upload, paid monitoring, Redis, or microservice infrastructure has been added because the current product does not require it.


## Additional security incident discovered during repository review
A real .env file was present in the repository. It has now been removed from the current branch and .gitignore excludes future local .env files. Removing it from the latest revision does not erase the old Git commit history. Treat the service-role credential from that file as exposed: rotate/revoke it in the connected Supabase/Lovable backend, update the hosting secret, and verify the app still connects. Do not paste the old or new value into chat. After rotation, inspect the public bundle and repository history as part of the security review.
