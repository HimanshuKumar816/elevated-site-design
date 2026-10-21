# Project: CampusFind

## What this product does
CampusFind is a campus lost-and-found website for Chandigarh University students. Students create accounts using a university UID, browse lost/found reports, and submit reports to help return belongings.

## Stack (do not change without asking)
- Frontend: React + TypeScript + TanStack Start/Router + Tailwind CSS
- Backend: TanStack Start server functions
- Database: PostgreSQL through the Lovable Cloud/Supabase integration
- Auth: Supabase Auth
- Hosting: Lovable, synchronized with GitHub

## Rules
- Never commit secrets. Keep all credentials in environment variables and document variable names in .env.example.
- Never expose the service-role key in browser code, logs, issues, or chat.
- Every database change must be a migration file and applied only to the verified connected backend.
- Every server endpoint/function validates input, authenticates the caller where required, and enforces ownership/authorization.
- Supabase Auth owns password hashing and session lifecycle. Never store raw passwords.
- Wrong UID and wrong password return the same generic error. Infrastructure errors may be separate but must not expose database internals.
- Run lint, typecheck, tests, and build before claiming repository work is complete.
- Never claim a live migration, successful live login, deployment, restore, alert, or load test without observed evidence.
- Ask before adding dependencies or paid services.
- Prefer small, reviewable changes. Preserve the existing visual design and routes.
- List every changed file, tests and output, skipped work, and assumptions in completion reports.

## Commands
- Install: npm install
- Dev: npm run dev
- Test: npm test
- Lint: npm run lint
- Typecheck: npx tsc --noEmit
- Build: npm run build

## Architecture decisions
See docs/architecture.md, docs/decisions/, docs/permissions.md, docs/api-conventions.md, and docs/15-layer-playbook-readiness.md.
