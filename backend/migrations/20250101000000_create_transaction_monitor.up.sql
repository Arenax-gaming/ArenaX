-- Create transaction monitor table for analytics and debugging
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
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX idx_transaction_monitor_started_at ON transaction_monitor(started_at DESC);
CREATE INDEX idx_transaction_monitor_status ON transaction_monitor(status);
CREATE INDEX idx_transaction_monitor_operation ON transaction_monitor(operation);
CREATE INDEX idx_transaction_monitor_isolation_level ON transaction_monitor(isolation_level);

-- Create index for detecting long-running transactions
CREATE INDEX idx_transaction_monitor_long_running ON transaction_monitor(started_at, status) 
WHERE status = 'started' AND completed_at IS NULL;

-- Add comment
COMMENT ON TABLE transaction_monitor IS 'Monitor and analytics for database transactions';
COMMENT ON COLUMN transaction_monitor.isolation_level IS 'Transaction isolation level (READ COMMITTED, REPEATABLE READ, SERIALIZABLE)';
COMMENT ON COLUMN transaction_monitor.duration_ms IS 'Transaction duration in milliseconds';
COMMENT ON COLUMN transaction_monitor.retry_count IS 'Number of retry attempts for this transaction';
