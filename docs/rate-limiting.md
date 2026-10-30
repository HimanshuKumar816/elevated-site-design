# Rate limiting and abuse controls

## Current assessment
Login and signup are sensitive public entry points. The application should use provider-level limits and, where supported by the hosting platform, per-IP/per-identity limits. Do not add an in-memory counter and call it production protection: it resets on deploy and does not coordinate across instances.

## Required checks
- Confirm Supabase Auth rate limits for signup and password sign-in in the connected provider dashboard.
- Verify repeated invalid login attempts are throttled and return safe errors.
- Verify signup abuse controls or CAPTCHA/bot protection supported by the chosen provider.
- Avoid revealing whether a UID exists; wrong UID and wrong password should return the same message.
- If stronger application-level limits are needed, choose a shared store only after approving its operational cost.
- Record actual thresholds and test results before launch.

## Status
Provider settings and a repeat-attempt test have not been verified from this repository.
