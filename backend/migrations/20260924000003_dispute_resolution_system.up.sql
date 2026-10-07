-- Comprehensive dispute resolution system (Issue #909)
--
-- A standalone dispute module: any user-facing disagreement (a match result,
-- a payment, an account action, or anything else) can be filed as a ticket,
-- escalated through support tiers, resolved with a permanent history of every
-- step, and backed by uploaded evidence. It is intentionally independent of
-- the existing `match_disputes` table (created in the core migration) rather
-- than extending it: that table and the service code around it
-- (match_service.rs) have unrelated, pre-existing schema drift (columns the
-- Rust model expects that the table doesn't have) that is out of scope here,
-- and a new admin-facing ticket system has needs (escalation, structured
-- evidence, an append-only history) that go well beyond a single dispute
-- reason/resolution pair.

-- ---------------------------------------------------------------------------
-- Ticket numbers
-- ---------------------------------------------------------------------------

-- A short, human-friendly ticket identifier ("DSP-000123") alongside the
-- UUID primary key -- what a support agent reads out over chat or email
-- instead of a UUID.
CREATE SEQUENCE dispute_ticket_seq START WITH 1;

-- ---------------------------------------------------------------------------
-- Disputes
-- ---------------------------------------------------------------------------

CREATE TABLE disputes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_number BIGINT NOT NULL DEFAULT nextval('dispute_ticket_seq'),

    opened_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Optional context link -- a dispute is not required to be about a match.
    match_id UUID REFERENCES matches(id) ON DELETE SET NULL,

    category VARCHAR(50) NOT NULL,
    subject VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,

    -- open -> under_review -> (escalated <-> under_review) -> resolved | rejected -> closed
    status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'under_review', 'escalated', 'resolved', 'rejected', 'closed')),

    -- 1 = front-line support, 2 = senior/moderator, 3 = admin/final say.
    escalation_level SMALLINT NOT NULL DEFAULT 1
        CHECK (escalation_level BETWEEN 1 AND 3),

    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,

    resolution TEXT,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_disputes_ticket_number ON disputes(ticket_number);
CREATE INDEX idx_disputes_opened_by ON disputes(opened_by);
CREATE INDEX idx_disputes_match_id ON disputes(match_id) WHERE match_id IS NOT NULL;
CREATE INDEX idx_disputes_status ON disputes(status);
CREATE INDEX idx_disputes_assigned_to ON disputes(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_disputes_created_at ON disputes(created_at DESC);

COMMENT ON TABLE disputes IS 'Dispute resolution tickets (Issue #909): ticketed, escalatable, with a full history and evidence trail.';
COMMENT ON COLUMN disputes.ticket_number IS 'Human-friendly sequential ticket ID, rendered as DSP-000123.';
COMMENT ON COLUMN disputes.escalation_level IS '1 = front-line support, 2 = senior/moderator, 3 = admin/final say.';

-- ---------------------------------------------------------------------------
-- Resolution history (append-only)
-- ---------------------------------------------------------------------------

-- Every state change a dispute goes through, so "who did what, and when" is
-- always reconstructable -- unlike a single mutable `resolution` column, a
-- row here is never updated or deleted once written.
CREATE TABLE dispute_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,

    action VARCHAR(30) NOT NULL
        CHECK (action IN (
            'opened', 'assigned', 'status_changed', 'escalated',
            'evidence_added', 'resolved', 'rejected', 'reopened', 'closed'
        )),

    from_status VARCHAR(20),
    to_status VARCHAR(20),
    from_escalation_level SMALLINT,
    to_escalation_level SMALLINT,

    note TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dispute_history_dispute ON dispute_history(dispute_id, created_at);

-- No UPDATE or DELETE: mirrors the audit_logs immutability rules
-- (Issue #863) so this history can't be quietly rewritten after the fact.
REVOKE UPDATE, DELETE ON dispute_history FROM PUBLIC;

COMMENT ON TABLE dispute_history IS 'Append-only resolution/escalation history for each dispute (Issue #909).';

-- ---------------------------------------------------------------------------
-- Evidence
-- ---------------------------------------------------------------------------

-- Records evidence *metadata* pointing at a file already stored wherever the
-- caller uploaded it (object storage, a CDN, etc.) -- the backend has no S3
-- client wired up yet (StorageConfig in config.rs is currently unused), so
-- this does not attempt to add binary file upload/storage handling in the
-- same PR. Once direct upload support exists, this table needs no changes:
-- `file_url` just starts pointing at that storage instead of wherever it
-- points today.
CREATE TABLE dispute_evidence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,

    file_url TEXT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    content_type VARCHAR(100),
    size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
    description TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dispute_evidence_dispute ON dispute_evidence(dispute_id, created_at);

COMMENT ON TABLE dispute_evidence IS 'Evidence attached to a dispute (Issue #909): metadata for a file uploaded elsewhere.';

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_disputes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_disputes_updated_at
    BEFORE UPDATE ON disputes
    FOR EACH ROW
    EXECUTE FUNCTION set_disputes_updated_at();