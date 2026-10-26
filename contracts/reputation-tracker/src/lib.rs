#![no_std]

//! Reputation Tracker
//!
//! Tracks player reputation on-chain. A single admin (the ArenaX backend)
//! is allowed to increment or decrement a player's score; anyone can read it.
//! Scores are clamped to `[0, MAX_REPUTATION]`.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Symbol,
};

pub const INITIAL_REPUTATION: i128 = 100;
pub const MAX_REPUTATION: i128 = 1_000;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Reputation(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ReputationError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
}

const UPDATED: Symbol = symbol_short!("rep_upd");

#[contract]
pub struct ReputationTracker;

#[contractimpl]
impl ReputationTracker {
    pub fn initialize(env: Env, admin: Address) -> Result<(), ReputationError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ReputationError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    /// Current reputation of `player`; unknown players start at `INITIAL_REPUTATION`.
    pub fn get_reputation(env: Env, player: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Reputation(player))
            .unwrap_or(INITIAL_REPUTATION)
    }

    pub fn increment(
        env: Env,
        player: Address,
        amount: i128,
        reason: Symbol,
    ) -> Result<i128, ReputationError> {
        Self::apply(&env, player, amount, reason)
    }

    pub fn decrement(
        env: Env,
        player: Address,
        amount: i128,
        reason: Symbol,
    ) -> Result<i128, ReputationError> {
        Self::apply(&env, player, -amount, reason)
    }

    fn apply(
        env: &Env,
        player: Address,
        delta: i128,
        reason: Symbol,
    ) -> Result<i128, ReputationError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ReputationError::NotInitialized)?;
        admin.require_auth();

        if delta == 0 || delta.unsigned_abs() > MAX_REPUTATION as u128 {
            return Err(ReputationError::InvalidAmount);
        }

        let current = Self::get_reputation(env.clone(), player.clone());
        let updated = (current + delta).clamp(0, MAX_REPUTATION);
        env.storage()
            .persistent()
            .set(&DataKey::Reputation(player.clone()), &updated);

        env.events()
            .publish((UPDATED, player), (reason, delta, updated));
        Ok(updated)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup() -> (Env, ReputationTrackerClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(ReputationTracker, ());
        let client = ReputationTrackerClient::new(&env, &id);
        client.initialize(&Address::generate(&env));
        (env, client)
    }

    #[test]
    fn increment_and_decrement_are_clamped() {
        let (env, client) = setup();
        let player = Address::generate(&env);
        assert_eq!(client.get_reputation(&player), INITIAL_REPUTATION);
        assert_eq!(client.increment(&player, &5, &symbol_short!("fair")), 105);
        assert_eq!(client.decrement(&player, &500, &symbol_short!("cheat")), 0);
        assert_eq!(
            client.increment(&player, &1_000, &symbol_short!("fair")),
            MAX_REPUTATION
        );
    }

    #[test]
    fn rejects_zero_amount() {
        let (env, client) = setup();
        let player = Address::generate(&env);
        assert_eq!(
            client.try_increment(&player, &0, &symbol_short!("fair")),
            Err(Ok(ReputationError::InvalidAmount))
        );
    }
}
