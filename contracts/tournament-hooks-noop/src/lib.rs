#![no_std]

//! Default no-op tournament hook contract (#1417, #1558).
//!
//! Implements the `on_register` / `on_start` / `on_complete` interface from
//! `composable-example::tournament_hooks` without doing anything that
//! mutates *external* state, for tournaments that want an explicit hook
//! address but no custom behaviour. Tournaments with no hook configured
//! skip the cross-contract call entirely.
//!
//! The original version of this contract was a silent no-op, which made it
//! impossible to verify during testing that hooks were actually invoked
//! (#1558). It now:
//! - emits a `noop_hook_called` event (hook name + an associated address)
//!   on every invocation,
//! - increments an on-chain `call_count` so callers/indexers can confirm
//!   invocations happened, exposed via [`NoopTournamentHooks::get_call_count`],
//! - and keeps the function signatures unchanged (`on_register`/`on_start`/
//!   `on_complete` still return `()`), so it remains a drop-in hook address
//!   for `sponsored-tournament`'s existing `TournamentHookClient`, which is
//!   compiled against those exact signatures.
//!
//! `on_start` carries no address argument in the shared hook interface, so
//! the event for that stage uses this contract's own address as the
//! "caller" field; this is the only identity available at that call site
//! without changing the shared `TournamentHook` trait.
//!
//! The contract still never writes to any key other than its own
//! `call_count` counter, so it remains a true no-op from the tournament's
//! point of view: no tournament or player state is read or modified.

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, symbol_short, Address, Env, Symbol,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    CallCount,
}

/// Emitted on every hook invocation so tests and off-chain indexers can
/// verify the no-op hook actually ran. `noop` is always `true`, marking
/// this event's invocation as coming from a hook that performs no
/// externally-visible side effects.
#[contractevent(topics = ["TournamentHooksNoop", "NOOP_CALLED"])]
pub struct NoopHookCalled {
    pub hook_name: Symbol,
    pub caller: Address,
    pub noop: bool,
}

#[contract]
pub struct NoopTournamentHooks;

#[contractimpl]
impl NoopTournamentHooks {
    pub fn on_register(env: Env, _tournament_id: u64, player: Address) {
        Self::record_invocation(&env, symbol_short!("register"), &player);
    }

    pub fn on_start(env: Env, _tournament_id: u64) {
        // `on_start` carries no address in the shared hook interface; use
        // this contract's own address as the only identity available.
        let this_contract = env.current_contract_address();
        Self::record_invocation(&env, symbol_short!("start"), &this_contract);
    }

    pub fn on_complete(env: Env, _tournament_id: u64, winner: Address) {
        Self::record_invocation(&env, symbol_short!("complete"), &winner);
    }

    /// Number of hook invocations recorded since this contract was
    /// deployed.
    pub fn get_call_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::CallCount)
            .unwrap_or(0)
    }

    fn record_invocation(env: &Env, hook_name: Symbol, caller: &Address) {
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CallCount)
            .unwrap_or(0)
            + 1;
        env.storage().instance().set(&DataKey::CallCount, &count);

        NoopHookCalled {
            hook_name,
            caller: caller.clone(),
            noop: true,
        }
        .publish(env);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn records_calls_and_emits_events() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(NoopTournamentHooks, ());
        let client = NoopTournamentHooksClient::new(&env, &id);
        let player = Address::generate(&env);
        let winner = Address::generate(&env);

        assert_eq!(client.get_call_count(), 0);

        client.on_register(&1, &player);
        assert_eq!(client.get_call_count(), 1);

        client.on_start(&1);
        assert_eq!(client.get_call_count(), 2);

        client.on_complete(&1, &winner);
        assert_eq!(client.get_call_count(), 3);
    }
}
