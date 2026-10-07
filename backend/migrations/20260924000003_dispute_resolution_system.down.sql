DROP TRIGGER IF EXISTS trg_disputes_updated_at ON disputes;
DROP FUNCTION IF EXISTS set_disputes_updated_at();

DROP TABLE IF EXISTS dispute_evidence CASCADE;
DROP TABLE IF EXISTS dispute_history CASCADE;
DROP TABLE IF EXISTS disputes CASCADE;

DROP SEQUENCE IF EXISTS dispute_ticket_seq;