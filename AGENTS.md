# CampusFind project instructions

## Product and stack
CampusFind is a campus lost-and-found app for Chandigarh University students. Preserve the current editorial design and routes. Stack: React, TypeScript, TanStack Start/Router, Tailwind CSS, Supabase Auth/Postgres through the configured backend.

## Safety and engineering rules
- Never print, commit, or expose .env values, API keys, service-role keys, tokens, passwords, or user credentials.
- The service-role key is server-only. Import client.server.ts dynamically inside server functions; never from browser components.
- Every schema change must be versioned under drizzle/migrations and applied only to the verified connected database.
- Never claim a build, test, migration, login, deployment, backup restore, or alert has passed without observed evidence.
- Validate inputs on the server; enforce authorization through server checks and database RLS.
- Use Supabase Auth for password handling and sessions. Never store raw passwords.
- Return the same generic error for incorrect UID and incorrect password. Distinguish infrastructure failures without exposing database details.
- Do not add payments, multi-tenancy, Redis, microservices, or paid observability without a concrete requirement and approval.
- Preserve existing UI unless a change is necessary for correctness, accessibility, or security.
- Run lint, typecheck, tests, and build before marking repository work complete; list exact results and remaining external setup.

## Commands
- Install: npm install
- Development: npm run dev
- Lint: npm run lint
- Typecheck: npx tsc --noEmit
- Tests: npm test
- Build: npm run build

## Important files
- Frontend surfaces use semantic colors from src/styles.css and explicit page classes; modal focus management uses AccessibleModal with existing Radix primitives to keep keyboard access consistent without altering workflows.
- src/lib/auth.functions.ts: server-side UID login
- src/lib/uid.ts: UID normalization and validation
- src/integrations/supabase/client.ts: browser Supabase client
- src/integrations/supabase/client.server.ts: server-only admin client
- drizzle/migrations: SQL migrations
- docs: system design, architecture, permissions, threat model, runbooks, and 15-layer readiness
