# Hosting and environment requirements

## Hosting
The current site is hosted through Lovable. The configured SUPABASE_URL is a Lovable Cloud runtime hostname, so do not replace it with a guessed Supabase project URL.

## Required environment variables
- VITE_SUPABASE_URL: browser-facing endpoint configured by Lovable.
- VITE_SUPABASE_PUBLISHABLE_KEY: browser-safe publishable key.
- SUPABASE_URL: server-side endpoint for the same backend.
- SUPABASE_PUBLISHABLE_KEY: publishable key for server-side password sign-in.
- SUPABASE_SERVICE_ROLE_KEY: server-only admin key. Never expose it to client bundles.
- SUPABASE_PROJECT_ID and VITE_SUPABASE_PROJECT_ID: project identifiers supplied by the integration.

## Release checks
- Verify endpoint, publishable key, service-role key, and database all belong to the same backend.
- Never commit .env or paste secret values into chat/issues.
- Keep preview/staging separate from production where the platform supports it.
- Confirm HTTPS, deployment rollback, backup retention, and provider billing alerts in the hosting dashboard.
- The runtime hostname alone does not prove which dashboard project should receive a migration.
