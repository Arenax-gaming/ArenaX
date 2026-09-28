-- Tamper-evident dispute evidence storage (#1081)

ALTER TABLE match_disputes
    ADD COLUMN IF NOT EXISTS evidence_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS evidence_s3_key TEXT;
