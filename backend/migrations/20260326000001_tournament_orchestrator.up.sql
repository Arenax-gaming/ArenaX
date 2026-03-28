-- Add cleanup tracking to tournaments table
ALTER TABLE tournaments ADD COLUMN cleaned_up_at TIMESTAMPTZ;

-- Index for polling worker to find tournaments needing cleanup
CREATE INDEX idx_tournaments_status_cleanup ON tournaments(status, cleaned_up_at);

-- Index for finding current round of a tournament efficiently
CREATE INDEX idx_tournament_rounds_tournament_status ON tournament_rounds(tournament_id, status);

-- Index for finding matches in a round efficiently
CREATE INDEX idx_tournament_matches_round_status ON tournament_matches(round_id, status);
