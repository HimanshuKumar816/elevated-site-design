# Vibe Coding a Real SaaS — 15-Layer Playbook Applied to CampusFind

This checklist applies the user's uploaded 36-page *Vibe Coding a Real SaaS: The 15-Layer Playbook*. It distinguishes repository changes from live-provider setup that cannot be verified from code alone.

| Layer | CampusFind action | Status / evidence required |
|---|---|---|
| 1. System design | Define users, workflows, data, non-functional requirements, out-of-scope work | Documented in system-design.md |
| 2. Architecture | Keep a modular monolith; document request/data flow and risks | Documented in architecture.md |
| 3. Database/storage | Version schema migration; backfill profiles; verify RLS and backups | Migration committed; live SQL and restore test still required |
| 4. Auth/permissions | Supabase Auth, UID lookup, email confirmation, RLS | Code exists; live signup/login and cross-user tests required |
| 5. APIs/backend | Validate server inputs; enforce ownership and consistent errors | Review all server functions before launch |
| 6. Frontend | Preserve design; validate loading/empty/error/success and mobile/accessibility | Browser audit required |
| 7. CI/CD/version control | Keep .env out of Git; CI for lint/typecheck/tests/build; review changes | Verify workflow and Lovable sync |
| 8. Testing | Unit, integration, E2E tests for signup/login/report flows | Run commands and add real-backend tests |
| 9. Hosting/cloud | Match environment variables to the intended Lovable backend; HTTPS and rollback | Provider settings require verification |
| 10. Security | Review RLS, XSS, CSRF, redirects, cookies, headers, dependencies, secret exposure | Security review required before production |
| 11. Rate limiting | Throttle signup/login and expensive endpoints with shared limits | Provider/app configuration not verified |
| 12. Caching/CDN | Cache static assets; never shared-cache authenticated/private responses | Inspect deployed headers |
| 13. Error tracking/logs | Structured, redacted logs; request IDs; error tracking | Provider setup not verified |
| 14. Monitoring/alerts | Uptime checks and actionable runbooks for homepage/auth/report flow | Configure externally and test alerts |
| 15. Scaling | Indexes, pagination, measure then load-test | Defer infrastructure expansion until measured |

## Universal verification gate
Before calling a task done: run lint, typecheck if available, tests, and build; report exact output; list changed files; identify skipped/stubbed work and assumptions. Do not claim database migration, live login, deployment, backup restore, monitoring, or CI is complete unless actually verified.

## First release priorities
1. Confirm app URL and all keys belong to the intended backend.
2. Apply `drizzle/migrations/0001_uid_auth_repair.sql` to that backend only.
3. Verify existing users' Auth metadata includes UID; backfill cannot infer missing UIDs.
4. Test a new signup, email confirmation, successful UID login, wrong-password login, logout, and item ownership.
5. Run build/lint/tests and review the production bundle for secrets.
