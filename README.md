# Elevated Site Design

build a premium and professional website

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://elevated-site-design.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/8857771c-69b5-45a5-bb4f-bc666bb336ae).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```


## Project engineering docs

- [System design](docs/system-design.md)
- [Architecture and UID login diagnosis](docs/architecture.md)
- [15-layer Vibe Coding Playbook readiness checklist](docs/15-layer-playbook-readiness.md)
- [UID login repair SQL migration](drizzle/migrations/0001_uid_auth_repair.sql)

## UID login repair — important deployment note

The repair migration is versioned in Git, but adding a SQL file to Git does **not** execute it against the hosted database. Apply it only in the SQL editor for the exact database used by the Lovable Cloud project. The app's configured endpoint is a Lovable Cloud runtime hostname, so do not substitute a guessed Supabase URL. After applying, verify `public.profiles`, the `on_auth_user_created` trigger, and a test account's UID metadata; then test signup, email confirmation, UID login, and incorrect credentials.

Do not paste or commit any `.env` values or service-role key.


## Engineering and release documentation

- System design: docs/system-design.md
- Architecture: docs/architecture.md
- API conventions: docs/api-conventions.md
- Permission model: docs/permissions.md
- Threat model: docs/security/threat-model.md
- Hosting/environment: docs/hosting.md
- Caching: docs/caching.md
- Rate limiting: docs/rate-limiting.md
- Monitoring: docs/monitoring.md
- Scaling: docs/scaling.md
- Database migration runbook: docs/runbooks/database-migration.md
- Backup, deploy, and incident runbooks: docs/runbooks/
- Fifteen-layer playbook checklist: docs/15-layer-playbook-readiness.md
- Environment variable template: .env.example

## UID login repair

UID login depends on public.profiles and the on_auth_user_created trigger in the same database that the Lovable project uses. The migration file is versioned in drizzle/migrations/0001_uid_auth_repair.sql, but committing SQL does not apply it to the live database. Follow docs/runbooks/database-migration.md and verify the connected project before applying it. The service-role key must remain server-side.
