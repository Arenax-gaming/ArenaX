-- Rollback migration for reputation system
-- Migration: 20260325000001_reputation_system_down

-- Drop tables
DROP TABLE IF EXISTS reputation_events CASCADE;
DROP TABLE IF EXISTS soroban_contracts CASCADE;

-- Remove columns from users table
ALTER TABLE users 
DROP COLUMN IF EXISTS skill_score,
DROP COLUMN IF EXISTS fair_play_score,
DROP COLUMN IF EXISTS reputation_last_updated,
DROP COLUMN IF EXISTS anticheat_flags_count,
DROP COLUMN IF EXISTS is_bad_actor;

-- Drop indexes
DROP INDEX IF EXISTS idx_users_bad_actor;
DROP INDEX IF EXISTS idx_users_skill_score;
DROP INDEX IF EXISTS idx_users_fair_play_score;
