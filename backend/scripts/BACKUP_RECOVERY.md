# Database Backup & Recovery

Closes [#971](https://github.com/Arenax-gaming/ArenaX/issues/971) —
automated backups and a documented recovery path for the backend's
PostgreSQL database.

## Components

| Script | Purpose |
|---|---|
| `backup-database.sh` | `pg_dump` a full logical backup, checksum it, upload to S3, prune local copies past retention |
| `restore-database.sh` | Restore a local or `--latest` S3 backup into `DATABASE_URL` |
| `verify-backup.sh` | Restore a backup into a disposable scratch database and sanity-check it — this is the "does the backup actually work" test |
| `wal-archive-push.sh` | Postgres `archive_command` — continuously ships WAL segments to S3 |
| `wal-archive-restore.sh` | Postgres `restore_command` — replays archived WAL for point-in-time recovery |

`.github/workflows/db-backup.yml` runs `backup-database.sh` then
`verify-backup.sh` daily on a schedule, so every backup is proven
restorable before it's trusted.

## RTO / RPO targets

| Scenario | RPO (data loss) | RTO (time to recover) |
|---|---|---|
| Full daily backup restore | ≤ 24h (time since last daily backup) | ≤ 1h |
| Point-in-time recovery (WAL archiving enabled) | ≤ 5 min (WAL archive/shipping lag) | ≤ 2h |

These are targets to design and alert against, not guarantees — track
actual restore duration each time `verify-backup.sh` runs in CI and
revisit the targets if reality drifts from them.

## Recovery procedures

### 1. Restore the latest daily backup (most common case)

```bash
export DATABASE_URL=postgres://arenax:***@<recovery-host>:5432/arenax
export S3_BACKUP_BUCKET=s3://arenax-db-backups/backend
./scripts/restore-database.sh --latest
```

This gets you back to the state as of the last daily backup (RPO ≤ 24h).

### 2. Point-in-time recovery (minimize data loss past the last backup)

Requires WAL archiving to have been running (`archive_command` wired to
`wal-archive-push.sh`, see that script's header for the `postgresql.conf`
snippet):

1. Provision a fresh Postgres instance from the most recent base backup
   (`pg_basebackup`, or restore the latest `backup-database.sh` dump into
   a fresh cluster).
2. Set `restore_command` to `wal-archive-restore.sh` and
   `recovery_target_time` to the desired point in time in
   `postgresql.conf` (or the `recovery.signal` mechanism for the running
   Postgres major version).
3. Start Postgres; it replays archived WAL up to the target time and
   then stops recovery.
4. Verify with `verify-backup.sh` semantics manually (row counts, key
   tables) before cutting traffic over.
5. Repoint `DATABASE_URL` (app config / secrets) at the recovered
   instance.

### 3. Verify a backup is actually restorable (routine, and after any
   backup pipeline change)

```bash
export DATABASE_URL=postgres://arenax:***@<any-postgres-with-create-db-rights>:5432/arenax
export S3_BACKUP_BUCKET=s3://arenax-db-backups/backend
./scripts/verify-backup.sh --latest
```

Creates and drops a scratch database — never touches the database named
in `DATABASE_URL` itself.

## Backup schedule

`.github/workflows/db-backup.yml` runs `backup-database.sh` daily at
03:00 UTC against the production database (via repo secrets
`PROD_DATABASE_URL`, `AWS_*`, `S3_BACKUP_BUCKET`), then immediately runs
`verify-backup.sh` against the backup it just produced so a broken backup
is caught the same day it's taken, not discovered during an actual
incident.
