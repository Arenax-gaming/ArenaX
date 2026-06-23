#!/bin/bash

# Database Restore Script for ArenaX
# This script restores a PostgreSQL database from a backup file

set -e

# Configuration
BACKUP_FILE="${1:-}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Extract database connection details from DATABASE_URL
# Expected format: postgresql://user:password@host:port/database
DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')
DB_USER=$(echo $DATABASE_URL | sed -n 's/\/\/\([^:]*\):.*/\1/p')
DB_PASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\([^@]*\)@.*/\1/p')

# Check if backup file is provided
if [ -z "$BACKUP_FILE" ]; then
  echo "Error: Backup file not specified"
  echo "Usage: ./restore-database.sh <backup_file>"
  echo ""
  echo "Available backups in $BACKUP_DIR:"
  ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null || echo "No backups found"
  exit 1
fi

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file not found: $BACKUP_FILE"
  exit 1
fi

# Decompress if needed
if [[ "$BACKUP_FILE" == *.gz ]]; then
  echo "Decompressing backup file..."
  TEMP_FILE="${BACKUP_FILE%.gz}"
  gunzip -c "$BACKUP_FILE" > "$TEMP_FILE"
  BACKUP_FILE="$TEMP_FILE"
fi

echo "Starting database restore..."
echo "Database: $DB_NAME"
echo "Host: $DB_HOST:$DB_PORT"
echo "Backup file: $BACKUP_FILE"

# Confirm restore
read -p "Are you sure you want to restore the database? This will overwrite existing data. (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo "Restore cancelled"
  exit 0
fi

# Perform the restore
PGPASSWORD="$DB_PASSWORD" pg_restore \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --clean \
  --if-exists \
  --verbose \
  "$BACKUP_FILE"

# Clean up temporary file if it was decompressed
if [[ "$TEMP_FILE" == *.sql ]]; then
  rm "$TEMP_FILE"
fi

echo "Restore completed successfully"
