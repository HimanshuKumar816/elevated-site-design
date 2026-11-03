# CampusFind threat model

## Assets
Auth credentials and sessions; student UID and email; lost/found reports; profile records; server-only service-role key; database availability.

## Entry points and risks

| Entry point | Threat | Current mitigation | Remaining verification |
|---|---|---|---|
| Signup form | malformed input, spam, duplicate UID | client validation, signup flow and database constraints | verify provider-side signup/OTP throttling and duplicate UID behavior against production |
| UID login | brute force, account enumeration | UID/password validation, generic invalid-credential response, UID lookup in Supabase Edge Function | apply and verify rate limiting at the Edge Function/provider boundary; verify redacted logs |
| Auth session | token theft or misuse | Supabase Auth session handling over HTTPS | verify expiry, refresh-token rotation, logout/revocation and storage behavior |
| Browse reports | scraping, over-fetching | Supabase queries and RLS | verify page limits, RLS policies, and deployed cache headers |
| Report writes | IDOR / modifying another user's report | authenticated route and database ownership policies | two-account direct API tests for create, update, delete, claims and storage objects |
| Text fields | stored/reflected XSS | React text rendering escapes content by default; server HTML metadata is escaped | regression-test every user-controlled field and prohibit unsafe HTML rendering without sanitization |
| Redirect parameter | open redirect | auth route accepts local paths and rejects protocol-relative paths | test encoded, backslash, whitespace and unusual URL forms |
| Environment/config | service-role key leak or project mismatch | server-only credentials are not explicitly injected into client bundle; `.env` is gitignored | inspect production bundle, logs and Git history; verify Render project URL, project ID and publishable key belong together |
| HTTP security | XSS, clickjacking, MIME sniffing, sensitive caching | server sets CSP, nonce, frame, MIME, referrer, permissions, HSTS and no-store headers | verify headers on live routes and keep CSP aligned with deployed dependencies |
| Database | schema missing, broad RLS, data loss | versioned migrations and database constraints | verify migration ledger, grants, RLS policies, security-definer functions and tested restore on the surviving project |
| Dependencies | vulnerable transitive package | lockfile and CI build | CI now runs a high-severity dependency audit; resolve findings before release |

## Release checklist

- [ ] Confirm Supabase URL, project ID and publishable key all refer to the same surviving project.
- [ ] Confirm no service-role key, database password, admin password or cron secret is present in the repository, client bundle, build logs or Git history.
- [ ] Verify auth provider rate limits and OTP abuse controls on the deployed Edge Function.
- [ ] Test with two student accounts that each can only read/update their own private records and storage objects.
- [ ] Test that a student cannot access admin data or invoke admin-only actions by calling Supabase directly.
- [ ] Inspect RLS policies, grants, SECURITY DEFINER functions and indexes on the production database.
- [ ] Verify CSP and other security headers on the live app, including private pages and API responses.
- [ ] Verify that private routes and API responses are not cached or indexed.
- [ ] Verify backup readability and a restore drill before schema changes.

This is a repository-level security review, not a penetration test. A passing build or route guard does not prove database authorization. Production controls must be verified against the deployed Supabase project and Render service before release.