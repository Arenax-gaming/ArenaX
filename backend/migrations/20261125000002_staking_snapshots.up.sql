-- Point-in-time staking positions per season (Issue #1524).
--
-- Season-end leaderboard calculations need each player's staked amount as it
-- stood when the season closed. Staking positions keep changing after that, so
-- the value is copied here once and never edited.

CREATE TABLE IF NOT EXISTS staking_snapshots (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id         UUID NOT NULL REFERENCES seasons(id) ON DELETE RESTRICT,
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    stellar_address   VARCHAR(56) NOT NULL,
    staked_amount     BIGINT NOT NULL CHECK (staked_amount >= 0),
    tier              VARCHAR(20) NOT NULL,
    governance_weight BIGINT NOT NULL,
    snapshot_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- One position per player per season: a re-run is a no-op, never a second
    -- row that would double-count the player in the season standings.
    UNIQUE (season_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_staking_snapshots_season
    ON staking_snapshots (season_id);

CREATE OR REPLACE FUNCTION staking_snapshots_reject_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'staking_snapshots is append-only: % is not permitted', TG_OP
        USING HINT = 'Write a snapshot for a new season instead of editing history.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staking_snapshots_immutable ON staking_snapshots;
CREATE TRIGGER trg_staking_snapshots_immutable
    BEFORE UPDATE OR DELETE ON staking_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION staking_snapshots_reject_mutation();

COMMENT ON TABLE staking_snapshots IS
    'Immutable per-season copies of staking positions used for season-end leaderboard calculations';
