-- Revert IPFS CID support for tamper-evident dispute evidence (#1423)
ALTER TABLE dispute_evidence
    DROP COLUMN IF EXISTS ipfs_cid;

ALTER TABLE match_disputes
    DROP COLUMN IF EXISTS ipfs_cid;
