//! ArenaX Staking Contract - Simplified Version
//!
//! A comprehensive staking system for ArenaX tokens with basic functionality
//! that compiles correctly with Soroban SDK

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, String, Vec,
};

/// Contract errors
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum StakingError {
    Unauthorized = 1,
    InvalidPool = 2,
    InsufficientBalance = 3,
    StakeTooLow = 4,
    StakeTooHigh = 5,
    PoolInactive = 6,
    PoolMaxCapacity = 7,
    StillLocked = 8,
    NoRewards = 9,
    InvalidParameters = 10,
    ContractPaused = 11,
}

/// Staking pool information
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakingPool {
    pub pool_id: u64,
    pub name: String,
    pub min_stake: i128,
    pub max_stake: i128,
    pub apy: u64,
    pub lock_period: u64,
    pub total_staked: i128,
    pub created_at: u64,
    pub is_active: bool,
    pub admin: Address,
}

/// User stake information
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserStake {
    pub staker: Address,
    pub pool_id: u64,
    pub amount: i128,
    pub staked_at: u64,
    pub last_reward_claim: u64,
    pub pending_rewards: i128,
    pub total_rewards_claimed: i128,
}

/// Contract configuration
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractConfig {
    pub admin: Address,
    pub token_address: Address,
    pub is_paused: bool,
    pub total_pools_created: u64,
}

/// Storage keys
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StorageKey {
    Config,
    Pool(u64),
    UserStake(Address, u64),
    UserTotalStaked(Address),
}

/// Staking events
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakedEvent {
    pub user: Address,
    pub pool_id: u64,
    pub amount: i128,
    pub timestamp: u64,
}

/// The main staking contract
#[contract]
pub struct StakingContract;

#[contractimpl]
impl StakingContract {
    /// Initialize the staking contract
    pub fn initialize(env: Env, admin: Address, token_address: Address) {
        admin.require_auth();

        let config = ContractConfig {
            admin,
            token_address,
            is_paused: false,
            total_pools_created: 0,
        };

        env.storage().persistent().set(&StorageKey::Config, &config);
    }

    /// Create a new staking pool (admin only)
    pub fn create_pool(
        env: Env,
        name: String,
        min_stake: i128,
        max_stake: i128,
        apy: u64,
        lock_period: u64,
    ) -> u64 {
        let mut config: ContractConfig =
            env.storage().persistent().get(&StorageKey::Config).unwrap();

        config.admin.require_auth();

        let pool_id = config.total_pools_created + 1;
        let current_time = env.ledger().timestamp();

        let pool = StakingPool {
            pool_id,
            name,
            min_stake,
            max_stake,
            apy,
            lock_period,
            total_staked: 0,
            created_at: current_time,
            is_active: true,
            admin: config.admin.clone(),
        };

        // Store the pool
        env.storage()
            .persistent()
            .set(&StorageKey::Pool(pool_id), &pool);

        // Update config
        config.total_pools_created = pool_id;
        env.storage().persistent().set(&StorageKey::Config, &config);

        pool_id
    }

    /// Stake tokens in a specific pool
    pub fn stake(env: Env, user: Address, pool_id: u64, amount: i128) {
        user.require_auth();

        let config: ContractConfig = env.storage().persistent().get(&StorageKey::Config).unwrap();

        let mut pool: StakingPool = env
            .storage()
            .persistent()
            .get(&StorageKey::Pool(pool_id))
            .unwrap();

        // Validate stake amount
        if amount < pool.min_stake {
            panic!("Stake too low");
        }

        if pool.max_stake > 0 && amount > pool.max_stake {
            panic!("Stake too high");
        }

        if !pool.is_active {
            panic!("Pool inactive");
        }

        let current_time = env.ledger().timestamp();

        // Get or create user stake
        let stake_key = StorageKey::UserStake(user.clone(), pool_id);
        let mut user_stake = env
            .storage()
            .persistent()
            .get(&stake_key)
            .unwrap_or(UserStake {
                staker: user.clone(),
                pool_id,
                amount: 0,
                staked_at: current_time,
                last_reward_claim: current_time,
                pending_rewards: 0,
                total_rewards_claimed: 0,
            });

        // Calculate pending rewards before updating stake
        if user_stake.amount > 0 {
            let pending = Self::calculate_pending_rewards(&env, &user_stake, &pool, current_time);
            user_stake.pending_rewards += pending;
        }

        // Transfer tokens to contract
        let token_client = token::Client::new(&env, &config.token_address);
        token_client.transfer(&user, &env.current_contract_address(), &amount);

        // Update stake
        user_stake.amount += amount;
        user_stake.last_reward_claim = current_time;

        // Update pool
        pool.total_staked += amount;

        // Store updated data
        env.storage().persistent().set(&stake_key, &user_stake);
        env.storage()
            .persistent()
            .set(&StorageKey::Pool(pool_id), &pool);

        // Update user's total staked amount
        let total_staked_key = StorageKey::UserTotalStaked(user.clone());
        let mut user_total_staked: i128 = env
            .storage()
            .persistent()
            .get(&total_staked_key)
            .unwrap_or(0);
        user_total_staked += amount;
        env.storage()
            .persistent()
            .set(&total_staked_key, &user_total_staked);
    }

    /// Unstake tokens from a pool
    pub fn unstake(env: Env, user: Address, pool_id: u64, amount: i128) {
        user.require_auth();

        let config: ContractConfig = env.storage().persistent().get(&StorageKey::Config).unwrap();

        let mut pool: StakingPool = env
            .storage()
            .persistent()
            .get(&StorageKey::Pool(pool_id))
            .unwrap();

        let stake_key = StorageKey::UserStake(user.clone(), pool_id);
        let mut user_stake: UserStake = env.storage().persistent().get(&stake_key).unwrap();

        if amount > user_stake.amount {
            panic!("Insufficient staked balance");
        }

        let current_time = env.ledger().timestamp();

        // Check lock period
        if current_time < user_stake.staked_at + pool.lock_period {
            panic!("Still locked");
        }

        // Calculate final rewards
        let pending_rewards =
            Self::calculate_pending_rewards(&env, &user_stake, &pool, current_time);
        user_stake.pending_rewards += pending_rewards;

        // Transfer tokens back to user
        let token_client = token::Client::new(&env, &config.token_address);
        token_client.transfer(&env.current_contract_address(), &user, &amount);

        // Update stake
        user_stake.amount -= amount;
        user_stake.last_reward_claim = current_time;

        // Update pool total
        pool.total_staked -= amount;

        // Store updated data
        env.storage().persistent().set(&stake_key, &user_stake);
        env.storage()
            .persistent()
            .set(&StorageKey::Pool(pool_id), &pool);

        // Update user's total staked amount
        let total_staked_key = StorageKey::UserTotalStaked(user.clone());
        let mut user_total_staked: i128 = env
            .storage()
            .persistent()
            .get(&total_staked_key)
            .unwrap_or(0);
        user_total_staked -= amount;
        env.storage()
            .persistent()
            .set(&total_staked_key, &user_total_staked);
    }

    /// Claim accumulated rewards
    pub fn claim_rewards(env: Env, user: Address, pool_id: u64) -> i128 {
        user.require_auth();

        let config: ContractConfig = env.storage().persistent().get(&StorageKey::Config).unwrap();

        let pool: StakingPool = env
            .storage()
            .persistent()
            .get(&StorageKey::Pool(pool_id))
            .unwrap();

        let stake_key = StorageKey::UserStake(user.clone(), pool_id);
        let mut user_stake: UserStake = env.storage().persistent().get(&stake_key).unwrap();

        let current_time = env.ledger().timestamp();

        // Calculate pending rewards
        let pending_rewards =
            Self::calculate_pending_rewards(&env, &user_stake, &pool, current_time);
        let total_rewards = user_stake.pending_rewards + pending_rewards;

        if total_rewards <= 0 {
            panic!("No rewards available");
        }

        // Transfer rewards to user
        let token_client = token::Client::new(&env, &config.token_address);
        token_client.transfer(&env.current_contract_address(), &user, &total_rewards);

        // Update user stake
        user_stake.pending_rewards = 0;
        user_stake.total_rewards_claimed += total_rewards;
        user_stake.last_reward_claim = current_time;

        env.storage().persistent().set(&stake_key, &user_stake);

        total_rewards
    }

    /// Get user's stake information
    pub fn get_user_stake(env: Env, user: Address, pool_id: u64) -> Option<UserStake> {
        let stake_key = StorageKey::UserStake(user, pool_id);
        env.storage().persistent().get(&stake_key)
    }

    /// Get staking pool information
    pub fn get_pool(env: Env, pool_id: u64) -> Option<StakingPool> {
        env.storage().persistent().get(&StorageKey::Pool(pool_id))
    }

    /// Get contract configuration
    pub fn get_config(env: Env) -> Option<ContractConfig> {
        env.storage().persistent().get(&StorageKey::Config)
    }

    /// Calculate pending rewards for a user's stake
    pub fn get_pending_rewards(env: Env, user: Address, pool_id: u64) -> i128 {
        let pool = env
            .storage()
            .persistent()
            .get::<StorageKey, StakingPool>(&StorageKey::Pool(pool_id))
            .unwrap();

        let stake_key = StorageKey::UserStake(user, pool_id);
        let user_stake = env
            .storage()
            .persistent()
            .get::<StorageKey, UserStake>(&stake_key)
            .unwrap();

        let current_time = env.ledger().timestamp();
        let pending = Self::calculate_pending_rewards(&env, &user_stake, &pool, current_time);

        user_stake.pending_rewards + pending
    }

    /// Internal helper to calculate pending rewards
    fn calculate_pending_rewards(
        _env: &Env,
        user_stake: &UserStake,
        pool: &StakingPool,
        current_time: u64,
    ) -> i128 {
        if user_stake.amount == 0 {
            return 0;
        }

        let time_elapsed = current_time.saturating_sub(user_stake.last_reward_claim);
        if time_elapsed == 0 {
            return 0;
        }

        // Calculate rewards: (amount * apy * time_elapsed) / (365 * 24 * 3600 * 10000)
        // APY is in basis points (10000 = 100%)
        let seconds_per_year = 365u64 * 24 * 3600;
        let rewards = (user_stake.amount * pool.apy as i128 * time_elapsed as i128)
            / (seconds_per_year as i128 * 10000);

        rewards
    }

    /// Get user's total voting power
    pub fn get_voting_power(env: Env, user: Address) -> i128 {
        let total_staked: i128 = env
            .storage()
            .persistent()
            .get(&StorageKey::UserTotalStaked(user))
            .unwrap_or(0);

        total_staked
    }

    /// Update contract configuration (admin only)
    pub fn update_config(
        env: Env,
        admin: Address,
        new_admin: Option<Address>,
        is_paused: Option<bool>,
    ) {
        admin.require_auth();

        let mut config: ContractConfig =
            env.storage().persistent().get(&StorageKey::Config).unwrap();

        if admin != config.admin {
            panic!("Unauthorized");
        }

        if let Some(new_admin) = new_admin {
            config.admin = new_admin;
        }
        if let Some(paused) = is_paused {
            config.is_paused = paused;
        }

        env.storage().persistent().set(&StorageKey::Config, &config);
    }

    /// Get total value locked in the contract
    pub fn get_total_value_locked(env: Env) -> i128 {
        let config: ContractConfig = env.storage().persistent().get(&StorageKey::Config).unwrap();

        let mut total_tvl = 0i128;

        for pool_id in 1..=config.total_pools_created {
            if let Some(pool) = env
                .storage()
                .persistent()
                .get::<StorageKey, StakingPool>(&StorageKey::Pool(pool_id))
            {
                total_tvl += pool.total_staked;
            }
        }

        total_tvl
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, String};

    #[test]
    fn test_initialize() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token = Address::generate(&env);

        let contract_id = env.register(StakingContract, ());
        let client = StakingContractClient::new(&env, &contract_id);

        client.initialize(&admin, &token);

        let config = client.get_config().unwrap();
        assert_eq!(config.admin, admin);
        assert_eq!(config.token_address, token);
        assert!(!config.is_paused);
    }

    #[test]
    fn test_create_pool() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token = Address::generate(&env);

        let contract_id = env.register(StakingContract, ());
        let client = StakingContractClient::new(&env, &contract_id);

        client.initialize(&admin, &token);

        let pool_id = client.create_pool(
            &String::from_str(&env, "Test Pool"),
            &(100 * 10_000_000),
            &0,
            &1000,
            &(30 * 86400),
        );

        assert_eq!(pool_id, 1);

        let pool = client.get_pool(&pool_id).unwrap();
        assert_eq!(pool.pool_id, 1);
        assert_eq!(pool.min_stake, 100 * 10_000_000);
        assert_eq!(pool.apy, 1000);
        assert!(pool.is_active);
    }
}
