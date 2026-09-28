# Backend Database Migrations

The Rust backend uses SQLx migrations from `backend/migrations` as the source of truth for PostgreSQL schema changes.

## Naming

Every backend migration must be committed as a pair:

```text
YYYYMMDDHHMMSS_snake_case_description.up.sql
YYYYMMDDHHMMSS_snake_case_description.down.sql
```

Use one timestamp per logical schema change. Do not edit an already-applied migration; create a new migration instead.

## Local Workflow

Set `DATABASE_URL` to the target PostgreSQL database before running any command:

```bash
export DATABASE_URL=postgres://arenax:arenax@localhost:5432/arenax
```

Create a migration:

```bash
cd backend
sqlx migrate add -r add_example_table
```

Validate naming and up/down pairs:

```bash
cd backend
./scripts/verify-migrations.sh
```

Apply pending migrations:

```bash
cd backend
./scripts/migrate.sh
```

Check migration status:

```bash
cd backend
./scripts/migration-status.sh
```

## Startup Enforcement

The backend runs SQLx migrations during startup by default. Startup fails if:

- the database cannot be reached,
- a migration is dirty,
- an applied migration is missing locally,
- an applied migration checksum differs from the committed migration,
- a pending migration fails.

Set `BACKEND_MIGRATION_MODE=disabled` only for controlled maintenance tasks where migrations are applied by a separate deployment step.

## CI/CD

CI validates backend migration filenames and up/down pairs, then applies all migrations to a clean PostgreSQL service using SQLx. Deployment pipelines should run the same migration command before starting new backend instances:

```bash
cd backend
./scripts/migrate.sh
```

Because application startup also validates migrations, schema drift blocks the backend from serving traffic.

## Rollback Verification (up -> down -> up)

Every down migration is proven to work, not assumed. CI runs the full cycle against a disposable database after applying all migrations:

```bash
cd backend
SKIP_BACKUP=1 ./scripts/rollback-verify.sh
```

The script performs, in order:

1. **Pre-migration backup** (unless `SKIP_BACKUP=1` — acceptable only on disposable databases)
2. **Snapshot** — records the head migration and public table count
3. **DOWN** — `sqlx migrate revert` runs the latest `.down.sql`; verifies the migration is no longer recorded as applied
4. **Health check** — database reachable, no dirty migrations, optional backend `/api/health` probe (`BACKEND_HEALTH_URL`)
5. **UP** — `sqlx migrate run` re-applies the migration
6. **Health check** — head migration restored, table count matches the snapshot exactly

A `.down.sql` that drops something its `.up.sql` does not recreate — or that fails silently — fails this cycle. That failure blocks CI.

## Rollback And Backups

For shared, staging, or production databases, create a backup before reverting migrations:

```bash
cd backend
./scripts/backup-database.sh
```

The backup script writes a custom-format `pg_dump` file into `backend/backups`, which is git-ignored.

To revert the latest migration:

```bash
cd backend
./scripts/rollback-last-migration.sh
```

Rollback is intentionally interactive. For production incidents, prefer restoring from a verified backup when data-destructive down migrations are involved.

## Disaster Recovery Procedure (migration rollback)

When a migration must be rolled back on shared, staging, or production data, run the full sequence — never a bare `sqlx migrate revert`:

```bash
cd backend

# 1. PRE-MIGRATION BACKUP — mandatory on any data you care about
./scripts/backup-database.sh

# 2. ROLLBACK WITH VERIFICATION — backup -> down -> health -> up -> health
#    (cycles the latest migration; set BACKEND_HEALTH_URL when the backend is live)
./scripts/rollback-verify.sh

# 3. IF THE DOWN ITSELF FAILED — restore from the backup taken in step 1:
#    DATABASE_URL=<target> ./scripts/restore-database.sh backups/<the-new-dump>.dump
```

The recovery chain is: `backup-database.sh` (point-in-time copy) -> `rollback-verify.sh` (verified down/up cycle with health checks) -> `restore-database.sh` (fallback if the down is data-destructive and the cycle cannot complete). `verify-backup.sh` proves any dump restorable before you trust it. Full backup RTO/RPO targets and point-in-time recovery live in [scripts/BACKUP_RECOVERY.md](scripts/BACKUP_RECOVERY.md).

Post-migration health checks: `migrate.sh` now verifies after every apply that the database is reachable and no migration is recorded dirty; `rollback-verify.sh` extends this to the down and re-apply legs, with an optional live-backend probe via `BACKEND_HEALTH_URL`.

## Other Components

Server Prisma migrations remain under `server/prisma/migrations` and should not be mixed into `backend/migrations`. Soroban contract storage changes must be documented with the contract change and coordinated with backend migrations when the backend depends on indexed contract data.
