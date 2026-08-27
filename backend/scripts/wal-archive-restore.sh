#!/usr/bin/env bash
# Postgres `restore_command` for point-in-time recovery — fetches an
# archived WAL segment from S3 so a recovering standby/replica can replay
# it. Paired with wal-archive-push.sh (the archive_command) and a
# recovery_target_time set in postgresql.conf / recovery signal file.
#
# postgresql.conf (on the recovery target host, after restoring the base
# backup produced by backup-database.sh / pg_basebackup):
#   restore_command = '/path/to/wal-archive-restore.sh %f %p'
#   recovery_target_time = '2026-08-26 12:00:00+00'
#
# Env:
#   S3_BACKUP_BUCKET (required) e.g. s3://arenax-db-backups/backend
set -euo pipefail

wal_file="$1"   # %f — the WAL file name Postgres wants
dest_path="$2"  # %p — where Postgres wants it written

if [ -z "${S3_BACKUP_BUCKET:-}" ]; then
  echo "S3_BACKUP_BUCKET must be set." >&2
  exit 1
fi

aws s3 cp "$S3_BACKUP_BUCKET/wal/$wal_file" "$dest_path" --only-show-errors
