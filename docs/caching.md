# Caching and CDN policy

## Current strategy
- Let the configured hosting platform/CDN handle fingerprinted static assets.
- Public marketing pages may use hosting defaults.
- Authenticated responses, session data, profile data, and private user data must not be cached by a shared CDN.
- Do not add Redis or a paid cache service without a measured performance problem.

## Data rules
- Item report queries should be bounded and paginated as volume grows.
- After a report write, refresh the affected query or invalidate any client cache.
- If user-specific caching is added later, its key must include authenticated user scope.
- Verify production Cache-Control headers before launch; do not assume provider defaults.
