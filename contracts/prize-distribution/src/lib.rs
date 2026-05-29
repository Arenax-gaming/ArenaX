#![no_std]

use arenax_events::prize_distribution as events;
use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, BytesN, Env, IntoVal, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    MatchContract,
    DisputeContract,
    NextPoolId,
    PrizePool(u64),
    Paused,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PoolState {
    Locked = 0,
    Held = 1,
    Distributed = 2,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrizePool {
    pub pool_id: u64,
    pub asset: Address,
    pub amount_locked: i128,
    pub match_id: BytesN<32>,
    pub weights: Vec<u32>,
    pub state: u32,
}

#[contract]
pub struct PrizeDistributionContract;

#[contractimpl]
impl PrizeDistributionContract {
    /// Initialize the prize distribution contract
    pub fn initialize(
        env: Env,
        admin: Address,
        match_contract: Address,
        dispute_contract: Address,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::MatchContract, &match_contract);
        env.storage()
            .instance()
            .set(&DataKey::DisputeContract, &dispute_contract);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::NextPoolId, &1u64);
    }

    /// Create a new prize pool for a match and lock the funds
    pub fn create_pool(
        env: Env,
        creator: Address,
        match_id: BytesN<32>,
        asset: Address,
        amount: i128,
    ) -> u64 {
        Self::require_not_paused(&env);
        creator.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        // Verify that the match exists in the match contract
        let match_contract = Self::get_match_contract(&env);
        let _: soroban_sdk::Val = env.invoke_contract(
            &match_contract,
            &soroban_sdk::Symbol::new(&env, "get_match"),
            (match_id.clone(),).into_val(&env),
        );

        // Transfer funds from the creator to this contract
        let contract_address = env.current_contract_address();
        let token_client = token::Client::new(&env, &asset);
        token_client.transfer(&creator, &contract_address, &amount);

        // Generate pool ID
        let pool_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextPoolId)
            .expect("not initialized");
        env.storage()
            .instance()
            .set(&DataKey::NextPoolId, &(pool_id + 1));

        let pool = PrizePool {
            pool_id,
            asset: asset.clone(),
            amount_locked: amount,
            match_id: match_id.clone(),
            weights: Vec::new(&env),
            state: PoolState::Locked as u32,
        };

        env.storage()
            .persistent()
            .set(&DataKey::PrizePool(pool_id), &pool);

        // Emit events
        events::emit_pool_created(&env, pool_id, &match_id, &asset, amount);
        events::emit_pool_locked(&env, pool_id, amount);

        pool_id
    }

    /// Distribute the prize pool atomically to the winners based on weights
    pub fn distribute(
        env: Env,
        caller: Address,
        pool_id: u64,
        winners: Vec<Address>,
        weights: Vec<u32>,
    ) {
        Self::require_not_paused(&env);
        caller.require_auth();

        // Enforce authorization: only admin or the match contract can distribute
        let admin = Self::get_admin(env.clone());
        let match_contract = Self::get_match_contract(&env);
        if caller != admin && caller != match_contract {
            panic!("unauthorized caller");
        }

        let mut pool: PrizePool = env
            .storage()
            .persistent()
            .get(&DataKey::PrizePool(pool_id))
            .expect("pool not found");

        if pool.state != PoolState::Locked as u32 {
            panic!("pool is not locked");
        }

        // Verify that the match is not disputed
        let dispute_contract = Self::get_dispute_contract(&env);
        let is_disp: bool = env.invoke_contract(
            &dispute_contract,
            &soroban_sdk::Symbol::new(&env, "is_disputed"),
            (pool.match_id.clone(),).into_val(&env),
        );

        if is_disp {
            // Automatically place on hold, save state, and revert
            pool.state = PoolState::Held as u32;
            env.storage()
                .persistent()
                .set(&DataKey::PrizePool(pool_id), &pool);

            events::emit_payout_held(&env, pool_id, &pool.match_id);
            panic!("match is disputed, payout held");
        }

        // Validate winners and weights
        let len = winners.len();
        if len == 0 {
            panic!("winners list cannot be empty");
        }
        if len != weights.len() {
            panic!("winners and weights lengths must match");
        }

        // Validate weights sum to 10000 (basis points)
        let mut sum_weights: u32 = 0;
        for w in weights.iter() {
            sum_weights += w;
        }
        if sum_weights != 10000 {
            panic!("weights must sum to 10000");
        }

        // Distribute funds atomically
        let token_client = token::Client::new(&env, &pool.asset);
        let contract_address = env.current_contract_address();

        let mut distributed_amount: i128 = 0;
        for i in 0..len {
            let winner = winners.get(i).unwrap();
            let weight = weights.get(i).unwrap();

            let payout = if i == len - 1 {
                // Last winner gets the remainder to avoid dust
                pool.amount_locked - distributed_amount
            } else {
                (pool.amount_locked * (weight as i128)) / 10000
            };

            if payout > 0 {
                token_client.transfer(&contract_address, &winner, &payout);
                distributed_amount += payout;
            }
        }

        pool.weights = weights.clone();
        pool.state = PoolState::Distributed as u32;

        env.storage()
            .persistent()
            .set(&DataKey::PrizePool(pool_id), &pool);

        events::emit_payout_executed(&env, pool_id, &winners, &weights);
    }

    /// Place a pool payout on hold
    pub fn hold_payout(env: Env, caller: Address, pool_id: u64) {
        Self::require_not_paused(&env);
        caller.require_auth();

        let mut pool: PrizePool = env
            .storage()
            .persistent()
            .get(&DataKey::PrizePool(pool_id))
            .expect("pool not found");

        if pool.state != PoolState::Locked as u32 {
            panic!("pool is not locked");
        }

        // Only admin can put non-disputed pools on hold. Anyone can trigger hold if disputed.
        let admin = Self::get_admin(env.clone());
        if caller != admin {
            let dispute_contract = Self::get_dispute_contract(&env);
            let is_disp: bool = env.invoke_contract(
                &dispute_contract,
                &soroban_sdk::Symbol::new(&env, "is_disputed"),
                (pool.match_id.clone(),).into_val(&env),
            );
            if !is_disp {
                panic!("only admin can put non-disputed pools on hold");
            }
        }

        pool.state = PoolState::Held as u32;
        env.storage()
            .persistent()
            .set(&DataKey::PrizePool(pool_id), &pool);

        events::emit_payout_held(&env, pool_id, &pool.match_id);
    }

    /// Release hold status from a pool payout
    pub fn release_payout(env: Env, pool_id: u64) {
        Self::require_not_paused(&env);
        Self::require_admin(&env);

        let mut pool: PrizePool = env
            .storage()
            .persistent()
            .get(&DataKey::PrizePool(pool_id))
            .expect("pool not found");

        if pool.state != PoolState::Held as u32 {
            panic!("pool is not held");
        }

        // Verify that the dispute has been resolved
        let dispute_contract = Self::get_dispute_contract(&env);
        let is_disp: bool = env.invoke_contract(
            &dispute_contract,
            &soroban_sdk::Symbol::new(&env, "is_disputed"),
            (pool.match_id.clone(),).into_val(&env),
        );

        if is_disp {
            panic!("match is still disputed");
        }

        pool.state = PoolState::Locked as u32;
        env.storage()
            .persistent()
            .set(&DataKey::PrizePool(pool_id), &pool);

        events::emit_payout_released(&env, pool_id, &pool.match_id);
    }

    /// Set paused state for the contract (admin only)
    pub fn set_paused(env: Env, paused: bool) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Paused, &paused);
    }

    /// Set match contract address (admin only)
    pub fn set_match_contract(env: Env, match_contract: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::MatchContract, &match_contract);
    }

    /// Set dispute contract address (admin only)
    pub fn set_dispute_contract(env: Env, dispute_contract: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::DisputeContract, &dispute_contract);
    }

    /// Get prize pool details
    pub fn get_pool(env: Env, pool_id: u64) -> PrizePool {
        env.storage()
            .persistent()
            .get(&DataKey::PrizePool(pool_id))
            .expect("pool not found")
    }

    /// Check if a pool exists
    pub fn pool_exists(env: Env, pool_id: u64) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::PrizePool(pool_id))
    }

    /// Check if contract is paused
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Get current admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    fn require_admin(env: &Env) {
        let admin = Self::get_admin(env.clone());
        admin.require_auth();
    }

    fn require_not_paused(env: &Env) {
        let paused = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            panic!("contract is paused");
        }
    }

    fn get_match_contract(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::MatchContract)
            .expect("match contract not set")
    }

    fn get_dispute_contract(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::DisputeContract)
            .expect("dispute contract not set")
    }
}

#[cfg(test)]
mod test;

