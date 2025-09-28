# ArenaX Database Schema and Migrations

## Overview

This directory contains the complete database schema, migrations, and documentation for the ArenaX gaming platform. The database is built on PostgreSQL 13+ with SQLx for type-safe operations, connection pooling, and automatic migrations.

## Architecture

### Database Design Principles

- **Sharded for scalability**: Designed to support PostgreSQL sharding for high-volume operations
- **ACID compliance**: Full transaction support with proper isolation levels
- **Performance optimized**: Strategic indexing on frequently queried columns
- **Audit trail**: Complete audit logging for sensitive operations
- **Data validation**: Database-level constraints and validation rules
- **Stellar integration**: Native support for Stellar blockchain transactions

### Core Tables

#### Users and Authentication
- `users` - User profiles, authentication, and basic information
- `stellar_accounts` - Stellar blockchain account integration
- `audit_logs` - Security and operation audit trails

#### Tournament Management
- `tournaments` - Tournament definitions and configuration
- `tournament_participants` - User participation tracking
- `matches` - Individual match records and results

#### Financial Operations
- `wallets` - User wallet balances and escrow management
- `stellar_transactions` - Blockchain transaction records
- `leaderboards` - Performance rankings and statistics

### Database Features

#### Automated Triggers
- **Updated timestamps**: Automatic `updated_at` field updates
- **Participant counting**: Tournament participant count maintenance
- **Balance management**: Wallet balance updates based on transactions
- **Reputation scoring**: Automatic reputation point calculations

#### Views and Statistics
- `user_statistics` - Comprehensive user performance metrics
- `tournament_standings` - Real-time tournament rankings
- Custom aggregation views for leaderboards and analytics

#### Security Features
- Encrypted secret key storage
- Audit logging for all sensitive operations
- IP address and user agent tracking
- Data retention policies

## Configuration

### Environment Variables

```bash
# Database Configuration
DATABASE_URL=postgres://user:password@localhost:5432/arenax
DB_MAX_CONNECTIONS=20        # Maximum pool connections
DB_MIN_CONNECTIONS=5         # Minimum pool connections
DB_ACQUIRE_TIMEOUT=30        # Connection acquisition timeout (seconds)
DB_IDLE_TIMEOUT=600          # Idle connection timeout (seconds)
DB_MAX_LIFETIME=1800         # Maximum connection lifetime (seconds)
```

### Connection Pooling

The database connection pool is configured for high performance with:

- **Connection pooling**: SQLx-based pool with configurable limits
- **Health monitoring**: Automatic connection health checks
- **Graceful degradation**: Fallback handling for connection issues
- **Pool metrics**: Real-time pool status monitoring

## Migrations

### Migration Files

1. **20240928000001_create_core_tables.sql** - Core schema with all tables and indexes
2. **20240928000002_add_triggers_and_views.sql** - Business logic triggers and views
3. **20240928000003_seed_development_data.sql** - Development seed data

### Running Migrations

Migrations are automatically run during application startup. For manual migration management:

```bash
# Run all pending migrations
sqlx migrate run --database-url $DATABASE_URL

# Revert last migration
sqlx migrate revert --database-url $DATABASE_URL

# Check migration status
sqlx migrate info --database-url $DATABASE_URL
```

### Migration Development

To create a new migration:

```bash
sqlx migrate add -r <migration_name>
```

This creates both up and down migration files in the `migrations/` directory.

## Database Models

### Rust Models

All database entities have corresponding Rust structs with:

- **Type safety**: SQLx `FromRow` derivation for safe database mapping
- **Serialization**: Serde support for JSON API responses
- **Validation**: Request validation with the `validator` crate
- **Documentation**: Comprehensive field documentation

### Model Features

- **Request/Response DTOs**: Separate types for API requests and responses
- **Decimal precision**: `rust_decimal` for financial calculations
- **UUID identifiers**: Primary keys using UUID v4
- **Timestamp handling**: Chrono for UTC timestamp management
- **Optional fields**: Proper handling of nullable database columns

## Performance Optimizations

### Indexing Strategy

Strategic indexes on:
- User lookup fields (phone, email, username)
- Tournament queries (status, game_type, dates)
- Match queries (tournament_id, player IDs, status)
- Financial queries (transaction hashes, user balances)
- Leaderboard queries (rankings, periods, game types)

### Query Optimization

- **Composite indexes**: Multi-column indexes for complex queries
- **Partial indexes**: Filtered indexes for specific conditions
- **Foreign key indexes**: Automatic indexing on relationships
- **JSONB support**: Optimized JSON field handling

### Connection Management

- **Pool sizing**: Configured for expected concurrent load
- **Timeout handling**: Proper timeout configuration
- **Health checks**: Regular connection validation
- **Metrics**: Pool utilization monitoring

## Development Setup

### Prerequisites

- PostgreSQL 13+
- Rust 1.70+
- SQLx CLI: `cargo install sqlx-cli`

### Local Development

1. **Start PostgreSQL**:
   ```bash
   # Using Docker
   docker run --name arenax-postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=arenax -p 5432:5432 -d postgres:13
   ```

2. **Set environment variables**:
   ```bash
   export DATABASE_URL="postgres://postgres:password@localhost:5432/arenax"
   ```

3. **Run the application**:
   ```bash
   cargo run
   ```

   Migrations will run automatically on startup.

### Development Data

The seed migration provides sample data:
- 4 test users with different roles and balances
- 3 sample tournaments with various configurations
- Tournament participants and matches
- Sample transactions and leaderboard entries

## Security Considerations

### Data Protection

- **Encryption**: Stellar secret keys are encrypted at rest
- **Audit trail**: All sensitive operations logged
- **Access control**: User-based data isolation
- **Input validation**: Database constraints and application validation

### Network Security

- **SSL/TLS**: Database connections use SSL encryption
- **Network isolation**: Database runs on private network
- **Access control**: IP-based access restrictions
- **Monitoring**: Real-time security monitoring

### Backup and Recovery

- **Automated backups**: Regular PostgreSQL backups
- **Point-in-time recovery**: Transaction log preservation
- **Disaster recovery**: Cross-region backup replication
- **Testing**: Regular recovery procedure testing

## Monitoring and Metrics

### Health Checks

The `/api/health` endpoint provides:
- Database connectivity status
- Connection pool metrics
- Query performance indicators
- Error rate monitoring

### Logging

Comprehensive logging includes:
- Query execution times
- Connection pool status
- Migration execution
- Error tracking and alerts

### Performance Metrics

Key metrics tracked:
- Query execution times (target: <100ms simple, <500ms complex)
- Connection pool utilization
- Transaction throughput
- Error rates and types

## Troubleshooting

### Common Issues

1. **Connection Pool Exhausted**:
   - Increase `DB_MAX_CONNECTIONS`
   - Check for connection leaks
   - Monitor long-running queries

2. **Slow Queries**:
   - Review query execution plans
   - Add missing indexes
   - Optimize complex joins

3. **Migration Failures**:
   - Check constraint violations
   - Verify data compatibility
   - Review transaction isolation

### Debug Tools

- **SQLx logging**: Enable query logging with `RUST_LOG=sqlx=debug`
- **Pool metrics**: Use health endpoint for pool status
- **PostgreSQL logs**: Monitor database server logs
- **Query analysis**: Use `EXPLAIN ANALYZE` for query optimization

## Future Enhancements

### Planned Features

- **Read replicas**: Separate read/write database instances
- **Sharding**: Horizontal partitioning for scale
- **Caching layer**: Redis integration for hot data
- **Real-time updates**: WebSocket support for live data
- **Analytics**: Data warehouse integration
- **Backup automation**: Improved backup and recovery procedures

### Scalability Roadmap

- **Connection pooling**: PgBouncer integration
- **Query optimization**: Continuous performance monitoring
- **Data archiving**: Historical data management
- **Geographic distribution**: Multi-region deployment
- **Load balancing**: Database request distribution

## Contributing

### Database Changes

1. Create migration files for schema changes
2. Update corresponding Rust models
3. Add tests for new functionality
4. Update documentation
5. Verify performance impact

### Testing

- **Unit tests**: Model validation and serialization
- **Integration tests**: Database operations
- **Performance tests**: Query execution benchmarks
- **Migration tests**: Up/down migration validation

For questions or issues, please refer to the main project documentation or create an issue in the repository.
