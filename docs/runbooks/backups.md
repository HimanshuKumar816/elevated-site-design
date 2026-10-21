# Database backup and restore runbook

## Current status
Backup frequency, retention, point-in-time recovery, and restore capability are controlled by the connected database provider and have not been verified from this repository.

## Before launch
1. Identify the exact database connected to the Lovable Cloud project.
2. Verify automated backup frequency, retention, and point-in-time recovery availability in that provider's dashboard.
3. Record the provider's restore procedure and authorized operators.
4. Restore a backup into a separate non-production database; never test restoration over production.
5. Run smoke tests against the restored database and record the date and result.
6. Re-check backup status after plan or project changes.

## Incident warning
Do not run destructive SQL or restore over production without a verified backup and an approved recovery plan.
