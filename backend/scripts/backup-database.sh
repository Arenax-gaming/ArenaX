#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL must be set before creating a backup." >&2
  exit 1
fi

backup_dir="${BACKUP_DIR:-./backups}"
mkdir -p "$backup_dir"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="$backup_dir/arenax-$timestamp.dump"

pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl --file="$output"

echo "Database backup written to $output"
