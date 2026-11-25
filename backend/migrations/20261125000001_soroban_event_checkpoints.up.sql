-- Durable ingestion checkpoint and inbox, committed together per ledger.
CREATE TABLE soroban_event_checkpoints (
    stream TEXT PRIMARY KEY,
    last_ledger BIGINT NOT NULL CHECK (last_ledger BETWEEN 0 AND 4294967295),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE soroban_contract_events (
    stream TEXT NOT NULL REFERENCES soroban_event_checkpoints(stream),
    event_id TEXT NOT NULL,
    ledger BIGINT NOT NULL CHECK (ledger BETWEEN 1 AND 4294967295),
    payload JSONB NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (stream, event_id)
);
CREATE INDEX soroban_contract_events_order ON soroban_contract_events (stream, ledger, event_id);
