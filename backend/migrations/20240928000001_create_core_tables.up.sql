-- ArenaX Core Database Schema
-- Migration: 20240928000001_create_core_tables
-- Description: Creates all core tables for users, tournaments, matches, wallets, and stellar integration

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- USERS AND AUTHENTICATION
-- ============================================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    display_name VARCHAR(100),
    avatar_url TEXT,
    bio TEXT,
    country_code VARCHAR(3) DEFAULT 'NGA',
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    role VARCHAR(20) DEFAULT 'player',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

CREATE INDEX idx_users_phone ON users(phone_number);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_active ON users(is_active) WHERE is_active = TRUE;

-- ============================================================================
-- STELLAR BLOCKCHAIN INTEGRATION
-- ============================================================================

CREATE TABLE stellar_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    public_key VARCHAR(56) UNIQUE NOT NULL,
    encrypted_secret_key TEXT, -- Encrypted with app secret
    account_type VARCHAR(20) DEFAULT 'user', -- user, tournament, prize_pool
    is_funded BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    balance_xlm BIGINT DEFAULT 0, -- in stroops
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stellar_accounts_user ON stellar_accounts(user_id);
CREATE INDEX idx_stellar_accounts_public_key ON stellar_accounts(public_key);
CREATE INDEX idx_stellar_accounts_type ON stellar_accounts(account_type);

CREATE TABLE stellar_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    transaction_hash VARCHAR(64) UNIQUE NOT NULL,
    source_account VARCHAR(56) NOT NULL,
    destination_account VARCHAR(56) NOT NULL,
    amount BIGINT NOT NULL, -- in stroops
    asset_code VARCHAR(12) DEFAULT 'XLM',
    asset_issuer VARCHAR(56),
    operation_type VARCHAR(50) NOT NULL, -- payment, create_account, etc.
    memo TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    ledger_sequence BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_stellar_tx_hash ON stellar_transactions(transaction_hash);
CREATE INDEX idx_stellar_tx_user ON stellar_transactions(user_id);
CREATE INDEX idx_stellar_tx_source ON stellar_transactions(source_account);
CREATE INDEX idx_stellar_tx_dest ON stellar_transactions(destination_account);
CREATE INDEX idx_stellar_tx_status ON stellar_transactions(status);

-- ============================================================================
-- WALLETS AND FINANCIAL OPERATIONS
-- ============================================================================

CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    balance DECIMAL(19, 2) DEFAULT 0.00,
    escrow_balance DECIMAL(19, 2) DEFAULT 0.00,
    currency VARCHAR(3) DEFAULT 'NGN',
    balance_ngn BIGINT DEFAULT 0, -- in kobo
    balance_arenax_tokens BIGINT DEFAULT 0,
    balance_xlm BIGINT DEFAULT 0, -- in stroops
    stellar_account_id UUID REFERENCES stellar_accounts(id),
    stellar_public_key VARCHAR(56),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT positive_balance CHECK (balance >= 0),
    CONSTRAINT positive_escrow CHECK (escrow_balance >= 0)
);

CREATE INDEX idx_wallets_user ON wallets(user_id);
CREATE INDEX idx_wallets_stellar_account ON wallets(stellar_account_id);

CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    transaction_type VARCHAR(20) NOT NULL, -- deposit, withdrawal, payment, refund, prize, entry_fee, fee
    amount DECIMAL(19, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'NGN',
    status VARCHAR(20) DEFAULT 'pending', -- pending, processing, completed, failed, cancelled, refunded
    reference VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    metadata TEXT, -- JSON
    stellar_transaction_id UUID REFERENCES stellar_transactions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_type ON transactions(transaction_type);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_reference ON transactions(reference);
CREATE INDEX idx_transactions_created ON transactions(created_at DESC);

-- ============================================================================
-- TOURNAMENTS
-- ============================================================================

CREATE TABLE tournaments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    game VARCHAR(50) NOT NULL,
    max_participants INTEGER NOT NULL CHECK (max_participants >= 2),
    entry_fee BIGINT DEFAULT 0, -- in kobo or smallest unit
    entry_fee_currency VARCHAR(20) DEFAULT 'NGN',
    prize_pool BIGINT DEFAULT 0,
    prize_pool_currency VARCHAR(20) DEFAULT 'NGN',
    status INTEGER DEFAULT 0, -- 0=draft, 1=upcoming, 2=registration_open, 3=registration_closed, 4=in_progress, 5=completed, 6=cancelled
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    registration_deadline TIMESTAMPTZ NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    bracket_type INTEGER DEFAULT 0, -- 0=single_elimination, 1=double_elimination, 2=round_robin, 3=swiss
    rules TEXT,
    min_skill_level INTEGER,
    max_skill_level INTEGER
);

CREATE INDEX idx_tournaments_status ON tournaments(status);
CREATE INDEX idx_tournaments_game ON tournaments(game);
CREATE INDEX idx_tournaments_start_time ON tournaments(start_time);
CREATE INDEX idx_tournaments_registration_deadline ON tournaments(registration_deadline);
CREATE INDEX idx_tournaments_created_by ON tournaments(created_by);

CREATE TABLE tournament_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    entry_fee_paid BOOLEAN DEFAULT FALSE,
    status INTEGER DEFAULT 0, -- 0=registered, 1=paid, 2=active, 3=eliminated, 4=disqualified, 5=withdrawn
    seed_number INTEGER,
    current_round INTEGER,
    eliminated_at TIMESTAMPTZ,
    final_rank INTEGER,
    prize_amount BIGINT,
    prize_currency VARCHAR(20),
    UNIQUE(tournament_id, user_id)
);

CREATE INDEX idx_tournament_participants_tournament ON tournament_participants(tournament_id);
CREATE INDEX idx_tournament_participants_user ON tournament_participants(user_id);
CREATE INDEX idx_tournament_participants_status ON tournament_participants(status);

CREATE TABLE prize_pools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID UNIQUE REFERENCES tournaments(id) ON DELETE CASCADE,
    total_amount BIGINT DEFAULT 0,
    currency VARCHAR(20) DEFAULT 'NGN',
    stellar_account VARCHAR(56),
    stellar_asset_code VARCHAR(12),
    distribution_percentages TEXT DEFAULT '[50, 30, 20]', -- JSON array
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prize_pools_tournament ON prize_pools(tournament_id);

CREATE TABLE tournament_rounds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL,
    round_type VARCHAR(20) NOT NULL, -- qualification, elimination, semifinal, final
    status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, completed, cancelled
    scheduled_start TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tournament_id, round_number)
);

CREATE INDEX idx_tournament_rounds_tournament ON tournament_rounds(tournament_id);
CREATE INDEX idx_tournament_rounds_status ON tournament_rounds(status);

CREATE TABLE tournament_matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
    round_id UUID REFERENCES tournament_rounds(id) ON DELETE CASCADE,
    match_number INTEGER NOT NULL,
    player1_id UUID REFERENCES users(id) ON DELETE SET NULL,
    player2_id UUID REFERENCES users(id) ON DELETE SET NULL,
    winner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    player1_score INTEGER,
    player2_score INTEGER,
    status VARCHAR(20) DEFAULT 'pending', -- pending, scheduled, in_progress, completed, disputed, cancelled, abandoned
    scheduled_time TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tournament_matches_tournament ON tournament_matches(tournament_id);
CREATE INDEX idx_tournament_matches_round ON tournament_matches(round_id);
CREATE INDEX idx_tournament_matches_player1 ON tournament_matches(player1_id);
CREATE INDEX idx_tournament_matches_player2 ON tournament_matches(player2_id);
CREATE INDEX idx_tournament_matches_status ON tournament_matches(status);

-- ============================================================================
-- MATCHES AND MATCHMAKING
-- ============================================================================

CREATE TABLE matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,
    round_id UUID REFERENCES tournament_rounds(id) ON DELETE SET NULL,
    match_type INTEGER DEFAULT 1, -- 0=tournament, 1=casual, 2=ranked, 3=practice
    status INTEGER DEFAULT 0, -- 0=pending, 1=scheduled, 2=in_progress, 3=completed, 4=disputed, 5=cancelled, 6=abandoned
    player1_id UUID REFERENCES users(id) ON DELETE SET NULL,
    player2_id UUID REFERENCES users(id) ON DELETE SET NULL,
    winner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    player1_score INTEGER,
    player2_score INTEGER,
    player1_elo_before INTEGER,
    player2_elo_before INTEGER,
    player1_elo_after INTEGER,
    player2_elo_after INTEGER,
    scheduled_time TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    game_mode VARCHAR(50) NOT NULL,
    map VARCHAR(100),
    match_duration INTEGER -- in seconds
);

CREATE INDEX idx_matches_tournament ON matches(tournament_id);
CREATE INDEX idx_matches_player1 ON matches(player1_id);
CREATE INDEX idx_matches_player2 ON matches(player2_id);
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_matches_type ON matches(match_type);
CREATE INDEX idx_matches_game_mode ON matches(game_mode);

CREATE TABLE match_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
    player_id UUID REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    proof_url TEXT,
    telemetry_data TEXT, -- JSON
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified BOOLEAN DEFAULT FALSE,
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    dispute_reason TEXT
);

CREATE INDEX idx_match_scores_match ON match_scores(match_id);
CREATE INDEX idx_match_scores_player ON match_scores(player_id);

CREATE TABLE match_disputes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
    disputing_player_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT NOT NULL,
    evidence_urls TEXT, -- JSON array
    status INTEGER DEFAULT 0, -- 0=pending, 1=under_review, 2=resolved, 3=rejected
    admin_reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    admin_notes TEXT,
    resolution TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_match_disputes_match ON match_disputes(match_id);
CREATE INDEX idx_match_disputes_status ON match_disputes(status);

CREATE TABLE matchmaking_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    game VARCHAR(50) NOT NULL,
    game_mode VARCHAR(50) NOT NULL,
    current_elo INTEGER NOT NULL,
    min_elo INTEGER NOT NULL,
    max_elo INTEGER NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    status INTEGER DEFAULT 0, -- 0=waiting, 1=matched, 2=expired, 3=cancelled
    matched_at TIMESTAMPTZ,
    match_id UUID REFERENCES matches(id) ON DELETE SET NULL
);

CREATE INDEX idx_matchmaking_queue_game ON matchmaking_queue(game, game_mode);
CREATE INDEX idx_matchmaking_queue_status ON matchmaking_queue(status);
CREATE INDEX idx_matchmaking_queue_elo ON matchmaking_queue(current_elo);
CREATE INDEX idx_matchmaking_queue_expires ON matchmaking_queue(expires_at);

-- ============================================================================
-- ELO AND RANKINGS
-- ============================================================================

CREATE TABLE user_elo (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    game VARCHAR(50) NOT NULL,
    current_rating INTEGER DEFAULT 1200,
    peak_rating INTEGER DEFAULT 1200,
    games_played INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    draws INTEGER DEFAULT 0,
    win_streak INTEGER DEFAULT 0,
    loss_streak INTEGER DEFAULT 0,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, game)
);

CREATE INDEX idx_user_elo_user ON user_elo(user_id);
CREATE INDEX idx_user_elo_game ON user_elo(game);
CREATE INDEX idx_user_elo_rating ON user_elo(current_rating DESC);

CREATE TABLE elo_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    game VARCHAR(50) NOT NULL,
    match_id UUID REFERENCES matches(id) ON DELETE SET NULL,
    rating_before INTEGER NOT NULL,
    rating_after INTEGER NOT NULL,
    rating_change INTEGER NOT NULL,
    opponent_id UUID REFERENCES users(id) ON DELETE SET NULL,
    opponent_rating INTEGER,
    result INTEGER NOT NULL, -- 0=win, 1=loss, 2=draw
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_elo_history_user ON elo_history(user_id);
CREATE INDEX idx_elo_history_game ON elo_history(game);
CREATE INDEX idx_elo_history_match ON elo_history(match_id);
CREATE INDEX idx_elo_history_created ON elo_history(created_at DESC);

-- ============================================================================
-- LEADERBOARDS
-- ============================================================================

CREATE TABLE leaderboards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    game VARCHAR(50) NOT NULL,
    period VARCHAR(20) NOT NULL, -- daily, weekly, monthly, all_time
    ranking INTEGER NOT NULL,
    elo_rating INTEGER NOT NULL,
    matches_played INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    win_rate DECIMAL(5, 2) DEFAULT 0.00,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, game, period, period_start)
);

CREATE INDEX idx_leaderboards_game_period ON leaderboards(game, period, ranking);
CREATE INDEX idx_leaderboards_user ON leaderboards(user_id);
CREATE INDEX idx_leaderboards_period ON leaderboards(period_start, period_end);

-- ============================================================================
-- AUDIT LOGS
-- ============================================================================

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,
    details TEXT, -- JSON
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

-- ============================================================================
-- MIGRATION TRACKING
-- ============================================================================

COMMENT ON TABLE users IS 'User accounts and authentication information';
COMMENT ON TABLE stellar_accounts IS 'Stellar blockchain account integration';
COMMENT ON TABLE stellar_transactions IS 'Stellar blockchain transaction records';
COMMENT ON TABLE wallets IS 'User wallet balances and escrow management';
COMMENT ON TABLE transactions IS 'Financial transaction records';
COMMENT ON TABLE tournaments IS 'Tournament definitions and configuration';
COMMENT ON TABLE tournament_participants IS 'User participation in tournaments';
COMMENT ON TABLE prize_pools IS 'Tournament prize pool management';
COMMENT ON TABLE matches IS 'Match records and results';
COMMENT ON TABLE match_scores IS 'Player score submissions with proof';
COMMENT ON TABLE match_disputes IS 'Match dispute management';
COMMENT ON TABLE matchmaking_queue IS 'Matchmaking queue for ranked games';
COMMENT ON TABLE user_elo IS 'User Elo ratings per game';
COMMENT ON TABLE elo_history IS 'Historical Elo rating changes';
COMMENT ON TABLE leaderboards IS 'Leaderboard rankings by period';
COMMENT ON TABLE audit_logs IS 'Security and operation audit trail';
