# ADR 0002: UID login maps to Supabase Auth email

## Context
Students expect to sign in using a university UID and password, while Supabase Auth's password sign-in expects an email or phone identifier.

## Decision
Normalize the UID, look up the matching profile on the server using the admin client, retrieve the linked Auth user's email, then call Supabase Auth password sign-in. Keep both invalid UID and invalid password responses generic.

## Alternatives considered
- Store passwords in profiles: rejected.
- Expose UID-to-email lookup in browser code: rejected because it leaks private account data.
- Replace the managed auth provider: rejected.

## Consequences
- Every Auth user needs a matching profile row and normalized UID.
- The profile creation trigger and backfill migration must be installed in the same backend used by the app.
- Database/configuration failures should be observable in redacted server logs and should not masquerade as a wrong password.
