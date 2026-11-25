-- Revert point-in-time staking snapshots (Issue #1524).

DROP TRIGGER IF EXISTS trg_staking_snapshots_immutable ON staking_snapshots;
DROP FUNCTION IF EXISTS staking_snapshots_reject_mutation();
DROP TABLE IF EXISTS staking_snapshots;
