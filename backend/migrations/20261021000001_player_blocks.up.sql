-- Player social block list (#1407)
-- Blocks are bidirectional: when A blocks B, both (A,B) and (B,A) rows are
-- inserted so that a single `WHERE blocker_id = $1` query returns all users
-- that $1 cannot interact with.

CREATE TABLE IF NOT EXISTS player_blocks (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(blocker_id, blocked_id)
);

-- Index for fast lookups of "who did this user block?"
CREATE INDEX IF NOT EXISTS idx_player_blocks_blocker ON player_blocks(blocker_id);
-- Index for fast lookups of "who blocked this user?"
CREATE INDEX IF NOT EXISTS idx_player_blocks_blocked ON player_blocks(blocked_id);
