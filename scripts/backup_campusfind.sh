#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

# CampusFind PostgreSQL backup for macOS.
# Creates and validates a local custom-format dump, then mirrors it to the
# Google Drive for desktop "My Drive" folder so the Drive client can sync it.

PROJECT_REF="vmpyjsmxynundpufyaqs"
DB_HOST="aws-0-ap-south-1.pooler.supabase.com"
DB_PORT="6543"
DB_USER="postgres.${PROJECT_REF}"
DB_NAME="postgres"

BACKUP_DIR="$HOME/Desktop/CampusFind-Backup"
LOG_DIR="$BACKUP_DIR/logs"
KEYCHAIN_SERVICE="CampusFind-Supabase-DB"
KEYCHAIN_ACCOUNT="$DB_USER"
KEYCHAIN_FILE="$HOME/Library/Keychains/login.keychain-db"
MAX_ATTEMPTS=3

# Optional override. When empty, the script looks for the single signed-in
# Google Drive for desktop "My Drive" folder under ~/Library/CloudStorage.
DRIVE_ROOT="${CAMPUSFIND_GOOGLE_DRIVE_DIR:-}"

export PATH="$(/opt/homebrew/bin/brew --prefix libpq 2>/dev/null || true)/bin:/usr/local/opt/libpq/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$BACKUP_DIR" "$LOG_DIR"
LOG_FILE="$LOG_DIR/backup-$(date '+%Y-%m-%d').log"
exec >> "$LOG_FILE" 2>&1

echo "===== CampusFind backup started: $(date) ====="
echo "Target Supabase project: $PROJECT_REF"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not found. Install libpq with Homebrew."
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "ERROR: pg_restore not found. Install libpq with Homebrew."
  exit 1
fi

DB_PASSWORD="$(/usr/bin/security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w "$KEYCHAIN_FILE" 2>/dev/null || true)"
if [[ -z "$DB_PASSWORD" ]]; then
  echo "ERROR: Supabase DB password is not available from the configured login Keychain item."
  exit 1
fi

export PGPASSWORD="$DB_PASSWORD"
TIMESTAMP="$(date '+%Y-%m-%d_%H-%M-%S')"
BACKUP_FILE="$BACKUP_DIR/campusfind-${TIMESTAMP}-$$.dump"
PARTIAL_FILE="$BACKUP_FILE.partial"
cleanup_partial() {
  if [[ -n "${PARTIAL_FILE:-}" && -e "$PARTIAL_FILE" ]]; then
    rm -f -- "$PARTIAL_FILE"
  fi
  unset PGPASSWORD DB_PASSWORD
}
trap cleanup_partial EXIT

backup_succeeded=false
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  echo "pg_dump attempt $attempt/$MAX_ATTEMPTS for project $PROJECT_REF"
  if pg_dump \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --format=custom \
    --no-owner \
    --no-acl \
    --file="$PARTIAL_FILE"; then
    if [[ -s "$PARTIAL_FILE" ]] && pg_restore --list "$PARTIAL_FILE" >/dev/null 2>&1; then
      if [[ -e "$BACKUP_FILE" ]]; then
        echo "ERROR: Refusing to overwrite an existing backup: $BACKUP_FILE"
        exit 1
      fi
      mv -- "$PARTIAL_FILE" "$BACKUP_FILE"
      backup_succeeded=true
      break
    fi
    echo "ERROR: Dump was empty or failed PostgreSQL archive validation on attempt $attempt."
  else
    echo "ERROR: pg_dump failed on attempt $attempt; see PostgreSQL error output above."
  fi
  rm -f -- "$PARTIAL_FILE"
  if [[ "$attempt" -lt "$MAX_ATTEMPTS" ]]; then
    sleep "$((attempt * 2))"
  fi
done

unset PGPASSWORD DB_PASSWORD
if [[ "$backup_succeeded" != true || ! -s "$BACKUP_FILE" ]]; then
  echo "ERROR: No valid backup was created after $MAX_ATTEMPTS attempts."
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
if [[ -e "$DRIVE_FILE" ]]; then
  echo "ERROR: Refusing to overwrite an existing Google Drive backup: $DRIVE_FILE"
  exit 1
fi

if ! cp -p "$BACKUP_FILE" "$DRIVE_FILE"; then
  echo "ERROR: Could not copy the validated backup into the Google Drive folder."
  # This path was confirmed absent above, so removing it cannot affect an
  # existing backup. Keep the verified local copy for recovery.
  rm -f -- "$DRIVE_FILE"
  exit 1
fi
if ! cmp -s "$BACKUP_FILE" "$DRIVE_FILE"; then
  echo "ERROR: The Google Drive folder copy does not match the local backup."
  rm -f -- "$DRIVE_FILE"
  exit 1
fi

echo "SUCCESS: Verified a matching local copy in Google Drive for desktop: $DRIVE_FILE"
echo "NOTE: Google Drive may still be synchronizing. Verify the file appears in Google Drive on the web."

echo "===== CampusFind backup finished: $(date) ====="
