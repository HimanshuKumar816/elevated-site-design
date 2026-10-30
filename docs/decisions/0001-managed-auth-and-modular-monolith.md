# ADR 0001: Managed auth and modular monolith

## Context
CampusFind is an early-stage campus lost-and-found app. It needs UID-based sign-in, student reports, and simple operation by a small team.

## Decision
Keep the existing React/TanStack Start app as a modular monolith. Use Supabase Auth for password verification and session handling, Supabase Postgres for data, Vite/TanStack Start for local development, hosting selected separately, and a server-only UID-to-auth-user lookup.

## Alternatives considered
- Custom password hashing/session storage: rejected because it duplicates security-sensitive functionality.
- Microservices, Kubernetes, Redis, or a job queue: rejected until measured needs justify their operational cost.
- Separate organisation/tenant model: rejected because the current product is a single university campus app, not a multi-customer SaaS.

## Consequences
- The correct connected backend and matching environment keys are essential.
- UID lookup must remain server-side and profile RLS must not expose private profile data.
- Live database migrations and production behavior require provider-level verification.
