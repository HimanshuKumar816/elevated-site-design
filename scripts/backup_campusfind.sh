#!/usr/bin/env bash
set -euo pipefail

# CampusFind PostgreSQL backup for macOS.
# Creates and validates a local custom-format dump, then mirrors it to the
# Google Drive for desktop "My Drive" folder so the Drive client can sync it.

PROJECT_REF="upkyaupivigspwwunqpg"
DB_HOST="aws-0-ap-southeast-1.pooler.supabase.com"
DB_PORT="6543"
DB_USER="postgres.${PROJECT_REF}"
DB_NAME="postgres"

BACKUP_DIR="$HOME/Desktop/CampusFind-Backup"
LOG_DIR="$BACKUP_DIR/logs"
KEYCHAIN_SERVICE="CampusFind-Supabase-DB"
KEYCHAIN_ACCOUNT="$DB_USER"

# Optional override. When empty, the script looks for the single signed-in
# Google Drive for desktop "My Drive" folder under ~/Library/CloudStorage.
DRIVE_ROOT="${CAMPUSFIND_GOOGLE_DRIVE_DIR:-}"

export PATH="$(/opt/homebrew/bin/brew --prefix libpq 2>/dev/null || true)/bin:/usr/local/opt/libpq/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$BACKUP_DIR" "$LOG_DIR"
LOG_FILE="$LOG_DIR/backup-$(date '+%Y-%m-%d').log"
exec >> "$LOG_FILE" 2>&1

echo "===== CampusFind backup started: $(date) ====="

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not found. Install libpq with Homebrew."
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "ERROR: pg_restore not found. Install libpq with Homebrew."
  exit 1
fi

DB_PASSWORD="$(/usr/bin/security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w 2>/dev/null || true)"
if [[ -z "$DB_PASSWORD" ]]; then
  echo "ERROR: Supabase DB password is not available in macOS Keychain."
  exit 1
fi

export PGPASSWORD="$DB_PASSWORD"
BACKUP_FILE="$BACKUP_DIR/campusfind-$(date '+%Y-%m-%d_%H-%M-%S').dump"

pg_dump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$BACKUP_FILE"

unset PGPASSWORD DB_PASSWORD

if [[ ! -s "$BACKUP_FILE" ]]; then
  echo "ERROR: Backup file is missing or empty."
  exit 1
fi

if ! pg_restore --list "$BACKUP_FILE" >/dev/null 2>&1; then
  echo "ERROR: PostgreSQL could not read the backup archive."
  exit 1
fi

echo "SUCCESS: Local backup created and archive listing verified: $BACKUP_FILE"

# Find Google Drive for desktop. If more than one account is signed in, fail
# clearly instead of silently copying into the wrong Drive.
if [[ -z "$DRIVE_ROOT" ]]; then
  shopt -s nullglob
  DRIVE_CANDIDATES=("$HOME"/Library/CloudStorage/GoogleDrive-*/"My Drive")
  shopt -u nullglob

  if [[ ${#DRIVE_CANDIDATES[@]} -eq 1 ]]; then
    DRIVE_ROOT="${DRIVE_CANDIDATES[0]}"
  elif [[ ${#DRIVE_CANDIDATES[@]} -gt 1 ]]; then
    echo "ERROR: Multiple Google Drive accounts were found. Set CAMPUSFIND_GOOGLE_DRIVE_DIR to the intended My Drive folder."
    exit 1
  elif [[ -d "$HOME/Google Drive/My Drive" ]]; then
    DRIVE_ROOT="$HOME/Google Drive/My Drive"
  fi
fi

if [[ -z "$DRIVE_ROOT" || ! -d "$DRIVE_ROOT" ]]; then
  echo "ERROR: Google Drive for desktop My Drive folder was not found."
  echo "The local backup is safe at: $BACKUP_FILE"
  echo "Sign in to Google Drive for desktop or set CAMPUSFIND_GOOGLE_DRIVE_DIR to the My Drive folder."
  exit 1
fi

DRIVE_BACKUP_DIR="$DRIVE_ROOT/CampusFind-Backups"
mkdir -p "$DRIVE_BACKUP_DIR"
DRIVE_FILE="$DRIVE_BACKUP_DIR/$(basename "$BACKUP_FILE")"

cp -p "$BACKUP_FILE" "$DRIVE_FILE"
if ! cmp -s "$BACKUP_FILE" "$DRIVE_FILE"; then
  echo "ERROR: The Google Drive folder copy does not match the local backup."
  exit 1
fi

echo "SUCCESS: Verified a matching local copy in Google Drive for desktop: $DRIVE_FILE"
echo "NOTE: Google Drive may still be synchronizing. Verify the file appears in Google Drive on the web."

# Retain recent local dumps and logs. Do not automatically delete cloud copies.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'campusfind-*.dump' -mtime +7 -delete
find "$LOG_DIR" -maxdepth 1 -type f -name 'backup-*.log' -mtime +14 -delete

echo "===== CampusFind backup finished: $(date) ====="
