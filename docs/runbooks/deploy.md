# Deployment runbook

## Before deployment
1. Confirm the change is committed to the intended GitHub branch and synced to Lovable.
2. Require CI lint, typecheck, tests, and production build to pass.
3. Review the diff for secrets, unsafe migrations, and unintended design changes.
4. Confirm production endpoint and all keys belong to the intended backend.
5. Verify the database migration has been applied separately to that backend.

## Release
1. Deploy through the existing Lovable workflow.
2. Open the homepage and /auth.
3. Test sign-up and login with a designated non-production account where possible.
4. Test browse and create a test report, then remove test data using the normal authorized workflow.
5. Review deployment logs for errors.

## Rollback
Use Lovable's previous-deployment/version controls if a release causes a regression. Revert the Git change if needed. A code rollback does not automatically roll back a database migration; plan database rollback independently.
