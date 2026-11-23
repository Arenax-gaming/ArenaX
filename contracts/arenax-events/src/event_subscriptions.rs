//! Event subscription domain (issue #1111 / topic-filters).
//!
//! Emitted by the `event-manager` contract to record topic subscription
//! lifecycle changes across the ecosystem:
//!
//! - [`Subscribed`] — an address registered a callback for a topic.
//! - [`Unsubscribed`] — a subscription was revoked.
//! - [`EventDispatched`] — a dispatch pass over a topic's subscribers ran,
//!   reporting how many callbacks were delivered successfully.
//! - [`FilterAdded`] — a subscriber attached one or more topic filters to an
//!   existing subscription, narrowing the events that will trigger their
//!   callback.
//! - [`FilterRemoved`] — a subscriber cleared all topic filters from an
//!   existing subscription, restoring the all-events (wildcard) behaviour.

use soroban_sdk::{contractevent, Address, Env, Symbol, Vec};

pub const NAMESPACE: &str = "ArenaXEventSubscriptions";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXES_v1", "SUBSCRIBED"])]
pub struct Subscribed {
    pub subscriber: Address,
    pub topic: Symbol,
    pub callback_contract: Address,
    pub callback_function: Symbol,
    pub timestamp: u64,
}

#[contractevent(topics = ["ArenaXES_v1", "UNSUBSCRIBED"])]
pub struct Unsubscribed {
    pub subscriber: Address,
    pub topic: Symbol,
    pub timestamp: u64,
}

#[contractevent(topics = ["ArenaXES_v1", "DISPATCHED"])]
pub struct EventDispatched {
    pub topic: Symbol,
    pub event_id: u64,
    pub delivered: u32,
    pub total: u32,
    pub timestamp: u64,
}

pub fn emit_subscribed(
    env: &Env,
    subscriber: &Address,
    topic: &Symbol,
    callback_contract: &Address,
    callback_function: &Symbol,
    timestamp: u64,
) {
    Subscribed {
        subscriber: subscriber.clone(),
        topic: topic.clone(),
        callback_contract: callback_contract.clone(),
        callback_function: callback_function.clone(),
        timestamp,
    }
    .publish(env);
}

pub fn emit_unsubscribed(env: &Env, subscriber: &Address, topic: &Symbol, timestamp: u64) {
    Unsubscribed {
        subscriber: subscriber.clone(),
        topic: topic.clone(),
        timestamp,
    }
    .publish(env);
}

pub fn emit_event_dispatched(
    env: &Env,
    topic: &Symbol,
    event_id: u64,
    delivered: u32,
    total: u32,
    timestamp: u64,
) {
    EventDispatched {
        topic: topic.clone(),
        event_id,
        delivered,
        total,
        timestamp,
    }
    .publish(env);
}

// ─── Topic filter lifecycle (topic-filters feature) ──────────────────────────

/// Emitted when a subscriber attaches one or more topic filters to their
/// subscription.  An empty `filters` list is never emitted here — that case
/// is represented by [`FilterRemoved`].
#[contractevent(topics = ["ArenaXES_v1", "FILTER_ADDED"])]
pub struct FilterAdded {
    /// The subscribing address whose filter set was updated.
    pub subscriber: Address,
    /// The subscription topic the filters apply to.
    pub subscription_topic: Symbol,
    /// The new, complete list of accepted topic filters after this update.
    /// Only events whose topic appears in this list will invoke the callback.
    pub filters: Vec<Symbol>,
    pub timestamp: u64,
}

/// Emitted when a subscriber removes all topic filters from their subscription,
/// restoring the wildcard (all-events) behaviour.
#[contractevent(topics = ["ArenaXES_v1", "FILTER_REMOVED"])]
pub struct FilterRemoved {
    pub subscriber: Address,
    pub subscription_topic: Symbol,
    pub timestamp: u64,
}

/// Emit a [`FilterAdded`] event.
pub fn emit_filter_added(
    env: &Env,
    subscriber: &Address,
    subscription_topic: &Symbol,
    filters: &Vec<Symbol>,
    timestamp: u64,
) {
    FilterAdded {
        subscriber: subscriber.clone(),
        subscription_topic: subscription_topic.clone(),
        filters: filters.clone(),
        timestamp,
    }
    .publish(env);
}

/// Emit a [`FilterRemoved`] event.
pub fn emit_filter_removed(
    env: &Env,
    subscriber: &Address,
    subscription_topic: &Symbol,
    timestamp: u64,
) {
    FilterRemoved {
        subscriber: subscriber.clone(),
        subscription_topic: subscription_topic.clone(),
        timestamp,
    }
    .publish(env);
}
