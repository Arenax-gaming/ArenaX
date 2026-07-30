-- Drop transaction monitor table
DROP INDEX IF EXISTS idx_transaction_monitor_long_running;
DROP INDEX IF EXISTS idx_transaction_monitor_isolation_level;
DROP INDEX IF EXISTS idx_transaction_monitor_operation;
DROP INDEX IF EXISTS idx_transaction_monitor_status;
DROP INDEX IF EXISTS idx_transaction_monitor_started_at;
DROP TABLE IF EXISTS transaction_monitor;
DROP TYPE IF EXISTS transaction_status;
