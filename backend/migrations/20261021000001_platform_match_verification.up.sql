-- Platform match verification support (console score reports)
-- Adds a "pending_verification" status and tracking columns for the async
-- server-to-server verification flow against the game platform API.

-- Track platform verification lifecycle on the matches table.
ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS platform_verification_status TEXT NOT NULL DEFAULT 'not_required',
    ADD COLUMN IF NOT EXISTS platform_verification_requested_at TIMESTAMPT WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS platform_verified_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS platform_verification_reason TEXT,
    ADD COLUMN IF NOT EXISTS platform_reported_winner_id UUID,
    ADD COLUMN IF NOT EXISTS platform_reported_player1_score INTEGER,
    ADD COLUMN IF NOT EXISTS platform_reported_player2_score INTEGER;

-- Queue of pending platform verification requests that the background
-- worker will process and reconcile against the platform API.
CREATE TABLE IF NOT EXISTS platform_verification_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    platform_match_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULS DEFAULT 0,
    last_error TEXT,
    response_payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_platform_verification_requests_match_id
    ON platform_verification_requests (match_id);

CREATE INDEX IF NOT EXISTS idx_platform_verification_requests_status
    ON platform_verification_requests (status);
