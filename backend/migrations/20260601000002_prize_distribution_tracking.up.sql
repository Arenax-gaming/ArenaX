-- Track the on-chain transaction hash for each confirmed prize payout.
ALTER TABLE tournament_participants
    ADD COLUMN IF NOT EXISTS prize_tx_hash TEXT;

-- Admin-facing table that records every prize distribution failure so that
-- operators can investigate and manually retry failed payouts.
CREATE TABLE IF NOT EXISTS prize_distribution_failures (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id       UUID        NOT NULL,
    amount        BIGINT      NOT NULL,
    currency      TEXT        NOT NULL,
    reason        TEXT        NOT NULL,
    retry_count   INT         NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One failure row per (tournament, user) pair; retries increment retry_count.
    CONSTRAINT uq_prize_failure_tournament_user UNIQUE (tournament_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_prize_failures_tournament
    ON prize_distribution_failures (tournament_id);

CREATE INDEX IF NOT EXISTS idx_prize_failures_user
    ON prize_distribution_failures (user_id);
