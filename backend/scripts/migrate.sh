#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL must be set before running migrations." >&2
  exit 1
fi

./scripts/verify-migrations.sh ./migrations
sqlx migrate run --source ./migrations

# Post-migration health check (#871): fail loudly if the schema the
# backend depends on is not actually usable after applying.
if ! psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT 1;" >/dev/null 2>&1; then
  echo "FAIL: database unreachable after applying migrations." >&2
  exit 1
fi

if psql "$DATABASE_URL" -t -A -c "SELECT to_regclass('public._sqlx_migrations');" | grep -q '_sqlx_migrations'; then
  dirty="$(psql "$DATABASE_URL" -t -A -c "SELECT count(*) FROM _sqlx_migrations WHERE success = false;")"
  if [ "$dirty" != "0" ]; then
    echo "FAIL: $dirty migration(s) recorded as dirty after applying." >&2
    exit 1
  fi
  applied="$(psql "$DATABASE_URL" -t -A -c "SELECT count(*) FROM _sqlx_migrations WHERE success = true;")"
  echo "Post-migration health check OK: db reachable, $applied migration(s) applied, none dirty."
else
  echo "Post-migration health check OK: db reachable (no _sqlx_migrations table yet)."
fi
