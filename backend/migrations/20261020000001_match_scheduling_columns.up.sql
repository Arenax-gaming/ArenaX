-- The Match model carries tournament scheduling fields that were never
-- added to the matches table.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS round_number INTEGER;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_number INTEGER;
