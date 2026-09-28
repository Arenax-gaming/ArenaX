-- Player suspension/restriction system (Issue #906)
-- and email notification preferences (Issue #905).

-- ============================================================================
-- PLAYER SUSPENSIONS
-- ============================================================================
--
-- One row per enforcement action, never overwritten. An expired or lifted
-- suspension stays on the record so a moderator can see whether this is a
-- first offence.

CREATE TABLE player_suspensions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 'temporary' | 'permanent'
    kind VARCHAR(16) NOT NULL,
    -- 'all_access' | 'competition' | 'social' | 'financial'
    scope VARCHAR(20) NOT NULL,
    reason TEXT NOT NULL,

    -- NULL for automated enforcement.
    issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- NULL means permanent. Expiry is evaluated at read time, not by a sweeper
    -- job, so a backed-up job can never hold a player past their sentence.
    expires_at TIMESTAMPTZ,

    lifted_at TIMESTAMPTZ,
    lifted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    lift_reason TEXT,

    -- 'none' | 'pending' | 'accepted' | 'rejected'
    appeal_status VARCHAR(16) NOT NULL DEFAULT 'none',
    appeal_text TEXT,
    appeal_submitted_at TIMESTAMPTZ,
    appeal_reviewed_at TIMESTAMPTZ,
    appeal_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    appeal_response TEXT,

    CONSTRAINT player_suspensions_kind_check
        CHECK (kind IN ('temporary', 'permanent')),
    CONSTRAINT player_suspensions_scope_check
        CHECK (scope IN ('all_access', 'competition', 'social', 'financial')),
    CONSTRAINT player_suspensions_appeal_status_check
        CHECK (appeal_status IN ('none', 'pending', 'accepted', 'rejected')),
    -- A permanent ban with an expiry is a contradiction that would quietly
    -- lapse; reject it at the schema rather than debugging it later.
    CONSTRAINT player_suspensions_permanent_has_no_expiry
        CHECK (kind <> 'permanent' OR expires_at IS NULL),
    CONSTRAINT player_suspensions_temporary_has_expiry
        CHECK (kind <> 'temporary' OR expires_at IS NOT NULL)
);

-- The hot path is "is this player restricted right now", run on every gated
-- action. Partial index so it only covers rows that could still be active.
CREATE INDEX idx_player_suspensions_active
    ON player_suspensions(user_id)
    WHERE lifted_at IS NULL AND appeal_status <> 'accepted';

CREATE INDEX idx_player_suspensions_user_history
    ON player_suspensions(user_id, issued_at DESC);

-- Moderator queue: oldest pending appeal first.
CREATE INDEX idx_player_suspensions_pending_appeals
    ON player_suspensions(appeal_submitted_at ASC)
    WHERE appeal_status = 'pending';

-- ============================================================================
-- EMAIL NOTIFICATIONS
-- ============================================================================

-- Per-category opt-out (Issue #905). A row exists only once a player changes
-- something; absence means "subscribed", so the default does not need a
-- backfill across every existing user.
CREATE TABLE email_preferences (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 'tournament_registration' | 'match_result' | 'achievement' |
    -- 'weekly_digest' | 'account_security'
    category VARCHAR(40) NOT NULL,
    subscribed BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, category)
);

-- Unsubscribe links carry a token rather than a user id, so a guessed or
-- shared link cannot be used to unsubscribe somebody else.
CREATE TABLE email_unsubscribe_tokens (
    token VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- NULL unsubscribes from everything.
    category VARCHAR(40),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    used_at TIMESTAMPTZ
);

CREATE INDEX idx_email_unsubscribe_tokens_user
    ON email_unsubscribe_tokens(user_id);

-- Delivery log. Doubles as the idempotency record: a unique dedupe key stops
-- a retried job from emailing a player the same match result twice.
CREATE TABLE email_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(40) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    subject TEXT NOT NULL,
    dedupe_key VARCHAR(200),
    -- 'queued' | 'sent' | 'failed' | 'skipped'
    status VARCHAR(16) NOT NULL DEFAULT 'queued',
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,

    CONSTRAINT email_deliveries_status_check
        CHECK (status IN ('queued', 'sent', 'failed', 'skipped'))
);

CREATE UNIQUE INDEX idx_email_deliveries_dedupe
    ON email_deliveries(dedupe_key)
    WHERE dedupe_key IS NOT NULL;

CREATE INDEX idx_email_deliveries_user
    ON email_deliveries(user_id, created_at DESC);
