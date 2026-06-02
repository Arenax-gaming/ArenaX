DROP TABLE IF EXISTS prize_distribution_failures;

ALTER TABLE tournament_participants
    DROP COLUMN IF EXISTS prize_tx_hash;
