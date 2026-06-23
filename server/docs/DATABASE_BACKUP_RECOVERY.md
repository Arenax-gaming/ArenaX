# Database Backup and Recovery Procedures

This document outlines the procedures for backing up and restoring the ArenaX PostgreSQL database.

## Overview

The ArenaX platform uses PostgreSQL as its primary database. Regular backups are essential for data protection and disaster recovery.

## Backup Strategy

### Automated Backups

Backups should be scheduled to run automatically using cron jobs or a similar scheduling mechanism.

#### Recommended Schedule

- **Daily Backups**: Run at 2:00 AM UTC
- **Weekly Full Backups**: Run on Sundays at 3:00 AM UTC
- **Retention**: Keep daily backups for 7 days, weekly backups for 4 weeks

#### Setting Up Automated Backups

Add the following to your crontab (`crontab -e`):

```bash
# Daily backup at 2:00 AM UTC
0 2 * * * cd /path/to/ArenaX/server && ./scripts/backup-database.sh

# Weekly full backup on Sunday at 3:00 AM UTC
0 3 * * 0 cd /path/to/ArenaX/server && RETENTION_DAYS=28 ./scripts/backup-database.sh
```

### Manual Backups

To perform a manual backup:

```bash
cd /path/to/ArenaX/server
./scripts/backup-database.sh
```

The backup script will:
1. Create a timestamped backup file in the `./backups` directory
2. Compress the backup using gzip
3. Remove backups older than the retention period (default: 7 days)
4. Display the backup size

#### Custom Backup Location

To specify a custom backup directory:

```bash
BACKUP_DIR=/custom/backup/path ./scripts/backup-database.sh
```

#### Custom Retention Period

To specify a custom retention period (in days):

```bash
RETENTION_DAYS=14 ./scripts/backup-database.sh
```

## Recovery Procedures

### Restoring from Backup

To restore the database from a backup:

```bash
cd /path/to/ArenaX/server
./scripts/restore-database.sh <backup_file>
```

Example:
```bash
./scripts/restore-database.sh ./backups/arenax_backup_20240528_020000.sql.gz
```

The restore script will:
1. Decompress the backup if needed
2. Prompt for confirmation before proceeding
3. Drop existing database objects (using --clean flag)
4. Restore the database from the backup
5. Clean up temporary files

### Listing Available Backups

To list all available backups:

```bash
ls -lh ./backups/
```

## Backup File Format

Backups are created using `pg_dump` in custom format and compressed with gzip:
- **Format**: PostgreSQL custom format
- **Compression**: gzip
- **Naming**: `arenax_backup_YYYYMMDD_HHMMSS.sql.gz`

## Environment Variables

The backup and restore scripts use the following environment variables:

- `DATABASE_URL`: PostgreSQL connection string (required)
- `BACKUP_DIR`: Directory to store backups (default: `./backups`)
- `RETENTION_DAYS`: Number of days to retain backups (default: 7)

## Disaster Recovery Plan

### Scenario 1: Database Corruption

1. Stop the application server
2. Restore from the most recent backup
3. Verify data integrity
4. Restart the application server

### Scenario 2: Accidental Data Deletion

1. Identify the time of the accidental deletion
2. Restore from the backup taken before the incident
3. Apply any necessary data migrations
4. Restart the application server

### Scenario 3: Complete Server Failure

1. Provision a new server with PostgreSQL installed
2. Copy the latest backup file to the new server
3. Restore the database using the restore script
4. Update the application's DATABASE_URL to point to the new server
5. Restart the application server

## Monitoring and Alerts

### Backup Monitoring

Monitor the following:
- Backup job execution status
- Backup file sizes (should be consistent)
- Disk space in backup directory
- Backup retention policy compliance

### Alerting

Set up alerts for:
- Failed backup jobs
- Backup files exceeding size thresholds
- Disk space running low in backup directory

## Best Practices

1. **Test Restores**: Regularly test restore procedures to ensure backups are valid
2. **Offsite Storage**: Store backups in a different location or cloud storage
3. **Encryption**: Consider encrypting backups for sensitive data
4. **Documentation**: Keep this document updated with any changes to procedures
5. **Access Control**: Restrict access to backup files and scripts
6. **Version Control**: Keep backup scripts in version control

## Troubleshooting

### Backup Fails

1. Check that PostgreSQL is running
2. Verify DATABASE_URL is correct
3. Ensure sufficient disk space
4. Check PostgreSQL user permissions

### Restore Fails

1. Verify the backup file is not corrupted
2. Ensure PostgreSQL is running
3. Check that the database exists
4. Verify PostgreSQL user has necessary permissions

### Large Backup Files

If backup files become too large:
1. Consider using `pg_dump` with `--schema-only` for schema-only backups
2. Implement table-level backups for large tables
3. Use incremental backup strategies

## Additional Resources

- [PostgreSQL Documentation: Backup and Restore](https://www.postgresql.org/docs/current/backup.html)
- [pg_dump Documentation](https://www.postgresql.org/docs/current/app-pgdump.html)
- [pg_restore Documentation](https://www.postgresql.org/docs/current/app-pgrestore.html)
