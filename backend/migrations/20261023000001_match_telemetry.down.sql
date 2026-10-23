-- Revert the gameplay telemetry linkage (anti-cheat).
--
-- Dropping the table leaves the already-uploaded objects in the bucket with
-- nothing pointing at them; a bucket lifecycle rule on the `telemetry/` prefix
-- is what reclaims those.

DROP INDEX IF EXISTS idx_match_telemetry_retention;
DROP INDEX IF EXISTS idx_match_telemetry_player;
DROP INDEX IF EXISTS idx_match_telemetry_match;

DROP TABLE IF EXISTS match_telemetry;
