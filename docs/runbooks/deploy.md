# Local development and release runbook

## Local development
1. Pull the latest intended GitHub branch.
2. Install dependencies with `npm install`.
3. Create a local `.env` from `.env.example` and configure the intended backend.
4. Start with `npm run dev` and open the localhost URL printed in the terminal.

## Before an external deployment
1. Choose and configure the hosting provider independently of this repository.
2. Set browser-safe `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at build time.
3. Set server-only `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the server environment.
4. Require CI lint, typecheck, tests, and production build to pass.
5. Review the diff for secrets, unsafe migrations, and unintended design changes.
6. Confirm production endpoint and all keys belong to the intended backend.
7. Verify the database migration has been applied separately to that backend.

## Release verification
1. Open the homepage and authentication route.
2. Test sign-up and login with a designated non-production account where possible.
3. Test browsing and creating a test report, then remove test data using the normal authorized workflow.
4. Review server logs for errors.

## Rollback
Use the selected hosting provider's previous-deployment/version controls if available. Revert the Git change if needed. A code rollback does not automatically roll back a database migration; plan database rollback independently.
