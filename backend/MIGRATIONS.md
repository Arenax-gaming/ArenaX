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

## Other Components

Server Prisma migrations remain under `server/prisma/migrations` and should not be mixed into `backend/migrations`. Soroban contract storage changes must be documented with the contract change and coordinated with backend migrations when the backend depends on indexed contract data.
