DROP TRIGGER IF EXISTS trg_elo_history_immutable ON elo_history;
DROP FUNCTION IF EXISTS elo_history_reject_mutation();
DROP INDEX IF EXISTS idx_elo_history_user_created;
DROP INDEX IF EXISTS idx_elo_history_user_game_created;
