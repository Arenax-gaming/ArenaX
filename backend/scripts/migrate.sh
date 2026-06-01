#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL must be set before running migrations." >&2
  exit 1
fi

./scripts/verify-migrations.sh ./migrations
sqlx migrate run --source ./migrations
