#!/usr/bin/env bash
# Postgres `archive_command` — ships each completed WAL segment to S3 so
# point-in-time recovery can replay WAL past the last full backup instead
# of only being able to restore to a backup's own timestamp.
#
# postgresql.conf:
#   archive_mode = on
#   archive_command = '/path/to/wal-archive-push.sh %p %f'
#
# Env:
#   S3_BACKUP_BUCKET (required) e.g. s3://arenax-db-backups/backend
set -euo pipefail

wal_path="$1"   # %p — full path to the WAL file to archive
wal_file="$2"   # %f — the WAL file's name

if [ -z "${S3_BACKUP_BUCKET:-}" ]; then
  echo "S3_BACKUP_BUCKET must be set." >&2
  exit 1
fi

aws s3 cp "$wal_path" "$S3_BACKUP_BUCKET/wal/$wal_file" --only-show-errors
