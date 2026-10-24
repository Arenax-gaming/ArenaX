-- Reverse the platform match verification migration.

DROP TABLE IF EXISTS platform_verification_requests;

ALTER TABLE matches
    DROP COLUMN IF EXISTS platform_reported_player2_score,
    DROP COLUMN IF EXISTS platform_reported_player1_score,
    DROP COLUMN IF EXISTS platform_reported_winner_id,
    DROP COLUMN IF EXISTS platform_verification_reason,
    DROP COLUMN IF EXISTS platform_verified_at,
    DROP COLUMN IF EXISTS platform_verification_requested_at,
    DROP COLUMN IF EXISTS platform_verification_status;
