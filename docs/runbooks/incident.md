# Incident response runbook

## Declare an incident when
- The homepage or auth flow is unavailable for multiple checks.
- Students cannot sign in or submit reports.
- Unauthorized access to reports/profile data is suspected.
- A credential or service-role key may have leaked.

## First response
1. Record time, affected route/workflow, observed error, and deployment version.
2. Never paste secrets, tokens, passwords, emails, or raw UIDs into tickets or chat.
3. For a recent release regression, roll back the app through the hosting platform.
4. For suspected key exposure, rotate the affected key in the provider and update hosting secrets; never put the replacement key in Git.
5. For suspected data exposure, restrict affected access, preserve logs, and assess impact before notifications required by applicable rules.
6. Validate the core user flow after mitigation.

## Post-incident review
Record impact, timeline, root cause, what worked, follow-up actions, owner, and due date. Do not blame individuals.
