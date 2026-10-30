# CampusFind monitoring plan

## Initial low-cost checks
- External uptime check for the public homepage.
- Smoke check for the /auth page.
- Scheduled smoke test for browse/report workflow once a non-production test account and safe cleanup are available.
- Review the selected hosting provider's deployment logs after each release and when a user reports a failure.

## Alerts
- Homepage unavailable for 5 minutes: investigate hosting/deployment and roll back if the latest release caused it.
- Auth page unavailable or login smoke test fails twice consecutively: investigate provider configuration, auth logs, and profile schema.
- Repeated database/configuration errors: verify the live migration and confirm the keys/endpoints belong to the same backend.
- Dependency/security alert: assess severity and affected code path before upgrading.

## Privacy
Never include passwords, access/refresh tokens, service-role keys, full emails, or raw UIDs in monitoring events. Do not configure a paid error tracker until the owner chooses a provider and supplies its project credentials.
