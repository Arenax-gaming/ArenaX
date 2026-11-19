//! Composable reward hooks (#1557).
//!
//! `ComposableExample` can notify up to [`MAX_REWARD_HOOKS`] registered hook
//! contracts, in registration order, whenever a reward is issued through
//! [`crate::ComposableExample::issue_reward`]. Hook calls are plain
//! cross-contract calls: if a hook panics (returns an error), the whole
//! reward issuance aborts and every storage write made in that invocation
//! -- including by hooks that ran before the failing one -- is rolled back
//! atomically, so the chain either fully succeeds or fully reverts. An
//! empty hook list simply issues the reward with no hooks called.

use soroban_sdk::{contractclient, contractevent, Address, Env, String};

/// Maximum number of reward hook contracts that may be registered at once.
pub const MAX_REWARD_HOOKS: u32 = 5;

/// Interface every reward hook contract implements.
#[contractclient(name = "RewardHookClient")]
pub trait RewardHook {
    /// Called after `amount` has been awarded to `recipient`. `context`
    /// is an opaque, human-readable reason for the reward (e.g. which
    /// tournament or event triggered it).
    fn on_reward(env: Env, recipient: Address, amount: i128, context: String);
}

/// Emitted after a reward has been issued and every registered hook has
/// been called successfully, recording how many hooks ran.
#[contractevent(topics = ["ComposableExample", "HOOKS_EXEC"])]
pub struct HooksExecuted {
    pub recipient: Address,
    pub amount: i128,
    pub count: u32,
}

pub fn emit_hooks_executed(env: &Env, recipient: &Address, amount: i128, count: u32) {
    HooksExecuted {
        recipient: recipient.clone(),
        amount,
        count,
    }
    .publish(env);
}
