# CampusFind

CampusFind is a campus lost-and-found website for Chandigarh University students. Students can create accounts using a university UID, browse lost/found reports, and submit reports to help return belongings.

## Technology

- React + TypeScript
- TanStack Start and React Router
- Tailwind CSS
- Supabase Auth and PostgreSQL
- Vite for local development and builds

## Run locally

Requirements: Node.js 20+ and npm.

```sh
git clone https://github.com/HimanshuKumar816/elevated-site-design.git
cd elevated-site-design
npm install
cp .env.example .env
```

Fill in the environment variables in `.env` using the credentials for the Supabase-compatible backend you intend to use. Use the same backend for the browser and server. The publishable key is safe for browser use; the service-role key must remain server-side and must never use a `VITE_` prefix.

Then start the local development server:

```sh
npm run dev
```

Open the exact localhost URL printed by Vite.

## Useful commands

```sh
npm run dev
npm run lint
npx tsc --noEmit
npm test
npm run build
npm run preview
```

## Environment variables

See `.env.example`. Never commit `.env` or paste credentials into issues or chat.

## Engineering documentation

- [System design](docs/system-design.md)
- [Architecture and UID login diagnosis](docs/architecture.md)
- [15-layer Vibe Coding Playbook readiness checklist](docs/15-layer-playbook-readiness.md)
- [Database migration runbook](docs/runbooks/database-migration.md)
- [Security threat model](docs/security/threat-model.md)
- [Hosting and environment](docs/hosting.md)

## Database migrations

SQL migration files are versioned under `drizzle/migrations`. Committing a migration does not execute it. Confirm the target database and take a backup before applying migrations. Do not apply a migration to a production database without reviewing its contents and confirming the backend project.
