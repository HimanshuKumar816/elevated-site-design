# CampusFind database backups

## GitHub Actions encrypted backup

The repository includes `.github/workflows/database-backup.yml`. It is scheduled daily at 17:30 UTC (23:00 IST) and can be started manually from GitHub Actions.

Configure both repository Actions secrets before running it:

1. `SUPABASE_DB_URL`: the PostgreSQL connection URI from the intended Supabase project's Database settings. Use a direct connection when reachable from GitHub-hosted runners, or the **session pooler** URI if IPv4 access is needed. Do not use the transaction pooler for `pg_dump`. Require SSL (for example, `sslmode=require`).
2. `CAMPUSFIND_BACKUP_PASSPHRASE`: a strong, unique passphrase of at least 24 characters. Store it in a password manager or another secure offline location. Do not commit it, paste it into chat, or store it in the repository.

The workflow uses the PostgreSQL 17 client to create a custom-format dump, encrypts it with GnuPG symmetric AES-256 encryption, decrypts it on the ephemeral runner to validate the archive, and uploads only the encrypted `.dump.gpg` file as a GitHub Actions artifact for 30 days. The plaintext dump is removed from the runner workspace before artifact upload. The passphrase is needed to decrypt future artifacts; losing it makes those backups unusable.

## Restore test

Download an encrypted artifact and decrypt it on a trusted machine:

```bash
gpg --output campusfind.dump --decrypt campusfind.dump.gpg
pg_restore --list campusfind.dump
```

To test a full restore, use a separate, non-production PostgreSQL database:

```bash
pg_restore --no-owner --no-acl --clean --if-exists --dbname="$RESTORE_DATABASE_URL" campusfind.dump
```

Then verify profiles/Auth references, items, claims, matches, notifications, and Storage metadata. Do not restore over production as a test. Remove temporary plaintext dumps securely after the test and keep the passphrase separate from the backup artifact.

## macOS local backup

The Mac backup script uses `pg_dump` and retrieves the database password from macOS Keychain. Its custom-format archive can be checked with:

```bash
pg_restore --list "$HOME/Desktop/CampusFind-Backup/backup_test.dump"
```

A successful archive listing is not a full restore test. Review the latest dated log under `~/Desktop/CampusFind-Backup/logs` and confirm the LaunchAgent is loaded. The launchd template schedules the script at 23:00 local time.

## Google Drive for desktop

A copy inside the local Google Drive for desktop folder is only queued for synchronization; it does not by itself prove the file reached Google's cloud. Open Google Drive on the web and verify that a recent CampusFind backup is visible there. Keep a second independent copy and periodically test that it can be downloaded and restored.

## Limits

These scheduled exports are not point-in-time recovery. GitHub artifacts expire after 30 days and remain subject to GitHub Actions availability and quota. The Mac copy and Google Drive copy have separate failure modes; keep the encrypted GitHub artifact as an additional destination. Rotate the database password if the connection URI is exposed, and rotate the backup passphrase if it is exposed.
