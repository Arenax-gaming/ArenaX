# Database Transaction Race Condition Fix

## Overview

This document describes the comprehensive fix for race conditions in concurrent database transactions that were causing data inconsistency when multiple operations accessed the same records simultaneously.

## Problem Statement

### Race Condition Sources Identified

1. **Wallet Service (`wallet_service.rs`)**
   - Balance operations (add/deduct) used read-then-write patterns without atomic operations
   - Multiple concurrent operations could read the same balance and overwrite each other's changes
   - No row-level locking to prevent concurrent modifications

2. **Match Authority Service (`match_authority_service.rs`)**
   - State transitions lacked proper transaction isolation
   - Idempotency checks occurred outside transactions
   - No row locking during state updates

3. **Matchmaking Service (`matchmaking.rs`)**
   - Queue operations lacked row-level locking
   - Duplicate queue entries could be created under concurrent load
   - ELO rating creation had no transaction protection

4. **Tournament Service (`tournament_service.rs`)**
   - Used transactions but without explicit isolation levels
   - Balance checks and updates were not atomic

### Impact

- Data inconsistency under high load
- Lost updates in wallet balances
- Duplicate queue entries
- Invalid state transitions
- Potential for deadlocks

## Solution Architecture

### 1. Transaction Module (`transaction.rs`)

Created a centralized transaction management module with:

- **Isolation Levels**: Support for READ COMMITTED, REPEATABLE READ, and SERIALIZABLE
- **Automatic Retry**: Exponential backoff retry logic for serialization failures
- **Row Locking**: Pessimistic locking with `FOR UPDATE` clauses
- **Transaction Config**: Configurable retry counts and delays

```rust
pub enum IsolationLevel {
    ReadCommitted,
    RepeatableRead,
    Serializable,
}

pub struct TransactionConfig {
    pub isolation_level: IsolationLevel,
    pub max_retries: u32,
    pub retry_delay: Duration,
}
```

### 2. Transaction Monitor (`transaction_monitor.rs`)

Implemented comprehensive monitoring and analytics:

- **Metrics Tracking**: Duration, retry count, success/failure rates
- **Deadlock Detection**: Long-running transaction detection
- **Statistics**: Aggregated metrics for performance analysis
- **Cleanup**: Automatic cleanup of old records

### 3. Service Updates

#### Wallet Service

All balance operations now use:
- SERIALIZABLE isolation level for critical operations
- Row locking with `FOR UPDATE`
- Atomic read-then-write within transactions
- Automatic retry on serialization failures

**Before:**
```rust
pub async fn deduct_fiat_balance(&self, user_id: Uuid, amount: i64) -> Result<(), WalletError> {
    let wallet = self.get_wallet(user_id).await?;
    if wallet.balance_ngn.unwrap_or(0) < amount {
        return Err(WalletError::InsufficientBalance { ... });
    }
    sqlx::query!("UPDATE wallets SET balance_ngn = balance_ngn - $1 ...")
        .execute(&*self.db_pool).await?;
}
```

**After:**
```rust
pub async fn deduct_fiat_balance(&self, user_id: Uuid, amount: i64) -> Result<(), WalletError> {
    execute_transaction(&db_pool, &config, move |tx| {
        Box::pin(async move {
            let wallet = sqlx::query!(
                "SELECT balance_ngn FROM wallets WHERE user_id = $1 FOR UPDATE",
                user_id
            ).fetch_one(&mut **tx).await?;
            
            // Check and update atomically
            sqlx::query!("UPDATE wallets SET balance_ngn = balance_ngn - $1 ...")
                .execute(&mut **tx).await?;
        })
    }).await?;
}
```

#### Match Authority Service

- Idempotency checks moved inside transactions with row locking
- State transitions use SERIALIZABLE isolation
- All database operations in a single atomic transaction

#### Matchmaking Service

- Queue operations use READ COMMITTED isolation
- Duplicate prevention with row locking
- ELO creation protected with transactions

### 4. Database Schema

Added `transaction_monitor` table for analytics:

```sql
CREATE TYPE transaction_status AS ENUM ('started', 'completed', 'failed', 'retried', 'rolled_back');

CREATE TABLE transaction_monitor (
    id UUID PRIMARY KEY,
    operation VARCHAR(255) NOT NULL,
    isolation_level VARCHAR(50) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_ms BIGINT,
    status transaction_status NOT NULL DEFAULT 'started',
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    metadata JSONB DEFAULT '{}'
);
```

## Implementation Details

### Transaction Isolation Strategy

- **SERIALIZABLE**: Used for critical financial operations (wallet balances, match state)
  - Guarantees complete isolation
  - Automatic retry on serialization failures
  - Highest consistency guarantee

- **READ COMMITTED**: Used for less critical operations (matchmaking queue)
  - Better performance under high load
  - Still prevents dirty reads
  - Sufficient for operations that can tolerate some concurrency

### Pessimistic Locking

Row-level locking using PostgreSQL's `FOR UPDATE`:

```sql
SELECT balance_ngn FROM wallets WHERE user_id = $1 FOR UPDATE
```

This prevents other transactions from modifying the same row until the transaction commits or rolls back.

### Retry Logic

Exponential backoff for serialization failures:

- Initial delay: 50ms
- Max retries: 3 (configurable)
- Backoff multiplier: 2x per retry
- Total max wait time: 350ms (50 + 100 + 200)

### Error Handling

- Serialization errors (PostgreSQL error code 40001) are automatically retried
- Non-retryable errors fail immediately
- All transactions are properly rolled back on error
- Detailed error logging for debugging

## Testing

### Concurrency Tests (`transaction_test.rs`)

Implemented comprehensive concurrency tests:

1. **Concurrent Balance Updates**
   - 10 concurrent tasks adding 100 each
   - Verifies final balance is 1000 (no lost updates)

2. **Concurrent Deductions with Insufficient Balance**
   - 10 concurrent tasks deducting 100 from 500 balance
   - Verifies exactly 5 succeed (no overdraw)

3. **Transaction Retry on Serialization**
   - 5 concurrent conflicting transactions
   - Verifies all complete with correct final state

4. **Deadlock Detection**
   - Long-running transaction holding lock
   - Verifies timeout mechanism works

### Running Tests

```bash
# Run all concurrency tests
cargo test transaction_test

# Run specific test
cargo test test_concurrent_balance_updates
```

## Monitoring

### Transaction Metrics

The transaction monitor provides:

- **Success Rate**: Percentage of transactions that complete successfully
- **Average Duration**: Mean transaction duration in milliseconds
- **Retry Rate**: Percentage of transactions that required retries
- **Failure Analysis**: Breakdown of failure reasons

### Deadlock Detection

Long-running transaction detection:

```rust
let long_running = monitor.detect_long_running_transactions(30).await?;
```

Detects transactions running longer than 30 seconds that haven't completed.

### Statistics API

```rust
let stats = monitor.get_statistics(start_time, end_time).await?;
```

Returns aggregated statistics for a time period.

## Performance Considerations

### Trade-offs

- **SERIALIZABLE isolation**: Highest consistency but potential for serialization failures
- **Retry overhead**: Adds latency under high contention
- **Row locking**: Can reduce throughput under high load

### Optimization Recommendations

1. **Use appropriate isolation levels**
   - SERIALIZABLE for financial operations
   - READ COMMITTED for non-critical operations

2. **Keep transactions short**
   - Minimize work inside transactions
   - Move non-critical operations outside

3. **Optimize retry configuration**
   - Adjust max_retries based on contention levels
   - Tune retry_delay for your latency requirements

4. **Monitor and tune**
   - Use transaction monitor to identify bottlenecks
   - Adjust isolation levels based on metrics

## Migration

### Database Migration

Run the migration to add the transaction monitor table:

```bash
cd backend
cargo install sqlx-cli
sqlx migrate run
```

### Code Migration

No breaking changes to existing APIs. The transaction module is used internally by services.

## Verification

### Manual Testing Steps

1. **Test concurrent wallet operations**
   ```bash
   # Simulate concurrent balance updates
   # Verify no lost updates occur
   ```

2. **Test match state transitions**
   ```bash
   # Create concurrent match operations
   # Verify state transitions are atomic
   ```

3. **Test matchmaking queue**
   ```bash
   # Simulate concurrent queue joins
   # Verify no duplicate entries
   ```

### Automated Testing

Run the full test suite:

```bash
cargo test --test transaction_test
```

## Rollback Plan

If issues arise, rollback steps:

1. **Disable transaction monitoring**:
   ```rust
   let monitor = TransactionMonitor::new(db_pool, false);
   ```

2. **Revert to old service methods**:
   - Restore original `wallet_service.rs`
   - Restore original `match_authority_service.rs`

3. **Drop monitoring table**:
   ```sql
   DROP TABLE transaction_monitor;
   DROP TYPE transaction_status;
   ```

## Future Enhancements

1. **Optimistic Locking**
   - Add version columns to tables
   - Implement CAS (Compare-And-Swap) operations

2. **Transaction Queuing**
   - Implement per-resource transaction queues
   - Serialize operations on hot resources

3. **Distributed Locking**
   - Add Redis-based distributed locks
   - Support multi-database transactions

4. **Enhanced Monitoring**
   - Real-time transaction dashboard
   - Alert on abnormal patterns

## References

- PostgreSQL Transaction Isolation: https://www.postgresql.org/docs/current/transaction-iso.html
- SQLx Transaction Documentation: https://docs.rs/sqlx/latest/sqlx/transaction/index.html
- Race Condition Patterns: https://en.wikipedia.org/wiki/Race_condition

## Summary

This fix eliminates race conditions in concurrent database transactions by:

1. ✅ Implementing proper transaction isolation levels
2. ✅ Adding pessimistic row locking
3. ✅ Providing automatic retry for serialization failures
4. ✅ Ensuring atomic read-then-write operations
5. ✅ Adding comprehensive monitoring and analytics
6. ✅ Including concurrency tests for verification

The solution maintains data consistency while providing good performance through appropriate isolation level selection and retry logic.
