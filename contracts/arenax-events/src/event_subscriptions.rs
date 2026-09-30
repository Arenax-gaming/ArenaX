//! Event subscription domain (issue #1111).
//!
//! Emitted by the `event-manager` contract to record topic subscription
//! lifecycle changes across the ecosystem:
//!
//! - [`Subscribed`] — an address registered a callback for a topic.
//! - [`Unsubscribed`] — a subscription was revoked.
//! - [`EventDispatched`] — a dispatch pass over a topic's subscribers ran,
//!   reporting how many callbacks were delivered successfully.

use soroban_sdk::{contractevent, Address, Env, Symbol};

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