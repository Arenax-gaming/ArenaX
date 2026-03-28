-- ArenaX Reputation System Migration
-- Migration: 20260325000001_reputation_system
-- Description: Adds reputation tracking fields and anti-cheat flags integration

-- Add reputation tracking columns to users table (if not already present)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS skill_score INTEGER DEFAULT 1000,
ADD COLUMN IF NOT EXISTS fair_play_score INTEGER DEFAULT 100,
ADD COLUMN IF NOT EXISTS reputation_last_updated TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS anticheat_flags_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_bad_actor BOOLEAN DEFAULT FALSE;

-- Create index for bad actor filtering
CREATE INDEX IF NOT EXISTS idx_users_bad_actor ON users(is_bad_actor) WHERE is_bad_actor = TRUE;
CREATE INDEX IF NOT EXISTS idx_users_skill_score ON users(skill_score DESC);
CREATE INDEX IF NOT EXISTS idx_users_fair_play_score ON users(fair_play_score DESC);

-- Create table to track on-chain reputation events
CREATE TABLE IF NOT EXISTS reputation_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL, -- match_completion, decay, anticheat_penalty
    skill_delta INTEGER NOT NULL DEFAULT 0,
    fair_play_delta INTEGER NOT NULL DEFAULT 0,
    match_id UUID REFERENCES matches(id) ON DELETE SET NULL,
    transaction_hash VARCHAR(64), -- Soroban transaction hash
    metadata TEXT, -- JSON
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reputation_events_user ON reputation_events(user_id);
CREATE INDEX IF NOT EXISTS idx_reputation_events_match ON reputation_events(match_id);
CREATE INDEX IF NOT EXISTS idx_reputation_events_type ON reputation_events(event_type);
CREATE INDEX IF NOT EXISTS idx_reputation_events_created ON reputation_events(created_at DESC);

-- Create table to store Soroban contract addresses
CREATE TABLE IF NOT EXISTS soroban_contracts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_name VARCHAR(100) UNIQUE NOT NULL,
    contract_address VARCHAR(56) NOT NULL,
    network VARCHAR(50) NOT NULL, -- testnet, mainnet
    is_active BOOLEAN DEFAULT TRUE,
    deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO soroban_contracts (contract_name, contract_address, network) VALUES
('reputation_index', COALESCE(current_setting('app.soroban_reputation_contract', true), 'CDZ...REPUTATION_CONTRACT_ADDRESS'), 'testnet'),
('anti_cheat_oracle', COALESCE(current_setting('app.soroban_anticheat_oracle', true), 'CDZ...ANTICHEAT_ORACLE_ADDRESS'), 'testnet')
ON CONFLICT (contract_name) DO UPDATE SET 
    updated_at = NOW();

-- Add comments for documentation
COMMENT ON COLUMN users.skill_score IS 'On-chain skill reputation score from Soroban contract';
COMMENT ON COLUMN users.fair_play_score IS 'On-chain fair play reputation score from Soroban contract';
COMMENT ON COLUMN users.anticheat_flags_count IS 'Total number of anti-cheat flags received';
COMMENT ON COLUMN users.is_bad_actor IS 'Flag indicating player should be filtered from matchmaking';
COMMENT ON TABLE reputation_events IS 'Audit trail of reputation changes from on-chain events';
COMMENT ON TABLE soroban_contracts IS 'Registry of deployed Soroban smart contracts';
