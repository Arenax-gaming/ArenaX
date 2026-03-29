-- Matchmaking Queue Table
CREATE TABLE IF NOT EXISTS matchmaking_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game VARCHAR(100) NOT NULL,
    game_mode VARCHAR(100) NOT NULL,
    current_elo INTEGER NOT NULL DEFAULT 1200,
    min_elo INTEGER NOT NULL,
    max_elo INTEGER NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    matched_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL DEFAULT 'waiting',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- User ELO Ratings Table
CREATE TABLE IF NOT EXISTS user_elo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game VARCHAR(100) NOT NULL,
    current_rating INTEGER NOT NULL DEFAULT 1200,
    peak_rating INTEGER NOT NULL DEFAULT 1200,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    win_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0000,
    win_streak INTEGER NOT NULL DEFAULT 0,
    loss_streak INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, game)
);

-- ELO History Table
CREATE TABLE IF NOT EXISTS elo_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game VARCHAR(100) NOT NULL,
    old_rating INTEGER NOT NULL,
    new_rating INTEGER NOT NULL,
    change_amount INTEGER NOT NULL,
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Matches Table (enhanced for matchmaking)
CREATE TABLE IF NOT EXISTS matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,
    round_id UUID REFERENCES tournament_rounds(id) ON DELETE SET NULL,
    match_type VARCHAR(20) NOT NULL DEFAULT 'casual',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    player1_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player2_id UUID REFERENCES users(id) ON DELETE SET NULL,
    player1_elo_before INTEGER NOT NULL DEFAULT 1200,
    player2_elo_before INTEGER DEFAULT 1200,
    player1_elo_after INTEGER,
    player2_elo_after INTEGER,
    player1_score INTEGER,
    player2_score INTEGER,
    winner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    game_mode VARCHAR(100) NOT NULL,
    scheduled_time TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Match Scores Table
CREATE TABLE IF NOT EXISTS match_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    proof_url TEXT,
    telemetry_data JSONB,
    submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(match_id, player_id)
);

-- Match Disputes Table
CREATE TABLE IF NOT EXISTS match_disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    disputing_player_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    evidence_urls TEXT[] DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    admin_reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    admin_notes TEXT,
    resolution TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create Indexes for Performance

-- Matchmaking Queue Indexes
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_user_game ON matchmaking_queue(user_id, game, game_mode);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_status ON matchmaking_queue(status);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_game_mode ON matchmaking_queue(game, game_mode);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_elo_range ON matchmaking_queue(game, game_mode, min_elo, max_elo);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_joined_at ON matchmaking_queue(joined_at);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_expires_at ON matchmaking_queue(expires_at);

-- User ELO Indexes
CREATE INDEX IF NOT EXISTS idx_user_elo_user_game ON user_elo(user_id, game);
CREATE INDEX IF NOT EXISTS idx_user_elo_rating ON user_elo(game, current_rating DESC);
CREATE INDEX IF NOT EXISTS idx_user_elo_win_rate ON user_elo(game, win_rate DESC);

-- ELO History Indexes
CREATE INDEX IF NOT EXISTS idx_elo_history_user_game ON elo_history(user_id, game);
CREATE INDEX IF NOT EXISTS idx_elo_history_created_at ON elo_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_elo_history_match ON elo_history(match_id);

-- Matches Indexes
CREATE INDEX IF NOT EXISTS idx_matches_players ON matches(player1_id, player2_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_game_mode ON matches(game_mode);
CREATE INDEX IF NOT EXISTS idx_matches_created_at ON matches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_completed_at ON matches(completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id, round_id);

-- Match Scores Indexes
CREATE INDEX IF NOT EXISTS idx_match_scores_match ON match_scores(match_id);
CREATE INDEX IF NOT EXISTS idx_match_scores_player ON match_scores(player_id);
CREATE INDEX IF NOT EXISTS idx_match_scores_verified ON match_scores(verified);

-- Match Disputes Indexes
CREATE INDEX IF NOT EXISTS idx_match_disputes_match ON match_disputes(match_id);
CREATE INDEX IF NOT EXISTS idx_match_disputes_status ON match_disputes(status);
CREATE INDEX IF NOT EXISTS idx_match_disputes_admin ON match_disputes(admin_reviewer_id);

-- Create Enum Types for PostgreSQL
DO $$ BEGIN
    CREATE TYPE queue_status AS ENUM ('waiting', 'matched', 'expired', 'left', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE match_type AS ENUM ('casual', 'ranked', 'tournament', 'practice');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE match_status AS ENUM ('pending', 'scheduled', 'in_progress', 'completed', 'cancelled', 'disputed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE dispute_status AS ENUM ('pending', 'under_review', 'resolved', 'rejected');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Update table columns to use enum types (if they don't already)
ALTER TABLE matchmaking_queue 
ALTER COLUMN status TYPE queue_status USING status::queue_status;

ALTER TABLE matches 
ALTER COLUMN match_type TYPE match_type USING match_type::match_type,
ALTER COLUMN status TYPE match_status USING status::match_status;

ALTER TABLE match_disputes 
ALTER COLUMN status TYPE dispute_status USING status::dispute_status;

-- Create Triggers for Updated At
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to relevant tables
DROP TRIGGER IF EXISTS update_matchmaking_queue_updated_at ON matchmaking_queue;
CREATE TRIGGER update_matchmaking_queue_updated_at 
    BEFORE UPDATE ON matchmaking_queue 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_elo_updated_at ON user_elo;
CREATE TRIGGER update_user_elo_updated_at 
    BEFORE UPDATE ON user_elo 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_matches_updated_at ON matches;
CREATE TRIGGER update_matches_updated_at 
    BEFORE UPDATE ON matches 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_match_scores_updated_at ON match_scores;
CREATE TRIGGER update_match_scores_updated_at 
    BEFORE UPDATE ON match_scores 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_match_disputes_updated_at ON match_disputes;
CREATE TRIGGER update_match_disputes_updated_at 
    BEFORE UPDATE ON match_disputes 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create Views for Common Queries

-- View for active queue entries
CREATE OR REPLACE VIEW active_matchmaking_queue AS
SELECT 
    mq.*,
    u.username,
    u.avatar_url
FROM matchmaking_queue mq
JOIN users u ON mq.user_id = u.id
WHERE mq.status = 'waiting'
  AND mq.expires_at > NOW()
ORDER BY mq.joined_at ASC;

-- View for player rankings
CREATE OR REPLACE VIEW player_rankings AS
SELECT 
    ue.*,
    u.username,
    u.avatar_url,
    RANK() OVER (PARTITION BY ue.game ORDER BY ue.current_rating DESC) as rank,
    COUNT(*) OVER (PARTITION BY ue.game) as total_players,
    (RANK() OVER (PARTITION BY ue.game ORDER BY ue.current_rating DESC) * 100.0 / 
     COUNT(*) OVER (PARTITION BY ue.game)) as percentile
FROM user_elo ue
JOIN users u ON ue.user_id = u.id
WHERE ue.wins + ue.losses > 0; -- Only include players with matches

-- View for recent matches
CREATE OR REPLACE VIEW recent_matches AS
SELECT 
    m.*,
    p1.username as player1_username,
    p1.avatar_url as player1_avatar,
    p2.username as player2_username,
    p2.avatar_url as player2_avatar
FROM matches m
JOIN users p1 ON m.player1_id = p1.id
LEFT JOIN users p2 ON m.player2_id = p2.id
WHERE m.created_at >= NOW() - INTERVAL '24 hours'
ORDER BY m.created_at DESC;

-- Functions for ELO Calculations
CREATE OR REPLACE FUNCTION calculate_win_rate(wins INTEGER, losses INTEGER, draws INTEGER)
RETURNS DECIMAL(5,4) AS $$
BEGIN
    IF wins + losses + draws = 0 THEN
        RETURN 0.0000;
    END IF;
    RETURN ROUND((wins::DECIMAL / (wins + losses + draws)::DECIMAL) * 100, 4);
END;
$$ LANGUAGE plpgsql;

-- Function to update user statistics after a match
CREATE OR REPLACE FUNCTION update_user_match_stats(
    p_user_id UUID,
    p_game VARCHAR(100),
    p_result VARCHAR(10), -- 'win', 'loss', 'draw'
    p_new_elo INTEGER
)
RETURNS VOID AS $$
DECLARE
    current_user_elo RECORD;
    new_win_streak INTEGER;
    new_loss_streak INTEGER;
BEGIN
    -- Get current ELO record
    SELECT * INTO current_user_elo 
    FROM user_elo 
    WHERE user_id = p_user_id AND game = p_game;
    
    IF NOT FOUND THEN
        -- Create new ELO record if doesn't exist
        INSERT INTO user_elo (user_id, game, current_rating, peak_rating, wins, losses, draws, win_streak, loss_streak)
        VALUES (p_user_id, p_game, p_new_elo, p_new_elo, 0, 0, 0, 0, 0);
        RETURN;
    END IF;
    
    -- Update streaks based on result
    new_win_streak := CASE 
        WHEN p_result = 'win' THEN current_user_elo.win_streak + 1
        WHEN p_result = 'loss' THEN 0
        ELSE current_user_elo.win_streak
    END;
    
    new_loss_streak := CASE 
        WHEN p_result = 'loss' THEN current_user_elo.loss_streak + 1
        WHEN p_result = 'win' THEN 0
        ELSE current_user_elo.loss_streak
    END;
    
    -- Update wins/losses/draws
    IF p_result = 'win' THEN
        UPDATE user_elo SET 
            wins = wins + 1,
            win_streak = new_win_streak,
            loss_streak = new_loss_streak
        WHERE user_id = p_user_id AND game = p_game;
    ELSIF p_result = 'loss' THEN
        UPDATE user_elo SET 
            losses = losses + 1,
            win_streak = new_win_streak,
            loss_streak = new_loss_streak
        WHERE user_id = p_user_id AND game = p_game;
    ELSIF p_result = 'draw' THEN
        UPDATE user_elo SET 
            draws = draws + 1,
            win_streak = new_win_streak,
            loss_streak = new_loss_streak
        WHERE user_id = p_user_id AND game = p_game;
    END IF;
    
    -- Update ELO and win rate
    UPDATE user_elo SET 
        current_rating = p_new_elo,
        peak_rating = GREATEST(peak_rating, p_new_elo),
        win_rate = calculate_win_rate(wins, losses, draws),
        updated_at = NOW()
    WHERE user_id = p_user_id AND game = p_game;
END;
$$ LANGUAGE plpgsql;

-- Clean up expired queue entries (run this periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_queue_entries()
RETURNS INTEGER AS $$
DECLARE
    cleaned_count INTEGER;
BEGIN
    -- Mark expired entries as expired
    UPDATE matchmaking_queue 
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'waiting' 
      AND expires_at < NOW();
    
    GET DIAGNOSTICS cleaned_count = ROW_COUNT;
    
    -- Optionally delete old expired entries (older than 24 hours)
    DELETE FROM matchmaking_queue 
    WHERE status = 'expired' 
      AND updated_at < NOW() - INTERVAL '24 hours';
    
    RETURN cleaned_count;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE matchmaking_queue IS 'Queue of players waiting for matches';
COMMENT ON TABLE user_elo IS 'Player ELO ratings and statistics';
COMMENT ON TABLE elo_history IS 'History of ELO rating changes';
COMMENT ON TABLE matches IS 'Match records and results';
COMMENT ON TABLE match_scores IS 'Individual player scores for matches';
COMMENT ON TABLE match_disputes IS 'Dispute records for matches';

COMMENT ON COLUMN matchmaking_queue.min_elo IS 'Minimum ELO for matchmaking';
COMMENT ON COLUMN matchmaking_queue.max_elo IS 'Maximum ELO for matchmaking';
COMMENT ON COLUMN user_elo.win_streak IS 'Current consecutive wins';
COMMENT ON COLUMN user_elo.loss_streak IS 'Current consecutive losses';
COMMENT ON COLUMN matches.player1_elo_before IS 'Player 1 ELO before match';
COMMENT ON COLUMN matches.player2_elo_before IS 'Player 2 ELO before match';
COMMENT ON COLUMN matches.player1_elo_after IS 'Player 1 ELO after match';
COMMENT ON COLUMN matches.player2_elo_after IS 'Player 2 ELO after match';
