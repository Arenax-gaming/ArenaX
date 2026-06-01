#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL must be set before rolling back migrations." >&2
  exit 1
fi

echo "About to revert the latest applied backend migration."
echo "Create a database backup first for shared, staging, or production databases."
read -r -p "Type 'revert latest' to continue: " confirmation

if [ "$confirmation" != "revert latest" ]; then
  echo "Rollback cancelled."
  exit 1
fi

sqlx migrate revert --source ./migrations
