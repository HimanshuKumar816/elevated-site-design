#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

# CampusFind PostgreSQL backup for macOS. The database password is read only
# from the configured login Keychain item and is never written to a file.

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

export PATH="$(/opt/homebrew/bin/brew --prefix libpq 2>/dev/null || true)/bin:/usr/local/opt/libpq/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PGSSLMODE=require
export PGCONNECT_TIMEOUT=15
export PGAPPNAME=CampusFindBackup

mkdir -p "$BACKUP_DIR" "$LOG_DIR"
chmod 700 "$BACKUP_DIR" "$LOG_DIR"
LOG_FILE="$LOG_DIR/backup-$(date '+%Y-%m-%d').log"
exec >> "$LOG_FILE" 2>&1
chmod 600 "$LOG_FILE"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$*"
}

log "===== CampusFind backup started ====="
log "Target Supabase project: $PROJECT_REF"

if ! command -v pg_dump >/dev/null 2>&1; then
  log "ERROR: pg_dump not found. Install PostgreSQL 17 client tools."
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  log "ERROR: pg_restore not found. Install PostgreSQL 17 client tools."
  exit 1
fi

if ! DB_PASSWORD="$(/usr/bin/security find-generic-password \
  -s "$KEYCHAIN_SERVICE" \
  -a "$KEYCHAIN_ACCOUNT" \
  -w "$KEYCHAIN_FILE" 2>/dev/null)"; then
  log "ERROR: Could not retrieve the configured database password from the login Keychain."
  exit 1
fi

if [[ -z "$DB_PASSWORD" ]]; then
  log "ERROR: The configured login Keychain item returned an empty password."
  exit 1
fi

export PGPASSWORD="$DB_PASSWORD"
unset DB_PASSWORD

TIMESTAMP="$(date '+%Y-%m-%d_%H-%M-%S')"
BACKUP_FILE="$BACKUP_DIR/campusfind-${TIMESTAMP}-$$.dump"
PARTIAL_FILE="$BACKUP_FILE.partial"
ATTEMPT_LOG="$LOG_DIR/pg_dump-${TIMESTAMP}-$$.log"
backup_succeeded=false

cleanup() {
  [[ ! -e "$PARTIAL_FILE" ]] || rm -f "$PARTIAL_FILE"
  [[ ! -e "$ATTEMPT_LOG" ]] || rm -f "$ATTEMPT_LOG"
  unset PGPASSWORD
}
trap cleanup EXIT

if [[ -e "$BACKUP_FILE" ]]; then
  log "ERROR: Refusing to overwrite a backup with the generated filename."
  exit 1
fi
if [[ -e "$PARTIAL_FILE" ]]; then
  log "ERROR: A partial file with the generated filename already exists; refusing to overwrite it."
  exit 1
fi

for (( attempt = 1; attempt <= MAX_ATTEMPTS; attempt++ )); do
  log "pg_dump attempt $attempt/$MAX_ATTEMPTS for project $PROJECT_REF"
  ATTEMPT_LOG="$(mktemp "$LOG_DIR/pg_dump-${TIMESTAMP}.XXXXXX")"

  if pg_dump \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --format=custom \
    --no-owner \
    --no-acl \
    --no-password \
    --file="$PARTIAL_FILE" > "$ATTEMPT_LOG" 2>&1; then
    if [[ -s "$PARTIAL_FILE" ]] && pg_restore --list "$PARTIAL_FILE" >/dev/null 2>> "$ATTEMPT_LOG"; then
      if [[ -e "$BACKUP_FILE" ]]; then
        log "ERROR: Refusing to overwrite an existing backup."
        exit 1
      fi
      chmod 600 "$PARTIAL_FILE"
      mv -n "$PARTIAL_FILE" "$BACKUP_FILE"
      if [[ -e "$PARTIAL_FILE" || ! -s "$BACKUP_FILE" ]]; then
        log "ERROR: Refusing to overwrite an existing backup."
        exit 1
      fi
      backup_succeeded=true
      break
    fi

    log "ERROR: pg_dump produced an empty or invalid custom-format archive."
    if [[ -s "$ATTEMPT_LOG" ]]; then
      cat "$ATTEMPT_LOG"
    fi
    rm -f "$PARTIAL_FILE"
    break
  else
    pg_dump_status=$?
    log "ERROR: pg_dump exited with status $pg_dump_status. PostgreSQL error follows."
    cat "$ATTEMPT_LOG"
    rm -f "$PARTIAL_FILE"

    if ! grep -Eiq 'could not connect|connection|SSL|timeout|server closed|temporary failure|unexpected EOF|network is unreachable' "$ATTEMPT_LOG"; then
      log "ERROR: Failure does not appear to be a transient connection or SSL error; stopping retries."
      break
    fi
  fi

  rm -f "$ATTEMPT_LOG"
  if [[ "$attempt" -lt "$MAX_ATTEMPTS" ]]; then
    sleep "$((attempt * 2))"
  fi
done

unset PGPASSWORD
if [[ "$backup_succeeded" != true || ! -s "$BACKUP_FILE" ]]; then
  log "ERROR: No valid backup was created."
  exit 1
fi

if ! pg_restore --list "$BACKUP_FILE" >/dev/null 2>&1; then
  log "ERROR: Final backup failed PostgreSQL archive validation; removing only this new invalid file."
  rm -f "$BACKUP_FILE"
  exit 1
fi

BACKUP_SIZE="$(stat -f '%z' "$BACKUP_FILE")"
log "SUCCESS: Valid local custom-format backup created: $(basename "$BACKUP_FILE") (${BACKUP_SIZE} bytes, mode 0600)."

sync_to_drive() {
  if [[ -z "${CAMPUSFIND_GOOGLE_DRIVE_DIR:-}" ]]; then
    log "Drive sync skipped: CAMPUSFIND_GOOGLE_DRIVE_DIR is not explicitly configured; local backup is safe."
    return 0
  fi

  local drive_root drive_real home_real cloud_real drive_parent drive_parent_parent drive_leaf drive_backup_dir drive_file drive_partial
  drive_root="$CAMPUSFIND_GOOGLE_DRIVE_DIR"
  if [[ ! -d "$drive_root" ]]; then
    log "ERROR: The explicitly configured Google Drive directory is unavailable. Local backup remains safe."
    return 1
  fi

  home_real="$(cd -P "$HOME" && pwd -P)"
  drive_real="$(cd -P "$drive_root" && pwd -P)"
  cloud_real=""
  if [[ -d "$home_real/Library/CloudStorage" ]]; then
    cloud_real="$(cd -P "$home_real/Library/CloudStorage" && pwd -P)"
  fi

  drive_parent="$(dirname "$drive_real")"
  drive_parent_parent="$(dirname "$drive_parent")"
  drive_leaf="$(basename "$drive_real")"
  if [[ "$drive_real" != "$home_real/Google Drive/My Drive" && \
        ( -z "$cloud_real" || "$drive_parent_parent" != "$cloud_real" || \
          "$drive_leaf" != "My Drive" || "$(basename "$drive_parent")" != GoogleDrive-* ) ]]; then
    log "ERROR: The explicit Google Drive path failed validation; no cloud copy was attempted."
    return 1
  fi

  drive_backup_dir="$drive_real/CampusFind-Backups"
  if [[ -L "$drive_backup_dir" ]]; then
    log "ERROR: The Google Drive backup destination is a symbolic link; no cloud copy was attempted."
    return 1
  fi
  if [[ ! -d "$drive_backup_dir" ]]; then
    if ! mkdir -m 700 "$drive_backup_dir"; then
      log "ERROR: Could not create the Google Drive backup folder. Local backup remains safe."
      return 1
    fi
  fi

  drive_file="$drive_backup_dir/$(basename "$BACKUP_FILE")"
  if [[ -e "$drive_file" ]]; then
    log "ERROR: A file with the generated name already exists in Google Drive; refusing to overwrite it."
    return 1
  fi
  if ! drive_partial="$(mktemp "$drive_backup_dir/.campusfind-backup.XXXXXX")"; then
    log "ERROR: Could not create a temporary file in the selected Google Drive folder. Local backup remains safe."
    return 1
  fi

  if ! cp -p "$BACKUP_FILE" "$drive_partial"; then
    log "ERROR: Could not copy the validated dump to Google Drive. Local backup remains safe."
    rm -f "$drive_partial"
    return 1
  fi

  if ! cmp -s "$BACKUP_FILE" "$drive_partial"; then
    log "ERROR: Google Drive local copy differs from the validated dump; removing only this incomplete copy."
    rm -f "$drive_partial"
    return 1
  fi

  chmod 600 "$drive_partial"
  if ! mv -n "$drive_partial" "$drive_file" || [[ -e "$drive_partial" ]]; then
    log "ERROR: Could not finalize the Google Drive local copy. Local backup remains safe."
    rm -f "$drive_partial"
    return 1
  fi

  log "SUCCESS: Byte-identical copy placed in the explicitly selected Google Drive sync folder. Cloud upload completion must be confirmed in Drive."
}

if ! sync_to_drive; then
  exit 1
fi

log "===== CampusFind backup finished ====="
