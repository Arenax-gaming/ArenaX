#![no_std]

pub mod hooks;
pub mod tournament_hooks;
pub use hooks::{RewardHook, RewardHookClient, MAX_REWARD_HOOKS};
pub use tournament_hooks::{
    ComposableTournamentHooks, ComposableTournamentHooksClient, HookKey, TournamentHook,
    TournamentHookClient,
};

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Owner,
    Paused,
    Counter,
    /// Registered reward hook contracts, up to `MAX_REWARD_HOOKS`, called
    /// in registration order after a reward is issued (#1557).
    RewardHooks,
}

#[contract]
pub struct ComposableExample;

#[contractimpl]
impl ComposableExample {
    pub fn initialize(env: Env, owner: Address) {
        if env.storage().instance().has(&DataKey::Owner) {
            panic!("already initialized");
        }
        owner.require_auth();
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::Counter, &0u32);
    }

    pub fn owner(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Owner)
            .expect("not initialized")
    }

    pub fn transfer_ownership(env: Env, new_owner: Address) {
        let owner = Self::owner(env.clone());
        owner.require_auth();
        env.storage().instance().set(&DataKey::Owner, &new_owner);
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn set_paused(env: Env, paused: bool) {
        let owner = Self::owner(env.clone());
        owner.require_auth();
        env.storage().instance().set(&DataKey::Paused, &paused);
    }

    fn check_not_paused(env: &Env) {
        if Self::is_paused(env.clone()) {
            panic!("contract is paused");
        }
    }

    pub fn increment(env: Env) -> u32 {
        Self::check_not_paused(&env);
        let mut counter: u32 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        counter += 1;
        env.storage().instance().set(&DataKey::Counter, &counter);
        counter
    }

    pub fn decrement(env: Env) -> u32 {
        Self::check_not_paused(&env);
        let mut counter: u32 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        counter = counter.saturating_sub(1);
        env.storage().instance().set(&DataKey::Counter, &counter);
        counter
    }

    pub fn get_counter(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Counter).unwrap_or(0)
    }

    // ── Composable Reward Hooks (#1557) ─────────────────────────────────────

    /// Register a reward hook contract, called in order after every
    /// `issue_reward`. Owner only. Up to `MAX_REWARD_HOOKS` may be
    /// registered at once.
    pub fn register_reward_hook(env: Env, hook: Address) {
        let owner = Self::owner(env.clone());
        owner.require_auth();

        let mut registered_hooks: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::RewardHooks)
            .unwrap_or(Vec::new(&env));

        if registered_hooks.len() >= MAX_REWARD_HOOKS {
            panic!("max reward hooks reached");
        }

        let mut i = 0;
        while i < registered_hooks.len() {
            if registered_hooks.get(i).unwrap() == hook {
                panic!("hook already registered");
            }
            i += 1;
        }

        registered_hooks.push_back(hook);
        env.storage()
            .instance()
            .set(&DataKey::RewardHooks, &registered_hooks);
    }

    /// Unregister a previously-registered reward hook. Owner only.
    pub fn unregister_reward_hook(env: Env, hook: Address) {
        let owner = Self::owner(env.clone());
        owner.require_auth();

        let registered_hooks: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::RewardHooks)
            .unwrap_or(Vec::new(&env));
        let mut remaining = Vec::new(&env);
        let mut i = 0;
        while i < registered_hooks.len() {
            let h = registered_hooks.get(i).unwrap();
            if h != hook {
                remaining.push_back(h);
            }
            i += 1;
        }
        env.storage()
            .instance()
            .set(&DataKey::RewardHooks, &remaining);
    }

    /// Currently registered reward hooks, in call order.
    pub fn get_reward_hooks(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::RewardHooks)
            .unwrap_or(Vec::new(&env))
    }

    /// Issue `amount` to `recipient` and call every registered reward hook,
    /// in registration order, via `RewardHook::on_reward`. Owner only.
    ///
    /// If any hook call fails (panics), this entire call -- the reward
    /// issuance and every hook call already made in it -- is rolled back,
    /// since hook invocations are plain cross-contract calls and a panic
    /// in one aborts the whole transaction. An empty hook list simply
    /// issues the reward and emits `hooks_executed` with a count of zero.
    pub fn issue_reward(env: Env, recipient: Address, amount: i128, context: String) {
        Self::check_not_paused(&env);
        let owner = Self::owner(env.clone());
        owner.require_auth();

        let registered_hooks: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::RewardHooks)
            .unwrap_or(Vec::new(&env));

        let mut count: u32 = 0;
        let mut i = 0;
        while i < registered_hooks.len() {
            let hook = registered_hooks.get(i).unwrap();
            hooks::RewardHookClient::new(&env, &hook).on_reward(&recipient, &amount, &context);
            count += 1;
            i += 1;
        }

        hooks::emit_hooks_executed(&env, &recipient, amount, count);
    }
}
