# Local hosting and environment requirements

## Local development

This repository runs locally with Vite and TanStack Start. Start the development server with `npm run dev` and open the localhost URL printed in the terminal.

The app uses the Supabase-compatible backend configured in the local `.env` file. Local hosting does not automatically migrate or replace that backend. To fully leave a managed backend provider, provision a standalone Supabase project, migrate the database/auth configuration and data, then update local environment variables after verifying the destination.

## Required environment variables

- `VITE_SUPABASE_URL`: browser-facing endpoint.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: browser-safe publishable key.
- `SUPABASE_URL`: server-side endpoint for the same backend.
- `SUPABASE_PUBLISHABLE_KEY`: publishable key for server-side password sign-in.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only admin key. Never expose it to client bundles.
- `DATABASE_URL`: optional direct PostgreSQL connection string for Drizzle migrations.
- `SUPABASE_PROJECT_ID`: optional project identifier for your own backend.

## Release checks

- Verify endpoint, publishable key, service-role key, and database all belong to the same backend.
- Never commit `.env` or paste secret values into chat/issues.
- Keep preview/staging separate from production where possible.
- Confirm HTTPS, deployment rollback, backup retention, and provider billing alerts before deploying.
- The endpoint hostname alone does not prove which database should receive a migration.
