#!/usr/bin/env bash
# Rollback verification: the up -> down -> up cycle from issue #871.
#
# Proves that the latest applied migration's down.sql actually works and
# that the schema returns to a healthy state after re-applying it:
#
#   1. (optional) pre-migration backup  — backup-database.sh
#   2. snapshot schema state            — table count + applied migration
#   3. DOWN                             — sqlx migrate revert (the .down.sql runs)
#   4. health check                     — DB reachable, migration row gone,
#                                         schema still sane
#   5. UP                               — sqlx migrate run (the .up.sql runs again)
#   6. health check                     — migration row restored, table count
#                                         matches the snapshot
#
# Env:
#   DATABASE_URL        (required) target Postgres connection string
#   SKIP_BACKUP         (optional) set to 1 to skip the pre-migration backup
#                                  (CI disposable databases; never on shared data)
#   BACKEND_HEALTH_URL  (optional) e.g. http://localhost:8080/api/health —
#                                  when set, the live backend health endpoint is
#                                  checked after DOWN and after UP
#   ROLLBACK_TARGET     (optional) "latest" (default) — the migration to cycle
#
# Exit codes: 0 = up->down->up verified, non-zero = the down.sql or the
# re-apply failed (or health checks caught a broken schema state).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL must be set before running rollback verification." >&2
  exit 1
fi

psql_safe() {
  # psql with a hard stop on errors; keeps this script honest under set -e.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A "$@"
}

# ---------------------------------------------------------------------------
# 0. Preconditions
# ---------------------------------------------------------------------------
echo "== Rollback verification (up -> down -> up) =="

if ! psql "$DATABASE_URL" -c "SELECT 1;" >/dev/null 2>&1; then
  echo "FAIL: cannot reach the database at DATABASE_URL." >&2
  exit 1
fi

if ! command -v sqlx >/dev/null 2>&1; then
  echo "FAIL: sqlx CLI not found (install sqlx-cli 0.8.x)." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. Pre-migration backup (skippable only for disposable databases)
# ---------------------------------------------------------------------------
if [ "${SKIP_BACKUP:-0}" = "1" ]; then
  echo "SKIP_BACKUP=1 — skipping pre-migration backup (disposable database only)."
else
  echo "Step 1: pre-migration backup"
  ./scripts/backup-database.sh
fi

# ---------------------------------------------------------------------------
# 2. Snapshot the state we must return to
# ---------------------------------------------------------------------------
echo "Step 2: snapshotting pre-rollback state"

if ! psql_safe -c "SELECT to_regclass('public._sqlx_migrations');" | grep -q '_sqlx_migrations'; then
  echo "FAIL: _sqlx_migrations table not found — has migrate.sh ever run here?" >&2
  exit 1
fi

latest_version="$(psql_safe -c "SELECT version FROM _sqlx_migrations WHERE success = true ORDER BY version DESC LIMIT 1;")"
if [ -z "$latest_version" ]; then
  echo "FAIL: no successful applied migration found — nothing to cycle." >&2
  exit 1
fi

migration_file="$(find ./migrations -maxdepth 1 -type f -name "${latest_version}_*.up.sql" -print -quit)"
if [ -z "$migration_file" ]; then
  echo "FAIL: applied migration $latest_version has no local .up.sql pair." >&2
  exit 1
fi
if [ ! -f "${migration_file%.up.sql}.down.sql" ]; then
  echo "FAIL: applied migration $latest_version has no local .down.sql pair." >&2
  exit 1
fi
echo "  rollback target: $latest_version ($(basename "$migration_file"))"

tables_before="$(psql_safe -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")"
echo "  public tables before: $tables_before"

# ---------------------------------------------------------------------------
# 3. DOWN — revert the latest migration (this runs its .down.sql)
# ---------------------------------------------------------------------------
echo "Step 3: DOWN — reverting migration $latest_version"
sqlx migrate revert --source ./migrations

target_after_down="$(psql_safe -c "SELECT count(*) FROM _sqlx_migrations WHERE version = $latest_version AND success = true;")"
if [ "$target_after_down" != "0" ]; then
  echo "FAIL: after 'sqlx migrate revert' the target migration $latest_version is still recorded as applied." >&2
  echo "      The down.sql either failed silently or was never executed." >&2
  exit 1
fi

after_down_version="$(psql_safe -c "SELECT version FROM _sqlx_migrations WHERE success = true ORDER BY version DESC LIMIT 1;")"
echo "  down verified: target no longer applied (current head: ${after_down_version:-none})"

# ---------------------------------------------------------------------------
# 4. Health check while rolled back
# ---------------------------------------------------------------------------
echo "Step 4: health check (rolled-back state)"

if ! psql "$DATABASE_URL" -c "SELECT 1;" >/dev/null 2>&1; then
  echo "FAIL: database unreachable after the down migration." >&2
  exit 1
fi

if psql_safe -c "SELECT to_regclass('public._sqlx_migrations');" | grep -q '_sqlx_migrations'; then
  dirty="$(psql_safe -c "SELECT count(*) FROM _sqlx_migrations WHERE success = false;")"
  if [ "$dirty" != "0" ]; then
    echo "FAIL: $dirty migration(s) recorded as dirty (success=false) after the down." >&2
    exit 1
  fi
fi

tables_down="$(psql_safe -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")"
echo "  db reachable, no dirty migrations, public tables after down: $tables_down"

if [ -n "${BACKEND_HEALTH_URL:-}" ]; then
  for i in 1 2 3 4 5; do
    if curl -sf --max-time 5 "$BACKEND_HEALTH_URL" >/dev/null 2>&1; then
      echo "  backend health: OK ($BACKEND_HEALTH_URL)"
      break
    fi
    if [ "$i" = "5" ]; then
      echo "FAIL: backend health endpoint $BACKEND_HEALTH_URL did not recover after the down migration." >&2
      exit 1
    fi
    echo "  backend health: attempt $i failed, retrying in 3s..."
    sleep 3
  done
fi

# ---------------------------------------------------------------------------
# 5. UP — re-apply the migration (this runs its .up.sql again)
# ---------------------------------------------------------------------------
echo "Step 5: UP — re-applying migration $latest_version"
sqlx migrate run --source ./migrations

# ---------------------------------------------------------------------------
# 6. Health check after re-apply
# ---------------------------------------------------------------------------
echo "Step 6: health check (restored state)"

restored_version="$(psql_safe -c "SELECT version FROM _sqlx_migrations WHERE success = true ORDER BY version DESC LIMIT 1;")"
if [ "$restored_version" != "$latest_version" ]; then
  echo "FAIL: after re-apply, head migration is $restored_version, expected $latest_version." >&2
  exit 1
fi

restored_target="$(psql_safe -c "SELECT count(*) FROM _sqlx_migrations WHERE version = $latest_version AND success = true;")"
if [ "$restored_target" != "1" ]; then
  echo "FAIL: migration $latest_version was not recorded as successfully applied after re-apply." >&2
  exit 1
fi

dirty_after_up="$(psql_safe -c "SELECT count(*) FROM _sqlx_migrations WHERE success = false;")"
if [ "$dirty_after_up" != "0" ]; then
  echo "FAIL: $dirty_after_up migration(s) recorded as dirty after the re-apply." >&2
  exit 1
fi

tables_after="$(psql_safe -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")"
echo "  migration head restored: $restored_version"
echo "  public tables after up: $tables_after (before: $tables_before)"

if [ "$tables_after" != "$tables_before" ]; then
  echo "FAIL: table count changed across the up->down->up cycle ($tables_before -> $tables_after)." >&2
  echo "      The down.sql drops something the up.sql does not recreate (or vice versa)." >&2
  exit 1
fi

if [ -n "${BACKEND_HEALTH_URL:-}" ]; then
  for i in 1 2 3 4 5; do
    if curl -sf --max-time 5 "$BACKEND_HEALTH_URL" >/dev/null 2>&1; then
      echo "  backend health: OK ($BACKEND_HEALTH_URL)"
      break
    fi
    if [ "$i" = "5" ]; then
      echo "FAIL: backend health endpoint $BACKEND_HEALTH_URL did not recover after the re-apply." >&2
      exit 1
    fi
    echo "  backend health: attempt $i failed, retrying in 3s..."
    sleep 3
  done
fi

echo ""
echo "VERIFIED: migration $latest_version survived the up -> down -> up cycle"
echo "          with backup, schema integrity and health checks. (#871)"
