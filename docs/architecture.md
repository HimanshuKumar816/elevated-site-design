# Architecture — CampusFind

## Request flow
Browser (React/TanStack Router) → TanStack Start server function for privileged work → Supabase Auth/Postgres via the endpoint configured in the local or deployment environment.

## Components
- UI: routes/components; never contains service-role credentials.
- Auth: Supabase Auth handles passwords, confirmation, access tokens, refresh tokens.
- UID mapping: server-only function normalizes UID, looks up `profiles.id`, resolves the Auth user's email, then calls Supabase password sign-in.
- Data: Postgres `profiles` and `items`; RLS governs user access.
- Hosting: local Vite development; external hosting is configured separately.

## Critical environment rule
The standalone CampusFind Supabase project is configured through `.env.example`. Keep browser and server URL/publishable key values aligned to the same project. The service-role key, if needed, must remain server-only and must never be committed or included in browser bundles.

## Known login failure modes
1. The database is missing `public.profiles` or `public.items`.
2. Existing Auth users have no profile row because the trigger was added after signup.
3. The Auth user's metadata has no `uid`, so backfill cannot map it automatically.
4. UID duplicates or inconsistent normalization exist.
5. URL and keys belong to different projects.
6. Email confirmation is required but has not been completed.
7. Server-side UID lookup is not configured with its required privileged credentials.

## Simplicity decisions
Keep a modular monolith. Do not add queues, Redis, payment systems, or microservices without measured requirements.
