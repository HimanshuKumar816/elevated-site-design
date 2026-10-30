# API and server-function conventions

CampusFind is a single-campus lost-and-found app, not a multi-tenant commercial SaaS. Do not introduce organisation billing or role systems the product does not need.

## Rules
- Validate every input at the server-function boundary. Normalize UID through src/lib/uid.ts.
- Never accept a browser-supplied owner ID as proof of ownership. Derive identity from a verified session.
- Return stable, user-safe errors. Authentication failures must not reveal whether a UID exists.
- Log only non-sensitive diagnostics such as operation and error code. Never log passwords, access/refresh tokens, publishable keys, service-role keys, raw UID, or email.
- List endpoints must be bounded and paginated as report volume grows. Select only fields needed by the UI.
- Enforce ownership in server logic and Postgres RLS.
- Do not add payments, webhooks, or background queues until required.

## Authentication
The browser uses Supabase Auth for signup and session storage. UID login is a server function: normalize UID, look up the matching profile, resolve the Auth user's email using the server-only admin client, then call Supabase password sign-in. Passwords are never stored in profiles.

## Error handling
- Wrong UID and wrong password return the same generic message.
- Database/configuration failures return a separate generic service-unavailable message and log only a safe error code.
- Never return raw database errors or stack traces to the browser.
