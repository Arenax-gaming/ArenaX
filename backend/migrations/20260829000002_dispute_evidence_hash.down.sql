-- Drop tamper-evident dispute evidence storage (#1081)

ALTER TABLE match_disputes
    DROP COLUMN IF EXISTS evidence_s3_key,
    DROP COLUMN IF EXISTS evidence_hash;
