-- Gameplay telemetry linkage + retention (anti-cheat).
--
-- The recording itself never lives here: it is uploaded to S3/MinIO under the
-- `telemetry/` prefix and this table holds only the reference that makes it
-- findable, verifiable and eventually expirable. Keeping the document out of
-- PostgreSQL keeps the hot database small — a single ranked match can carry
-- tens of thousands of input samples.
--
-- `retained_until` is stamped per row at upload rather than computed at query
-- time, so a later change to the retention window does not retroactively
-- expire recordings written under the old one.

CREATE TABLE IF NOT EXISTS match_telemetry (
    id UUID PRIMARY KEY,
    match_id UUID NOT NULL,
    player_id UUID NOT NULL,
    -- S3/MinIO object key, namespaced `telemetry/{match}/{player}/{hash}.json`.
    object_key TEXT NOT NULL,
    -- SHA-256 hex digest of the stored bytes, so tampering is detectable.
    content_hash TEXT NOT NULL,
    byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
    event_count INTEGER NOT NULL CHECK (event_count > 0),
    schema_version INTEGER NOT NULL,
    max_suspicion_score SMALLINT NOT NULL
        CHECK (max_suspicion_score >= 0 AND max_suspicion_score <= 100),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Earliest instant the retention sweep may remove this recording.
    retained_until TIMESTAMPTZ NOT NULL,
    -- When the object was removed from storage; NULL while the recording lives.
    purged_at TIMESTAMPTZ,
    -- Re-sending identical bytes refreshes the existing row (and its retention
    -- clock) instead of creating a duplicate.
    UNIQUE (match_id, player_id, content_hash)
);

-- Serves the per-match and per-player metadata lookups.
CREATE INDEX IF NOT EXISTS idx_match_telemetry_match
    ON match_telemetry (match_id, player_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_match_telemetry_player
    ON match_telemetry (player_id, uploaded_at DESC);

-- Drives the retention sweep: `WHERE purged_at IS NULL AND retained_until <= $1
-- ORDER BY retained_until ASC LIMIT n`. Partial so already-purged rows (the
-- vast majority over time) never enter the index.
CREATE INDEX IF NOT EXISTS idx_match_telemetry_retention
    ON match_telemetry (retained_until)
    WHERE purged_at IS NULL;

COMMENT ON TABLE match_telemetry IS
    'Reference from a match to its gameplay telemetry recording in S3/MinIO (anti-cheat).';
COMMENT ON COLUMN match_telemetry.object_key IS
    'S3/MinIO key of the stored recording; the document itself is never held in PostgreSQL.';
COMMENT ON COLUMN match_telemetry.content_hash IS
    'SHA-256 hex digest of the stored bytes, so a re-download can be verified.';
COMMENT ON COLUMN match_telemetry.retained_until IS
    'Earliest instant the retention sweep may purge this recording.';
