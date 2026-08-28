#!/usr/bin/env bash
# Backup verification test: restores a backup into a disposable database
# and runs sanity checks against it, then drops the scratch database.
# This is what actually proves a backup is usable — a dump that "exists"
# but can't be restored, or restores into an empty schema, is not a
# working backup.
#
# Usage:
#   ./scripts/verify-backup.sh <path-to-dump>
#   ./scripts/verify-backup.sh --latest
#
# Env:
#   DATABASE_URL   (required) admin connection string used as the template
#                  for the scratch database (its own database is never
#                  touched — a new sibling database is created/dropped)
#   S3_BACKUP_BUCKET (required for --latest)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL must be set (used as the admin connection to create/drop the scratch database)." >&2
  exit 1
fi

target="${1:-}"
if [ -z "$target" ]; then
  echo "Usage: $0 <path-to-dump>|--latest" >&2
  exit 1
fi

scratch_db="arenax_backup_verify_$(date -u +%Y%m%d%H%M%S)"

# Derive an admin URL (connects to the `postgres` maintenance database)
# and a scratch-db URL from DATABASE_URL, e.g.
# postgres://user:pass@host:5432/arenax -> .../postgres and .../<scratch>
base_url="${DATABASE_URL%/*}"
admin_url="$base_url/postgres"
scratch_url="$base_url/$scratch_db"

cleanup() {
  echo "Dropping scratch database $scratch_db"
  psql "$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$scratch_db\";" >/dev/null
}
trap cleanup EXIT

echo "Creating scratch database $scratch_db"
psql "$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$scratch_db\";"

echo "Restoring backup into $scratch_db..."
DATABASE_URL="$scratch_url" ./scripts/restore-database.sh "$target"

echo "Running verification checks against $scratch_db..."

table_count="$(psql "$scratch_url" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")"
echo "  public tables: $table_count"
if [ "$table_count" -lt 1 ]; then
  echo "FAIL: restored database has no tables in the public schema." >&2
  exit 1
fi

if psql "$scratch_url" -t -A -c "SELECT to_regclass('public._sqlx_migrations');" | grep -q '_sqlx_migrations'; then
  applied_migrations="$(psql "$scratch_url" -t -A -c "SELECT count(*) FROM _sqlx_migrations WHERE success = true;")"
  echo "  applied migrations: $applied_migrations"
  if [ "$applied_migrations" -lt 1 ]; then
    echo "FAIL: _sqlx_migrations table exists but no migration recorded as applied." >&2
    exit 1
  fi
else
  echo "WARN: _sqlx_migrations table not found — skipping migration-count check." >&2
fi

echo "PASS: backup $target restores cleanly and contains expected schema state."
