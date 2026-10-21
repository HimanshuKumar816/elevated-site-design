# CampusFind threat model

## Assets
Auth credentials and sessions; student UID and email; lost/found reports; profile records; server-only service-role key; database availability.

## Entry points and risks

| Entry point | Threat | Current mitigation | Remaining verification |
|---|---|---|---|
| Signup form | malformed input, spam, duplicate UID | input validation and Auth provider | server validation, provider rate limits, duplicate UID tests |
| UID login | brute force, account enumeration | generic invalid-credential response; server-only UID lookup | verify rate limiting and redacted logs |
| Auth session | token theft or misuse | Supabase Auth session handling | verify HTTPS, expiry, logout and revocation |
| Browse reports | scraping, over-fetching | database/RLS | inspect pagination and deployed cache headers |
| Report writes | IDOR / modifying another user's report | RLS ownership policies | two-account direct API tests |
| Text fields | stored/reflected XSS | React escapes text by default | test all fields; avoid unsafe HTML rendering |
| Redirect parameter | open redirect | auth route accepts local paths and rejects // | test encoded and unusual URLs |
| Environment/config | service-role key leak or project mismatch | server-only client and environment variables | inspect production bundle, logs and Git history |
| Database | schema missing, broad RLS, data loss | versioned migration and constraints | apply to correct backend; test RLS and restore |

## Release review
This is a preliminary threat model, not a penetration test. Re-review auth, file uploads, and database policies before launch.
