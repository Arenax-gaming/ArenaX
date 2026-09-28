-- Push notification service (#908): FCM device registrations, delivery
-- tracking, and the in-app `notifications` table used as a fallback when a
-- push send has no active device or fails outright.
--
-- `notifications` is created here because nothing else in the migration
-- history does: `notification_handler.rs` has queried it since it was
-- written, but no prior migration ever defined it (pre-existing gap,
-- unrelated to this feature, discovered while wiring the fallback path).
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL DEFAULT 'info',
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    link TEXT,
    link_label VARCHAR(100),
    read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE read = FALSE;

-- A user's registered push-capable devices, each subscribed to zero or more
-- topics (e.g. "tournament:{id}", "match:{id}") for topic fan-out alongside
-- direct per-token sends.
CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_token TEXT NOT NULL,
    platform VARCHAR(20) NOT NULL DEFAULT 'unknown', -- ios | android | web | unknown
    topics TEXT[] NOT NULL DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_delivered_at TIMESTAMPTZ,
    UNIQUE (device_token)
);

CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id) WHERE active = TRUE;

-- Per-attempt delivery log, for the delivery-tracking acceptance criterion:
-- one row per (subscription, send), recording whether FCM accepted it.
CREATE TABLE push_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES push_subscriptions(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    status VARCHAR(20) NOT NULL, -- sent | failed | fallback
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_push_deliveries_user ON push_deliveries(user_id);
