//! Composable tournament lifecycle hooks (#1417).
//!
//! A tournament contract (e.g. `sponsored-tournament`) invokes a hook
//! contract at each lifecycle milestone. Hook calls are ordinary Soroban
//! cross-contract calls, so if a hook panics the whole parent invocation
//! fails and every storage write made by the tournament in that call is
//! rolled back atomically.

use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Vec,
};

/// Interface every tournament hook contract implements.
#[contractclient(name = "TournamentHookClient")]
pub trait TournamentHook {
    /// Called after a player is registered for a tournament.
    fn on_register(env: Env, tournament_id: u64, player: Address);
    /// Called after a tournament transitions to started.
    fn on_start(env: Env, tournament_id: u64);
    /// Called after a tournament completes with a winner.
    fn on_complete(env: Env, tournament_id: u64, winner: Address);
}

pub const STAGE_REGISTER: Symbol = symbol_short!("register");
pub const STAGE_START: Symbol = symbol_short!("start");
pub const STAGE_COMPLETE: Symbol = symbol_short!("complete");

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum HookKey {
    Owner,
    /// Tournament contract allowed to drive this hook. Unbound hooks accept
    /// any caller.
    Tournament,
    /// Maximum registrations per tournament (0 = unlimited).
    MaxParticipants,
    Registered(u64),
    Log(u64),
}

/// Example hook contract: records the order of lifecycle callbacks per
/// tournament and enforces an optional registration limit. Exceeding the
/// limit panics, which reverts the parent `register_player` call.
#[contract]
pub struct ComposableTournamentHooks;

#[contractimpl]
impl ComposableTournamentHooks {
    pub fn hook_initialize(env: Env, owner: Address, tournament: Address) {
        if env.storage().instance().has(&HookKey::Owner) {
            panic!("already initialized");
        }
        owner.require_auth();
        env.storage().instance().set(&HookKey::Owner, &owner);
        env.storage()
            .instance()
            .set(&HookKey::Tournament, &tournament);
        env.storage()
            .instance()
            .set(&HookKey::MaxParticipants, &0u32);
    }

    pub fn hook_set_max_participants(env: Env, max_participants: u32) {
        let owner: Address = env
            .storage()
            .instance()
            .get(&HookKey::Owner)
            .expect("not initialized");
        owner.require_auth();
        env.storage()
            .instance()
            .set(&HookKey::MaxParticipants, &max_participants);
    }

    pub fn hook_log(env: Env, tournament_id: u64) -> Vec<Symbol> {
        env.storage()
            .persistent()
            .get(&HookKey::Log(tournament_id))
            .unwrap_or(Vec::new(&env))
    }

    pub fn hook_registered(env: Env, tournament_id: u64) -> u32 {
        env.storage()
            .persistent()
            .get(&HookKey::Registered(tournament_id))
            .unwrap_or(0)
    }

    fn require_tournament(env: &Env) {
        if let Some(tournament) = env
            .storage()
            .instance()
            .get::<HookKey, Address>(&HookKey::Tournament)
        {
            tournament.require_auth();
        }
    }

    fn append_log(env: &Env, tournament_id: u64, stage: Symbol) {
        let key = HookKey::Log(tournament_id);
        let mut log: Vec<Symbol> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        log.push_back(stage);
        env.storage().persistent().set(&key, &log);
    }
}

#[contractimpl]
impl TournamentHook for ComposableTournamentHooks {
    fn on_register(env: Env, tournament_id: u64, _player: Address) {
        Self::require_tournament(&env);

        let key = HookKey::Registered(tournament_id);
        let count: u32 = env.storage().persistent().get(&key).unwrap_or(0) + 1;
        let max: u32 = env
            .storage()
            .instance()
            .get(&HookKey::MaxParticipants)
            .unwrap_or(0);
        if max > 0 && count > max {
            panic!("registration full");
        }
        env.storage().persistent().set(&key, &count);

        Self::append_log(&env, tournament_id, STAGE_REGISTER);
    }

    fn on_start(env: Env, tournament_id: u64) {
        Self::require_tournament(&env);
        Self::append_log(&env, tournament_id, STAGE_START);
    }

    fn on_complete(env: Env, tournament_id: u64, _winner: Address) {
        Self::require_tournament(&env);
        Self::append_log(&env, tournament_id, STAGE_COMPLETE);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, vec};

    #[test]
    fn records_callbacks_in_order() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(ComposableTournamentHooks, ());
        let hooks = ComposableTournamentHooksClient::new(&env, &id);
        let owner = Address::generate(&env);
        let tournament = Address::generate(&env);
        let player = Address::generate(&env);
        hooks.hook_initialize(&owner, &tournament);

        let iface = TournamentHookClient::new(&env, &id);
        iface.on_register(&1, &player);
        iface.on_start(&1);
        iface.on_complete(&1, &player);

        assert_eq!(
            hooks.hook_log(&1),
            vec![&env, STAGE_REGISTER, STAGE_START, STAGE_COMPLETE]
        );
        assert_eq!(hooks.hook_registered(&1), 1);
    }

    #[test]
    #[should_panic(expected = "registration full")]
    fn enforces_max_participants() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(ComposableTournamentHooks, ());
        let hooks = ComposableTournamentHooksClient::new(&env, &id);
        hooks.hook_initialize(&Address::generate(&env), &Address::generate(&env));
        hooks.hook_set_max_participants(&1);

        let iface = TournamentHookClient::new(&env, &id);
        iface.on_register(&1, &Address::generate(&env));
        iface.on_register(&1, &Address::generate(&env));
    }
}
