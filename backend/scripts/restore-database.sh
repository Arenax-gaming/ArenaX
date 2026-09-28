#!/usr/bin/env bash
# Restores a backup produced by backup-database.sh into $DATABASE_URL.
#
# Usage:
#   ./scripts/restore-database.sh <path-to-dump>          # restore a local dump
#   ./scripts/restore-database.sh --latest                # fetch+restore the newest S3 backup
#   ./scripts/restore-database.sh --latest --dry-run       # download + verify checksum only
#
# Env:
#   DATABASE_URL       (required) target Postgres connection string to restore INTO
#   BACKUP_DIR          (default ./backups) local staging directory
#   S3_BACKUP_BUCKET     (required for --latest)
#
# This performs point-in-time-adjacent recovery to "as of the chosen
# backup". For true point-in-time recovery to an arbitrary timestamp
# between backups, replay archived WAL after this restore — see
# BACKUP_RECOVERY.md and wal-archive-restore-command.sh.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL must be set before restoring a backup." >&2
  exit 1
fi

backup_dir="${BACKUP_DIR:-./backups}"
mkdir -p "$backup_dir"

dry_run=false
target=""
for arg in "$@"; do
  case "$arg" in
    --latest) target="--latest" ;;
    --dry-run) dry_run=true ;;
    *) target="$arg" ;;
  esac
done

if [ -z "$target" ]; then
  echo "Usage: $0 <path-to-dump>|--latest [--dry-run]" >&2
  exit 1
fi

if [ "$target" = "--latest" ]; then
  if [ -z "${S3_BACKUP_BUCKET:-}" ]; then
    echo "S3_BACKUP_BUCKET must be set to use --latest." >&2
    exit 1
  fi
  echo "Fetching latest backup pointer from $S3_BACKUP_BUCKET"
  aws s3 cp "$S3_BACKUP_BUCKET/latest.txt" "$backup_dir/latest.txt"
  latest_name="$(cat "$backup_dir/latest.txt")"
  dump_path="$backup_dir/$latest_name"
  aws s3 cp "$S3_BACKUP_BUCKET/$latest_name" "$dump_path"
  aws s3 cp "$S3_BACKUP_BUCKET/$latest_name.sha256" "$dump_path.sha256"
else
  dump_path="$target"
fi

if [ ! -f "$dump_path" ]; then
  echo "Backup file not found: $dump_path" >&2
  exit 1
fi

if [ -f "$dump_path.sha256" ]; then
  echo "Verifying checksum..."
  sha256sum -c "$dump_path.sha256"
else
  echo "Warning: no checksum file found for $dump_path, skipping verification." >&2
fi

if [ "$dry_run" = true ]; then
  echo "Dry run: backup downloaded and verified at $dump_path, not restored."
  exit 0
fi

echo "Restoring $dump_path into target database..."
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$DATABASE_URL" "$dump_path"

echo "Restore complete."
