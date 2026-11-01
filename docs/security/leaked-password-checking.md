# Leaked password checking

CampusFind checks new passwords against the free [HIBP Pwned Passwords range API](https://haveibeenpwned.com/API/v3#PwnedPasswords) before sending them to Supabase Auth. This custom check supplements Supabase Auth; it does not enable Supabase's native leaked-password protection.

## How the check works

The browser computes a SHA-1 digest in memory solely for the HIBP lookup protocol. It sends only the first five hexadecimal characters to `https://api.pwnedpasswords.com/range/{prefix}` over HTTPS, with `Add-Padding: true`. It compares the returned suffixes locally, discards the response when the check finishes, and sends no password or complete hash to HIBP. HIBP receives the range prefix and ordinary request metadata such as the network address; padding reduces response-size leakage. The hash is not used for account authentication or storage; Supabase Auth remains responsible for password handling.

The request is made only after a complete password is submitted, never while someone types or during login. The API request has a five-second timeout and is not cached. A user can retry by submitting the form again.

## Protected flows and failures

- Account creation is checked before the SMS signup request; the same in-memory check result is reused when the verified account's password is set. If that password update needs to be retried after an Auth error, a newly entered password is checked again.
- SMS password recovery is checked before `updateUser`.
- Reset-link password updates are checked before `updateUser`.
- Password sign-in is unchanged and does not depend on HIBP.

A positive breach count blocks the update and asks the user to choose another password. A timeout, network failure, rate limit, unexpected HTTP status, or malformed response fails closed: the password is not sent to Supabase Auth, and the user can try again later. Neither passwords nor hashes, suffix lists, or API response bodies are written to logs or persistent browser storage.

## Current password policy and limitations

The repository's existing policy remains 8–72 characters, without added complexity rules. The production Supabase Auth password policy was not changed or queried by this code update. In the Supabase Dashboard, open the CampusFind project, then **Authentication → Settings → Password Security**; inspect the minimum length and keep it aligned with the frontend. If choosing a 12-character minimum, update both the Auth setting and `PASSWORD_MIN_LENGTH` together. Supabase documents native leaked-password protection as Pro and above; this custom browser check does not clear that native advisory and cannot replace server-side enforcement. A determined client can bypass frontend checks, and the check depends on HIBP availability. Passwords are therefore still handled and stored only by Supabase Auth.

## Verification

Run the mocked API tests with `npm test -- --run src/lib/pwned-password.test.ts`. The tests use synthetic password values and mocked responses; they do not call HIBP or Supabase. Run the full local checks with `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run build`.
