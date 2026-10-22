-- Add IPFS CID support for tamper-evident dispute evidence (#1423)
ALTER TABLE dispute_evidence
    ADD COLUMN IF NOT EXISTS ipfs_cid VARCHAR(255);

ALTER TABLE match_disputes
    ADD COLUMN IF NOT EXISTS ipfs_cid VARCHAR(255);
