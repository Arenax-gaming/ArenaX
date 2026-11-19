-- ELO history is an append-only audit trail (Issue #1400).
--
-- Records are written once per player per resolved match and must never be
-- edited or deleted: a rewritten history would silently falsify a player's
-- progression chart. Enforcement lives in the database so it holds for every
-- writer, not just the Rust service.

-- Supports the date-range query endpoint
-- `GET /api/matchmaking/elo/{game}?from=...&to=...`.
CREATE INDEX IF NOT EXISTS idx_elo_history_user_game_created
    ON elo_history (user_id, game, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_elo_history_user_created
    ON elo_history (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION elo_history_reject_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'elo_history is append-only: % is not permitted', TG_OP
        USING HINT = 'Write a new history row instead of modifying an existing one.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_elo_history_immutable ON elo_history;
CREATE TRIGGER trg_elo_history_immutable
    BEFORE UPDATE OR DELETE ON elo_history
    FOR EACH ROW
    EXECUTE FUNCTION elo_history_reject_mutation();

COMMENT ON TABLE elo_history IS
    'Immutable per-match ELO snapshots (rating before/after, delta, opponent, result)';
