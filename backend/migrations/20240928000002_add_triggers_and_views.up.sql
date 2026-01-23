-- ArenaX Database Triggers and Views
-- Migration: 20240928000002_add_triggers_and_views
-- Description: Creates triggers for automation and views for statistics

-- ============================================================================
-- TIMESTAMP UPDATE TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_stellar_accounts_updated_at BEFORE UPDATE ON stellar_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON wallets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tournaments_updated_at BEFORE UPDATE ON tournaments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_prize_pools_updated_at BEFORE UPDATE ON prize_pools
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tournament_rounds_updated_at BEFORE UPDATE ON tournament_rounds
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tournament_matches_updated_at BEFORE UPDATE ON tournament_matches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_matches_updated_at BEFORE UPDATE ON matches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VIEWS FOR STATISTICS AND ANALYTICS
-- ============================================================================

-- User Statistics View
CREATE OR REPLACE VIEW user_statistics AS
SELECT
    u.id AS user_id,
    u.username,
    u.display_name,
    COALESCE(SUM(ue.games_played), 0) AS total_games,
    COALESCE(SUM(ue.wins), 0) AS total_wins,
    COALESCE(SUM(ue.losses), 0) AS total_losses,
    COALESCE(SUM(ue.draws), 0) AS total_draws,
    CASE
        WHEN COALESCE(SUM(ue.games_played), 0) > 0
        THEN ROUND((SUM(ue.wins)::DECIMAL / SUM(ue.games_played)::DECIMAL * 100), 2)
        ELSE 0
    END AS win_rate,
    MAX(ue.win_streak) AS best_win_streak,
    w.balance_ngn,
    w.balance_arenax_tokens,
    COUNT(DISTINCT tp.tournament_id) AS tournaments_joined,
    COUNT(DISTINCT CASE WHEN tp.final_rank = 1 THEN tp.tournament_id END) AS tournaments_won,
    u.created_at,
    u.last_login_at
FROM users u
LEFT JOIN user_elo ue ON u.id = ue.user_id
LEFT JOIN wallets w ON u.id = w.user_id
LEFT JOIN tournament_participants tp ON u.id = tp.user_id
WHERE u.is_active = TRUE
GROUP BY u.id, u.username, u.display_name, w.balance_ngn, w.balance_arenax_tokens, u.created_at, u.last_login_at;

-- Tournament Standings View
CREATE OR REPLACE VIEW tournament_standings AS
SELECT
    t.id AS tournament_id,
    t.name AS tournament_name,
    u.id AS user_id,
    u.username,
    u.display_name,
    tp.status AS participation_status,
    COUNT(DISTINCT CASE WHEN tm.winner_id = u.id THEN tm.id END) AS wins,
    COUNT(DISTINCT CASE WHEN (tm.player1_id = u.id OR tm.player2_id = u.id) AND tm.status = 3 THEN tm.id END) AS matches_played,
    COALESCE(SUM(CASE WHEN tm.winner_id = u.id THEN 1 ELSE 0 END), 0) AS total_score,
    ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY
        COUNT(DISTINCT CASE WHEN tm.winner_id = u.id THEN tm.id END) DESC,
        COUNT(DISTINCT CASE WHEN (tm.player1_id = u.id OR tm.player2_id = u.id) THEN tm.id END) ASC
    ) AS current_rank
FROM tournaments t
JOIN tournament_participants tp ON t.id = tp.tournament_id
JOIN users u ON tp.user_id = u.id
LEFT JOIN tournament_matches tm ON t.id = tm.tournament_id AND (tm.player1_id = u.id OR tm.player2_id = u.id)
WHERE t.status IN (4, 5) -- in_progress or completed
GROUP BY t.id, t.name, u.id, u.username, u.display_name, tp.status;

-- Active Tournaments View
CREATE OR REPLACE VIEW active_tournaments AS
SELECT
    t.id,
    t.name,
    t.game,
    t.status,
    t.entry_fee,
    t.entry_fee_currency,
    t.prize_pool,
    t.prize_pool_currency,
    t.max_participants,
    COUNT(tp.id) AS current_participants,
    t.start_time,
    t.registration_deadline,
    t.bracket_type,
    u.username AS created_by_username
FROM tournaments t
LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id
LEFT JOIN users u ON t.created_by = u.id
WHERE t.status IN (1, 2, 3, 4) -- upcoming, registration_open, registration_closed, in_progress
GROUP BY t.id, t.name, t.game, t.status, t.entry_fee, t.entry_fee_currency,
         t.prize_pool, t.prize_pool_currency, t.max_participants, t.start_time,
         t.registration_deadline, t.bracket_type, u.username;

-- Match History View
CREATE OR REPLACE VIEW match_history AS
SELECT
    m.id AS match_id,
    m.match_type,
    m.status,
    m.game_mode,
    u1.id AS player1_id,
    u1.username AS player1_username,
    m.player1_score,
    m.player1_elo_before,
    m.player1_elo_after,
    u2.id AS player2_id,
    u2.username AS player2_username,
    m.player2_score,
    m.player2_elo_before,
    m.player2_elo_after,
    CASE
        WHEN m.winner_id = u1.id THEN u1.username
        WHEN m.winner_id = u2.id THEN u2.username
        ELSE NULL
    END AS winner_username,
    m.match_duration,
    m.started_at,
    m.completed_at,
    t.name AS tournament_name
FROM matches m
LEFT JOIN users u1 ON m.player1_id = u1.id
LEFT JOIN users u2 ON m.player2_id = u2.id
LEFT JOIN tournaments t ON m.tournament_id = t.id
WHERE m.status = 3; -- completed

-- Leaderboard Summary View
CREATE OR REPLACE VIEW leaderboard_summary AS
SELECT
    l.game,
    l.period,
    u.id AS user_id,
    u.username,
    u.display_name,
    u.avatar_url,
    l.ranking,
    l.elo_rating,
    l.matches_played,
    l.wins,
    l.losses,
    l.win_rate,
    l.updated_at
FROM leaderboards l
JOIN users u ON l.user_id = u.id
WHERE l.period_start <= NOW() AND l.period_end >= NOW()
ORDER BY l.game, l.period, l.ranking;

-- Wallet Balances View
CREATE OR REPLACE VIEW wallet_balances AS
SELECT
    u.id AS user_id,
    u.username,
    w.balance_ngn,
    w.balance_arenax_tokens,
    w.balance_xlm,
    w.escrow_balance,
    w.is_active AS wallet_active,
    sa.public_key AS stellar_public_key,
    sa.is_funded AS stellar_funded,
    w.updated_at
FROM users u
LEFT JOIN wallets w ON u.id = w.user_id
LEFT JOIN stellar_accounts sa ON w.stellar_account_id = sa.id
WHERE u.is_active = TRUE;

-- Tournament Revenue View
CREATE OR REPLACE VIEW tournament_revenue AS
SELECT
    t.id AS tournament_id,
    t.name,
    t.game,
    t.entry_fee,
    t.entry_fee_currency,
    COUNT(tp.id) AS total_participants,
    (t.entry_fee * COUNT(tp.id)) AS total_revenue,
    t.prize_pool,
    (t.entry_fee * COUNT(tp.id) - t.prize_pool) AS platform_revenue,
    t.status,
    t.created_at
FROM tournaments t
LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id AND tp.entry_fee_paid = TRUE
GROUP BY t.id, t.name, t.game, t.entry_fee, t.entry_fee_currency, t.prize_pool, t.status, t.created_at;

-- ============================================================================
-- FUNCTIONS FOR COMMON OPERATIONS
-- ============================================================================

-- Function to get user's current Elo for a specific game
CREATE OR REPLACE FUNCTION get_user_elo(p_user_id UUID, p_game VARCHAR)
RETURNS INTEGER AS $$
DECLARE
    v_elo INTEGER;
BEGIN
    SELECT current_rating INTO v_elo
    FROM user_elo
    WHERE user_id = p_user_id AND game = p_game;

    RETURN COALESCE(v_elo, 1200); -- Default Elo rating
END;
$$ LANGUAGE plpgsql;

-- Function to check if user can join tournament
CREATE OR REPLACE FUNCTION can_join_tournament(p_user_id UUID, p_tournament_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_can_join BOOLEAN := FALSE;
    v_tournament RECORD;
    v_participant_count INTEGER;
    v_user_elo INTEGER;
BEGIN
    -- Get tournament details
    SELECT * INTO v_tournament
    FROM tournaments
    WHERE id = p_tournament_id;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Check if registration is open
    IF v_tournament.status != 2 THEN -- registration_open
        RETURN FALSE;
    END IF;

    -- Check if deadline passed
    IF NOW() > v_tournament.registration_deadline THEN
        RETURN FALSE;
    END IF;

    -- Check if already participant
    IF EXISTS (SELECT 1 FROM tournament_participants WHERE tournament_id = p_tournament_id AND user_id = p_user_id) THEN
        RETURN FALSE;
    END IF;

    -- Check participant limit
    SELECT COUNT(*) INTO v_participant_count
    FROM tournament_participants
    WHERE tournament_id = p_tournament_id;

    IF v_participant_count >= v_tournament.max_participants THEN
        RETURN FALSE;
    END IF;

    -- Check skill level requirements
    IF v_tournament.min_skill_level IS NOT NULL OR v_tournament.max_skill_level IS NOT NULL THEN
        v_user_elo := get_user_elo(p_user_id, v_tournament.game);

        IF v_tournament.min_skill_level IS NOT NULL AND v_user_elo < v_tournament.min_skill_level THEN
            RETURN FALSE;
        END IF;

        IF v_tournament.max_skill_level IS NOT NULL AND v_user_elo > v_tournament.max_skill_level THEN
            RETURN FALSE;
        END IF;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate win rate
CREATE OR REPLACE FUNCTION calculate_win_rate(p_wins INTEGER, p_total_games INTEGER)
RETURNS DECIMAL(5,2) AS $$
BEGIN
    IF p_total_games = 0 THEN
        RETURN 0.00;
    END IF;
    RETURN ROUND((p_wins::DECIMAL / p_total_games::DECIMAL * 100), 2);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON VIEW user_statistics IS 'Comprehensive user performance statistics across all games';
COMMENT ON VIEW tournament_standings IS 'Real-time tournament standings and rankings';
COMMENT ON VIEW active_tournaments IS 'List of currently active or upcoming tournaments';
COMMENT ON VIEW match_history IS 'Completed match records with player details';
COMMENT ON VIEW leaderboard_summary IS 'Current leaderboard standings by game and period';
COMMENT ON VIEW wallet_balances IS 'User wallet balances and Stellar integration status';
COMMENT ON VIEW tournament_revenue IS 'Tournament revenue and platform earnings analysis';

COMMENT ON FUNCTION get_user_elo IS 'Get user Elo rating for a specific game, returns 1200 if not found';
COMMENT ON FUNCTION can_join_tournament IS 'Check if a user can join a tournament based on all requirements';
COMMENT ON FUNCTION calculate_win_rate IS 'Calculate win rate percentage from wins and total games';
