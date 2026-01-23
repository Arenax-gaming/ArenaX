-- Rollback ArenaX Core Database Schema
-- Migration: 20240928000001_create_core_tables
-- Description: Drops all core tables in reverse order of dependencies

-- Drop audit logs
DROP TABLE IF EXISTS audit_logs CASCADE;

-- Drop leaderboards
DROP TABLE IF EXISTS leaderboards CASCADE;

-- Drop Elo tracking
DROP TABLE IF EXISTS elo_history CASCADE;
DROP TABLE IF EXISTS user_elo CASCADE;

-- Drop matchmaking
DROP TABLE IF EXISTS matchmaking_queue CASCADE;
DROP TABLE IF EXISTS match_disputes CASCADE;
DROP TABLE IF EXISTS match_scores CASCADE;
DROP TABLE IF EXISTS matches CASCADE;

-- Drop tournament matches and rounds
DROP TABLE IF EXISTS tournament_matches CASCADE;
DROP TABLE IF EXISTS tournament_rounds CASCADE;
DROP TABLE IF EXISTS prize_pools CASCADE;
DROP TABLE IF EXISTS tournament_participants CASCADE;
DROP TABLE IF EXISTS tournaments CASCADE;

-- Drop transactions and wallets
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS wallets CASCADE;

-- Drop Stellar integration
DROP TABLE IF EXISTS stellar_transactions CASCADE;
DROP TABLE IF EXISTS stellar_accounts CASCADE;

-- Drop users
DROP TABLE IF EXISTS users CASCADE;

-- Drop extensions if they were created
-- DROP EXTENSION IF EXISTS "uuid-ossp";
