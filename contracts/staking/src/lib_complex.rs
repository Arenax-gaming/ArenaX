//! ArenaX Staking Contract
//!
//! A comprehensive staking system for ArenaX tokens with the following features:
//! - Token staking and unstaking with time locks
//! - Reward calculation and distribution
//! - Slashing conditions for malicious behavior
//! - Governance participation based on staking power
//! - Multiple staking pools with different terms
//! - Compound rewards functionality
//! - Gas-optimized operations and event emission

#![no_std]

use soroban_sdk::{
    contract, contractimpl, token, Address, Env, String, Vec, Map
};

mod types;
mod governance;
mod slashing;
mod admin;
use types::*;

/// External token interface for ArenaX token interactions
#[contract]
pub struct StakingContract;

#[contractimpl]
impl StakingContract {
    /// Initialize the staking contract with basic configuration
    pub fn initialize(
        env: Env,
        admin: Address,
        token_address: Address,
        min_voting_period: u64,
        default_quorum: u64,
    ) -> Result<(), StakingError> {
        admin.require_auth();

        let config = ContractConfig {
            admin: admin.clone(),
            token_address,
            min_voting_period,
            max_voting_period: min_voting_period * 10, // 10x min voting period
            default_quorum,
            min_proposal_stake: 1000 * 10_000_000, // 1000 ArenaX tokens (7 decimals)
            is_paused: false,
            total_pools_created: 0,
            total_proposals_created: 0,
            emergency_withdrawal_enabled: false,
            protocol_fee_rate: 100, // 1% protocol fee
            fee_collector: admin,
            max_pools_per_user: 10,
        };

        env.storage()
            .persistent()
            .set(&StorageKey::Config, &config);

        Ok(())
    }

    /// Create a new staking pool (admin only)
    pub fn create_pool(
        env: Env,
        name: String,
        min_stake: i128,
        max_stake: i128,
        apy: u64,
        lock_period: u64,
        max_total_stake: i128,
        early_withdrawal_penalty: u64,
        governance_multiplier: u64,
    ) -> Result<u64, StakingError> {
        let mut config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;
        
        config.admin.require_auth();

        if config.is_paused {
            return Err(StakingError::ContractPaused);
        }

        // Validate parameters
        if min_stake <= 0 || apy > 100_000 || early_withdrawal_penalty > 10_000 {
            return Err(StakingError::InvalidParameters);
        }

        let pool_id = config.total_pools_created + 1;
        let current_time = env.ledger().timestamp();

        let pool = StakingPool {
            pool_id,
            name: name.clone(),
            min_stake,
            max_stake,
            apy,
            lock_period,
            total_staked: 0,
            total_rewards_distributed: 0,
            created_at: current_time,
            is_active: true,
            admin: config.admin.clone(),
            reward_frequency: 86400, // Daily rewards distribution
            last_reward_distribution: current_time,
            max_total_stake,
            early_withdrawal_penalty,
            governance_multiplier,
        };

        // Store the pool
        env.storage()
            .persistent()
            .set(&StorageKey::Pool(pool_id), &pool);

        // Update config
        config.total_pools_created = pool_id;
        env.storage()
            .persistent()
            .set(&StorageKey::Config, &config);

        // Emit event
        let event = StakingEvent::PoolCreated {
            pool_id,
            admin: config.admin,
            name,
            apy,
            timestamp: current_time,
        };
        env.events().publish(("stake_event", "pool_created"), event);

        Ok(pool_id)
    }

    /// Stake tokens in a specific pool
    pub fn stake(
        env: Env,
        user: Address,
        pool_id: u64,
        amount: i128,
    ) -> Result<(), StakingError> {
        user.require_auth();

        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        if config.is_paused {
            return Err(StakingError::ContractPaused);
        }

        let mut pool: StakingPool = env.storage()
            .persistent()
            .get(&StorageKey::Pool(pool_id))
            .ok_or(StakingError::InvalidPool)?;

        if !pool.is_active {
            return Err(StakingError::PoolInactive);
        }

        // Validate stake amount
        if amount < pool.min_stake {
            return Err(StakingError::StakeTooLow);
        }

        if pool.max_stake > 0 && amount > pool.max_stake {
            return Err(StakingError::StakeTooHigh);
        }

        // Check pool capacity
        if pool.max_total_stake > 0 && pool.total_staked + amount > pool.max_total_stake {
            return Err(StakingError::PoolMaxCapacity);
        }

        let current_time = env.ledger().timestamp();

        // Get or create user stake
        let stake_key = StorageKey::UserStake(user.clone(), pool_id);
        let mut user_stake = env.storage()
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
                compound_enabled: false,
                unstake_requested_at: 0,
                unstake_amount: 0,
                reputation_multiplier: 10000, // 100% multiplier (100.00%)
            });

        // Calculate pending rewards before updating stake
        if user_stake.amount > 0 {
            let pending = Self::calculate_pending_rewards(&env, &user_stake, &pool, current_time)?;
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
        env.storage().persistent().set(&StorageKey::Pool(pool_id), &pool);

        // Update user's total staked amount
        let total_staked_key = StorageKey::UserTotalStaked(user.clone());
        let mut user_total_staked: i128 = env.storage()
            .persistent()
            .get(&total_staked_key)
            .unwrap_or(0);
        user_total_staked += amount;
        env.storage().persistent().set(&total_staked_key, &user_total_staked);

        // Emit event
        let event = StakingEvent::Staked {
            user,
            pool_id,
            amount,
            timestamp: current_time,
        };
        env.events().publish(("stake_event", "staked"), event);

        Ok(())
    }

    /// Request unstaking (starts the unlock period)
    pub fn request_unstake(
        env: Env,
        user: Address,
        pool_id: u64,
        amount: i128,
    ) -> Result<(), StakingError> {
        user.require_auth();

        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        if config.is_paused && !config.emergency_withdrawal_enabled {
            return Err(StakingError::ContractPaused);
        }

        let stake_key = StorageKey::UserStake(user.clone(), pool_id);
        let mut user_stake: UserStake = env.storage()
            .persistent()
            .get(&stake_key)
            .ok_or(StakingError::InvalidPool)?;

        if amount > user_stake.amount {
            return Err(StakingError::InsufficientBalance);
        }

        let current_time = env.ledger().timestamp();
        user_stake.unstake_requested_at = current_time;
        user_stake.unstake_amount = amount;

        env.storage().persistent().set(&stake_key, &user_stake);

        Ok(())
    }

    /// Execute unstaking after lock period
    pub fn unstake(
        env: Env,
        user: Address,
        pool_id: u64,
    ) -> Result<(), StakingError> {
        user.require_auth();

        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        let pool: StakingPool = env.storage()
            .persistent()
            .get(&StorageKey::Pool(pool_id))
            .ok_or(StakingError::InvalidPool)?;

        let stake_key = StorageKey::UserStake(user.clone(), pool_id);
        let mut user_stake: UserStake = env.storage()
            .persistent()
            .get(&stake_key)
            .ok_or(StakingError::InvalidPool)?;

        if user_stake.unstake_requested_at == 0 {
            return Err(StakingError::InvalidParameters);
        }

        let current_time = env.ledger().timestamp();
        let mut penalty = 0i128;

        // Check if lock period has passed
        if current_time < user_stake.staked_at + pool.lock_period {
            if !config.emergency_withdrawal_enabled {
                return Err(StakingError::StillLocked);
            }
            
            // Calculate early withdrawal penalty
            penalty = (user_stake.unstake_amount * pool.early_withdrawal_penalty as i128) / 10000;
        }

        let amount_to_return = user_stake.unstake_amount - penalty;

        // Calculate and add final rewards
        let pending_rewards = Self::calculate_pending_rewards(&env, &user_stake, &pool, current_time)?;
        user_stake.pending_rewards += pending_rewards;

        // Transfer tokens back to user
        let token_client = token::Client::new(&env, &config.token_address);
        token_client.transfer(&env.current_contract_address(), &user, &amount_to_return);

        // Update stake
        user_stake.amount -= user_stake.unstake_amount;
        user_stake.unstake_requested_at = 0;
        user_stake.unstake_amount = 0;
        user_stake.last_reward_claim = current_time;

        // Update pool total
        let mut updated_pool = pool;
        updated_pool.total_staked -= user_stake.unstake_amount;

        // Store updated data
        env.storage().persistent().set(&stake_key, &user_stake);
        env.storage().persistent().set(&StorageKey::Pool(pool_id), &updated_pool);

        // Update user's total staked amount
        let total_staked_key = StorageKey::UserTotalStaked(user.clone());
        let mut user_total_staked: i128 = env.storage()
            .persistent()
            .get(&total_staked_key)
            .unwrap_or(0);
        user_total_staked -= user_stake.unstake_amount;
        env.storage().persistent().set(&total_staked_key, &user_total_staked);

        // Emit event
        let event = StakingEvent::Unstaked {
            user,
            pool_id,
            amount: user_stake.unstake_amount,
            penalty,
            timestamp: current_time,
        };
        env.events().publish(("stake_event", "unstaked"), event);

        Ok(())
    }

    /// Claim accumulated rewards
    pub fn claim_rewards(
        env: Env,
        user: Address,
        pool_id: u64,
    ) -> Result<i128, StakingError> {
        user.require_auth();

        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        let pool: StakingPool = env.storage()
            .persistent()
            .get(&StorageKey::Pool(pool_id))
            .ok_or(StakingError::InvalidPool)?;

        let stake_key = StorageKey::UserStake(user.clone(), pool_id);
        let mut user_stake: UserStake = env.storage()
            .persistent()
            .get(&stake_key)
            .ok_or(StakingError::InvalidPool)?;

        let current_time = env.ledger().timestamp();

        // Calculate pending rewards
        let pending_rewards = Self::calculate_pending_rewards(&env, &user_stake, &pool, current_time)?;
        let total_rewards = user_stake.pending_rewards + pending_rewards;

        if total_rewards <= 0 {
            return Err(StakingError::NoRewards);
        }

        // Calculate protocol fee
        let protocol_fee = (total_rewards * config.protocol_fee_rate as i128) / 10000;
        let net_rewards = total_rewards - protocol_fee;

        // Transfer rewards to user
        let token_client = token::Client::new(&env, &config.token_address);
        token_client.transfer(&env.current_contract_address(), &user, &net_rewards);

        // Transfer protocol fee to fee collector
        if protocol_fee > 0 {
            token_client.transfer(&env.current_contract_address(), &config.fee_collector, &protocol_fee);
        }

        // Update user stake
        user_stake.pending_rewards = 0;
        user_stake.total_rewards_claimed += net_rewards;
        user_stake.last_reward_claim = current_time;

        env.storage().persistent().set(&stake_key, &user_stake);

        // Emit event
        let event = StakingEvent::RewardsClaimed {
            user,
            pool_id,
            amount: net_rewards,
            timestamp: current_time,
        };
        env.events().publish(("stake_event", "rewards_claimed"), event);

        Ok(net_rewards)
    }

    /// Enable or disable compound rewards for a user's stake
    pub fn set_compound_rewards(
        env: Env,
        user: Address,
        pool_id: u64,
        enabled: bool,
    ) -> Result<(), StakingError> {
        user.require_auth();

        let stake_key = StorageKey::UserStake(user.clone(), pool_id);
        let mut user_stake: UserStake = env.storage()
            .persistent()
            .get(&stake_key)
            .ok_or(StakingError::InvalidPool)?;

        user_stake.compound_enabled = enabled;
        env.storage().persistent().set(&stake_key, &user_stake);

        Ok(())
    }

    /// Compound rewards (convert pending rewards to staked amount)
    pub fn compound_rewards(
        env: Env,
        user: Address,
        pool_id: u64,
    ) -> Result<i128, StakingError> {
        user.require_auth();

        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        let mut pool: StakingPool = env.storage()
            .persistent()
            .get(&StorageKey::Pool(pool_id))
            .ok_or(StakingError::InvalidPool)?;

        let stake_key = StorageKey::UserStake(user.clone(), pool_id);
        let mut user_stake: UserStake = env.storage()
            .persistent()
            .get(&stake_key)
            .ok_or(StakingError::InvalidPool)?;

        let current_time = env.ledger().timestamp();

        // Calculate pending rewards
        let pending_rewards = Self::calculate_pending_rewards(&env, &user_stake, &pool, current_time)?;
        let total_rewards = user_stake.pending_rewards + pending_rewards;

        if total_rewards <= 0 {
            return Err(StakingError::NoRewards);
        }

        // Calculate protocol fee
        let protocol_fee = (total_rewards * config.protocol_fee_rate as i128) / 10000;
        let net_rewards = total_rewards - protocol_fee;

        // Add rewards to staked amount
        user_stake.amount += net_rewards;
        user_stake.pending_rewards = 0;
        user_stake.last_reward_claim = current_time;

        // Update pool total
        pool.total_staked += net_rewards;

        // Transfer protocol fee to fee collector
        if protocol_fee > 0 {
            let token_client = token::Client::new(&env, &config.token_address);
            token_client.transfer(&env.current_contract_address(), &config.fee_collector, &protocol_fee);
        }

        // Store updated data
        env.storage().persistent().set(&stake_key, &user_stake);
        env.storage().persistent().set(&StorageKey::Pool(pool_id), &pool);

        // Update user's total staked amount
        let total_staked_key = StorageKey::UserTotalStaked(user.clone());
        let mut user_total_staked: i128 = env.storage()
            .persistent()
            .get(&total_staked_key)
            .unwrap_or(0);
        user_total_staked += net_rewards;
        env.storage().persistent().set(&total_staked_key, &user_total_staked);

        // Emit event
        let event = StakingEvent::RewardsCompounded {
            user,
            pool_id,
            amount: net_rewards,
            timestamp: current_time,
        };
        env.events().publish(("stake_event", "rewards_compounded"), event);

        Ok(net_rewards)
    }

    /// Get user's stake information
    pub fn get_user_stake(
        env: Env,
        user: Address,
        pool_id: u64,
    ) -> Result<UserStake, StakingError> {
        let stake_key = StorageKey::UserStake(user, pool_id);
        env.storage()
            .persistent()
            .get(&stake_key)
            .ok_or(StakingError::InvalidPool)
    }

    /// Get staking pool information
    pub fn get_pool(
        env: Env,
        pool_id: u64,
    ) -> Result<StakingPool, StakingError> {
        env.storage()
            .persistent()
            .get(&StorageKey::Pool(pool_id))
            .ok_or(StakingError::InvalidPool)
    }

    /// Get contract configuration
    pub fn get_config(env: Env) -> Result<ContractConfig, StakingError> {
        env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)
    }

    /// Calculate pending rewards for a user's stake (view function)
    pub fn get_pending_rewards(
        env: Env,
        user: Address,
        pool_id: u64,
    ) -> Result<i128, StakingError> {
        let pool: StakingPool = env.storage()
            .persistent()
            .get(&StorageKey::Pool(pool_id))
            .ok_or(StakingError::InvalidPool)?;

        let stake_key = StorageKey::UserStake(user, pool_id);
        let user_stake: UserStake = env.storage()
            .persistent()
            .get(&stake_key)
            .ok_or(StakingError::InvalidPool)?;

        let current_time = env.ledger().timestamp();
        let pending = Self::calculate_pending_rewards(&env, &user_stake, &pool, current_time)?;
        
        Ok(user_stake.pending_rewards + pending)
    }

    /// Internal helper to calculate pending rewards
    fn calculate_pending_rewards(
        env: &Env,
        user_stake: &UserStake,
        pool: &StakingPool,
        current_time: u64,
    ) -> Result<i128, StakingError> {
        if user_stake.amount == 0 {
            return Ok(0);
        }

        let time_elapsed = current_time.saturating_sub(user_stake.last_reward_claim);
        if time_elapsed == 0 {
            return Ok(0);
        }

        // Calculate base rewards: (amount * apy * time_elapsed) / (365 * 24 * 3600 * 10000)
        // APY is in basis points (10000 = 100%)
        let seconds_per_year = 365u64 * 24 * 3600;
        let base_rewards = (user_stake.amount * pool.apy as i128 * time_elapsed as i128) / (seconds_per_year as i128 * 10000);

        // Apply reputation multiplier
        let adjusted_rewards = (base_rewards * user_stake.reputation_multiplier as i128) / 10000;

        Ok(adjusted_rewards)
    }

    /// Get user's total voting power across all pools
    pub fn get_voting_power(env: Env, user: Address) -> Result<i128, StakingError> {
        let total_staked: i128 = env.storage()
            .persistent()
            .get(&StorageKey::UserTotalStaked(user))
            .unwrap_or(0);

        // For now, voting power equals total staked amount
        // In future versions, this could incorporate governance multipliers from different pools
        Ok(total_staked)
    }
}

#[cfg(test)]
mod test;