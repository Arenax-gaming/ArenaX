-- ============================================================
-- Migration: staking, cross-game assets, analytics, security
-- ============================================================

-- ── Staking ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staking_positions (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id              UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    stellar_address      VARCHAR(56) NOT NULL,
    staked_amount        BIGINT NOT NULL DEFAULT 0,
    pending_rewards      BIGINT NOT NULL DEFAULT 0,
    tier                 VARCHAR(20) NOT NULL DEFAULT 'None',
    governance_weight    BIGINT NOT NULL DEFAULT 0,
    staked_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_reward_snapshot TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staking_tier ON staking_positions(tier);
CREATE INDEX IF NOT EXISTS idx_staking_amount ON staking_positions(staked_amount DESC);

CREATE TABLE IF NOT EXISTS staking_events (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL, -- stake, unstake, claim_rewards, slash
    amount     BIGINT NOT NULL DEFAULT 0,
    tx_hash    VARCHAR(64),
    metadata   JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staking_events_user ON staking_events(user_id);
CREATE INDEX IF NOT EXISTS idx_staking_events_type ON staking_events(event_type);
CREATE INDEX IF NOT EXISTS idx_staking_events_created ON staking_events(created_at DESC);

-- ── Cross-Game Assets ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_definitions (
    asset_id          VARCHAR(64) PRIMARY KEY, -- hex-encoded BytesN<32>
    kind              SMALLINT NOT NULL,        -- 0=NFT,1=Currency,2=Achievement,3=Cosmetic
    rarity            SMALLINT NOT NULL,
    name              VARCHAR(100) NOT NULL,
    compatible_games  BIGINT NOT NULL DEFAULT 0, -- bitmask
    max_supply        BIGINT NOT NULL DEFAULT 0,
    current_supply    BIGINT NOT NULL DEFAULT 0,
    is_transferable   BOOLEAN NOT NULL DEFAULT TRUE,
    is_tradeable      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_balances (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_id        VARCHAR(64) NOT NULL REFERENCES asset_definitions(asset_id),
    amount          BIGINT NOT NULL DEFAULT 0,
    nft_serial      BIGINT,
    source_game_id  INT NOT NULL DEFAULT 0,
    acquired_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_balances_owner ON asset_balances(owner_id);
CREATE INDEX IF NOT EXISTS idx_asset_balances_asset ON asset_balances(asset_id);

CREATE TABLE IF NOT EXISTS asset_transfers (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    to_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    asset_id       VARCHAR(64) NOT NULL,
    amount         BIGINT NOT NULL,
    from_game_id   INT NOT NULL DEFAULT 0,
    to_game_id     INT NOT NULL DEFAULT 0,
    tx_hash        VARCHAR(64),
    transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_transfers_from ON asset_transfers(from_user_id);
CREATE INDEX IF NOT EXISTS idx_asset_transfers_to   ON asset_transfers(to_user_id);
CREATE INDEX IF NOT EXISTS idx_asset_transfers_ts   ON asset_transfers(transferred_at DESC);

-- ── Analytics ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS analytics_game_metrics (
    game_id                  INT PRIMARY KEY,
    total_matches            BIGINT NOT NULL DEFAULT 0,
    total_players            BIGINT NOT NULL DEFAULT 0,
    total_wagered            BIGINT NOT NULL DEFAULT 0,
    total_rewards_paid       BIGINT NOT NULL DEFAULT 0,
    avg_match_duration_secs  BIGINT NOT NULL DEFAULT 0,
    last_updated             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_platform (
    id                     INT PRIMARY KEY DEFAULT 1,
    total_matches_all_time BIGINT NOT NULL DEFAULT 0,
    active_players_30d     BIGINT NOT NULL DEFAULT 0,
    total_staked           BIGINT NOT NULL DEFAULT 0,
    total_volume           BIGINT NOT NULL DEFAULT 0,
    last_updated           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO analytics_platform (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Privacy-safe player behaviour (no PII beyond user_id which is internal)
CREATE TABLE IF NOT EXISTS analytics_player_behaviour (
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id          INT NOT NULL,
    matches_played   BIGINT NOT NULL DEFAULT 0,
    wins             BIGINT NOT NULL DEFAULT 0,
    avg_session_secs BIGINT NOT NULL DEFAULT 0,
    last_active      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_analytics_player_game ON analytics_player_behaviour(game_id);
CREATE INDEX IF NOT EXISTS idx_analytics_player_active ON analytics_player_behaviour(last_active DESC);

-- ── Security audit log ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS security_audit_log (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip           INET,
    method       VARCHAR(10),
    path         TEXT,
    status       SMALLINT,
    user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    latency_ms   INT,
    blocked      BOOLEAN NOT NULL DEFAULT FALSE,
    rate_limited BOOLEAN NOT NULL DEFAULT FALSE,
    metadata     JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_ts     ON security_audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_ip     ON security_audit_log(ip);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON security_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_status ON security_audit_log(status);

-- ── Comments ──────────────────────────────────────────────────

COMMENT ON TABLE staking_positions       IS 'Mirror of on-chain staking positions for fast queries';
COMMENT ON TABLE asset_definitions       IS 'Cross-game asset type registry';
COMMENT ON TABLE asset_balances          IS 'Per-user cross-game asset holdings';
COMMENT ON TABLE analytics_game_metrics  IS 'Aggregated per-game analytics';
COMMENT ON TABLE analytics_platform      IS 'Platform-wide aggregated metrics';
COMMENT ON TABLE analytics_player_behaviour IS 'Privacy-safe per-player behaviour data';
COMMENT ON TABLE security_audit_log      IS 'Immutable audit trail of all mutating API calls';
