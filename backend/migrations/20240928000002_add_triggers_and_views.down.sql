-- Rollback ArenaX Database Triggers and Views
-- Migration: 20240928000002_add_triggers_and_views

-- Drop functions
DROP FUNCTION IF EXISTS calculate_win_rate CASCADE;
DROP FUNCTION IF EXISTS can_join_tournament CASCADE;
DROP FUNCTION IF EXISTS get_user_elo CASCADE;

-- Drop views
DROP VIEW IF EXISTS tournament_revenue CASCADE;
DROP VIEW IF EXISTS wallet_balances CASCADE;
DROP VIEW IF EXISTS leaderboard_summary CASCADE;
DROP VIEW IF EXISTS match_history CASCADE;
DROP VIEW IF EXISTS active_tournaments CASCADE;
DROP VIEW IF EXISTS tournament_standings CASCADE;
DROP VIEW IF EXISTS user_statistics CASCADE;

-- Drop triggers
DROP TRIGGER IF EXISTS update_matches_updated_at ON matches;
DROP TRIGGER IF EXISTS update_tournament_matches_updated_at ON tournament_matches;
DROP TRIGGER IF EXISTS update_tournament_rounds_updated_at ON tournament_rounds;
DROP TRIGGER IF EXISTS update_prize_pools_updated_at ON prize_pools;
DROP TRIGGER IF EXISTS update_tournaments_updated_at ON tournaments;
DROP TRIGGER IF EXISTS update_transactions_updated_at ON transactions;
DROP TRIGGER IF EXISTS update_wallets_updated_at ON wallets;
DROP TRIGGER IF EXISTS update_stellar_accounts_updated_at ON stellar_accounts;
DROP TRIGGER IF EXISTS update_users_updated_at ON users;

-- Drop trigger function
DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
