DROP INDEX IF EXISTS idx_tournament_matches_round_status;
DROP INDEX IF EXISTS idx_tournament_rounds_tournament_status;
DROP INDEX IF EXISTS idx_tournaments_status_cleanup;
ALTER TABLE tournaments DROP COLUMN IF EXISTS cleaned_up_at;
