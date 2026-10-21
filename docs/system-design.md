# System Design — CampusFind

## Product
CampusFind is a campus lost-and-found website for Chandigarh University students. Students create accounts with a university UID, browse lost/found reports, and submit reports.

## Roles
- Visitor: view public pages and browse navigation.
- Student: create an account, confirm email when required, sign in, browse reports, and manage own submissions.
- Operator: maintain the project, database configuration, deployment, and incident response. No separate admin interface is assumed.

## Core workflows
1. Sign up using UID, full name, email, and password.
2. Confirm email if Supabase Auth requires it.
3. Sign in with UID and password.
4. Browse lost/found items.
5. Submit a lost/found report.
6. Sign out.

## Data and sensitivity
- Supabase Auth owns credentials and sessions; never store raw passwords in application tables.
- Profile: Auth user ID, normalized unique UID, display name, creation time.
- Item: owner ID, Lost/Found type, name, category, location, date, note, creation time.
- Treat UID, email, password, tokens, and any service-role credential as sensitive. Never log credentials.

## Security requirements
- Password hashing and session lifecycle are handled by Supabase Auth.
- Normalize UID consistently on signup, login, trigger, and backfill.
- Service-role key is server-only and bypasses RLS; use it only in trusted server functions.
- Use RLS for all user-owned data and test cross-user access.
- Return a generic message for unknown UID and incorrect password.
- Validate and bound input on the server.
- Public browsing of item reports is an explicit current product policy; item create/update/delete must be owner-scoped.

## Non-functional requirements
- Responsive at 375px mobile width and desktop.
- Forms and data views provide loading, empty, error, and success states.
- Add pagination as report volume grows; avoid unbounded reads.
- Keep launch operations simple and costs low.

## Out of scope for initial launch
Payments, subscription billing, organisation multi-tenancy, realtime chat, AI image matching, Kubernetes, microservices, and paid analytics until validated need exists.
