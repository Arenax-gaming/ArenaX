-- Anti-cheat microservice findings (Issue #1281).
--
-- One row per analysis produced by the screenshot or telemetry pipeline. A
-- finding is "flagged" when its score crosses the anti-cheat alert threshold;
-- flagged findings are additionally anchored to Stellar and the resulting
-- transaction hash is stored here for traceability.

CREATE TABLE IF NOT EXISTS anticheat_findings (
    id UUID PRIMARY KEY,
    match_id UUID NOT NULL,
    player_id UUID NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('screenshot', 'telemetry')),
    score SMALLINT NOT NULL CHECK (score >= 0 AND score <= 100),
    flagged BOOLEAN NOT NULL DEFAULT FALSE,
    -- JSON array of human-readable reasons, stored as text so the table does
    -- not depend on a JSONB extension.
    reasons TEXT NOT NULL DEFAULT '[]',
    evidence_key TEXT,
    evidence_hash TEXT,
    transaction_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anticheat_findings_match
    ON anticheat_findings (match_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_anticheat_findings_player
    ON anticheat_findings (player_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_anticheat_findings_flagged
    ON anticheat_findings (flagged, created_at DESC)
    WHERE flagged;
