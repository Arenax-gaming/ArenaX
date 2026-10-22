-- Tournament waitlist with automatic promotion when a registered player
-- withdraws (Issue #1401).
--
-- A waitlisted player is not charged an entry fee: payment is taken when a
-- slot opens and the player is promoted into the tournament. Ordering is
-- FIFO by `joined_at`, which is stable because `id` breaks ties.

CREATE TABLE IF NOT EXISTS tournament_waitlist (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status        TEXT        NOT NULL DEFAULT 'waiting'
                              CHECK (status IN ('waiting', 'promoted', 'cancelled')),
    joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    promoted_at   TIMESTAMPTZ,
    cancelled_at  TIMESTAMPTZ,
    CONSTRAINT uq_tournament_waitlist_tournament_user UNIQUE (tournament_id, user_id)
);

-- Drives the "next waiting player" lookup during promotion.
CREATE INDEX IF NOT EXISTS idx_tournament_waitlist_queue
    ON tournament_waitlist (tournament_id, status, joined_at, id);

-- Fast lookup of a single player's waitlist entry.
CREATE INDEX IF NOT EXISTS idx_tournament_waitlist_user
    ON tournament_waitlist (user_id);

COMMENT ON TABLE tournament_waitlist IS
    'FIFO waitlist for full tournaments; entries auto-promote when a slot frees up';
