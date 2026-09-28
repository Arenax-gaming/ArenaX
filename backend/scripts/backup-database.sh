#!/usr/bin/env bash
# Creates a full logical backup of the database at $DATABASE_URL and,
# when S3_BACKUP_BUCKET is set, uploads it (plus a sha256 checksum) to S3.
#
# Env:
#   DATABASE_URL       (required) target Postgres connection string
#   BACKUP_DIR          (default ./backups) local staging directory
#   S3_BACKUP_BUCKET     (optional) e.g. s3://arenax-db-backups/backend
#   BACKUP_RETENTION_DAYS (default 30) prune local dumps older than this
#
# See backend/scripts/BACKUP_RECOVERY.md for RTO/RPO targets and the full
# recovery procedure (restore-database.sh, verify-backup.sh).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL must be set before creating a backup." >&2
  exit 1
fi

backup_dir="${BACKUP_DIR:-./backups}"
retention_days="${BACKUP_RETENTION_DAYS:-30}"
mkdir -p "$backup_dir"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="$backup_dir/arenax-$timestamp.dump"
checksum_file="$output.sha256"

echo "Creating backup: $output"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl --file="$output"

sha256sum "$output" > "$checksum_file"
echo "Checksum written to $checksum_file"

if [ -n "${S3_BACKUP_BUCKET:-}" ]; then
  echo "Uploading backup to $S3_BACKUP_BUCKET"
  aws s3 cp "$output" "$S3_BACKUP_BUCKET/$(basename "$output")"
  aws s3 cp "$checksum_file" "$S3_BACKUP_BUCKET/$(basename "$checksum_file")"

  # "latest" pointer so restore-database.sh --latest doesn't need to list
  # the bucket to find the newest backup.
  latest_pointer="$backup_dir/latest.txt"
  echo "$(basename "$output")" > "$latest_pointer"
  aws s3 cp "$latest_pointer" "$S3_BACKUP_BUCKET/latest.txt"
fi

# Prune local dumps older than the retention window. Remote (S3) retention
# is managed by a bucket lifecycle rule instead, since that's the durable
# copy — see BACKUP_RECOVERY.md.
find "$backup_dir" -maxdepth 1 -name 'arenax-*.dump*' -mtime "+$retention_days" -print -delete

echo "Database backup written to $output"
