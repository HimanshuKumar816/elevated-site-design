# CampusFind database backups

## Automated backup workflow

The repository includes `.github/workflows/database-backup.yml`. It runs daily at 17:30 UTC (23:00 IST) and can also be started manually from GitHub Actions.

Before it can run, add a repository Actions secret:

1. Open the GitHub repository Settings.
2. Go to Secrets and variables → Actions → New repository secret.
3. Set the name to `SUPABASE_DB_URL`.
4. Paste the Supabase PostgreSQL connection URI from Project Settings → Database. Use the direct connection when the runner can reach it, or the **session pooler** URI when IPv4 access is needed; do not use the transaction pooler for `pg_dump`. Require SSL (`sslmode=require`).

The workflow uses the PostgreSQL 17 client, creates a custom-format `pg_dump`, and stores it as a GitHub Actions artifact for 30 days. Keep the connection URI private and rotate its database password if it is ever exposed.

## Restore test

Download a backup artifact and restore it only into a separate, non-production PostgreSQL database:

```bash
pg_restore --no-owner --no-acl --clean --if-exists --dbname="$RESTORE_DATABASE_URL" campusfind-backup.dump
```

Then verify sign-in/profile records, items, claims, matches, notifications, and Storage metadata. Do not run a restore against production as a test.

## Limits

This is a scheduled export stored outside the Supabase database, not point-in-time recovery. Artifacts expire after 30 days and remain subject to GitHub Actions artifact availability and quota. A second independent destination (such as S3-compatible object storage) and periodic restore drills are recommended for long-term retention. The workflow cannot run until `SUPABASE_DB_URL` is configured.
