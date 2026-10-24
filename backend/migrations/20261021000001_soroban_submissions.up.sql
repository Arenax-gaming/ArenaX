-- Soroban submission idempotency ledger (Issue #1345).
--
-- One row per idempotency key. The row is written *before* anything reaches
-- the network, and the signed envelope + tx hash are persisted before the
-- first send, so a retry after a mid-flight failure can check the ledger for
-- that hash (and re-send the identical envelope) instead of building a second
-- transaction. Terminal results are kept so duplicate keys return the
-- original outcome without re-executing.

CREATE TABLE IF NOT EXISTS soroban_submissions (
    idempotency_key  TEXT PRIMARY KEY,
    request_hash     TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'reserved'
                     CHECK (status IN ('reserved', 'signed', 'completed', 'failed')),
    tx_hash          TEXT,
    signed_envelope  TEXT,
    result           JSONB,
    attempts         INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_soroban_submissions_tx_hash
    ON soroban_submissions (tx_hash)
    WHERE tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_soroban_submissions_unfinished
    ON soroban_submissions (updated_at)
    WHERE status IN ('reserved', 'signed');
