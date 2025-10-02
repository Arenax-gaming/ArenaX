//! Administrative functions for the ArenaX Staking Contract

use soroban_sdk::{Address, Env, String, Vec};
use crate::types::*;

impl crate::StakingContract {
    /// Update contract configuration (admin only)
    pub fn update_config(
        env: Env,
        admin: Address,
        new_admin: Option<Address>,
        min_voting_period: Option<u64>,
        max_voting_period: Option<u64>,
        default_quorum: Option<u64>,
        min_proposal_stake: Option<i128>,
        protocol_fee_rate: Option<u64>,
        fee_collector: Option<Address>,
    ) -> Result<(), StakingError> {
        admin.require_auth();

        let mut config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        if admin != config.admin {
            return Err(StakingError::Unauthorized);
        }

        // Update fields if provided
        if let Some(new_admin) = new_admin {
            config.admin = new_admin;
        }
        if let Some(min_period) = min_voting_period {
            config.min_voting_period = min_period;
        }
        if let Some(max_period) = max_voting_period {
            config.max_voting_period = max_period;
        }
        if let Some(quorum) = default_quorum {
            if quorum > 10000 { // Max 100%
                return Err(StakingError::InvalidParameters);
            }
            config.default_quorum = quorum;
        }
        if let Some(min_stake) = min_proposal_stake {
            if min_stake < 0 {
                return Err(StakingError::InvalidParameters);
            }
            config.min_proposal_stake = min_stake;
        }
        if let Some(fee_rate) = protocol_fee_rate {
            if fee_rate > 1000 { // Max 10%
                return Err(StakingError::InvalidParameters);
            }
            config.protocol_fee_rate = fee_rate;
        }
        if let Some(collector) = fee_collector {
            config.fee_collector = collector;
        }

        env.storage().persistent().set(&StorageKey::Config, &config);
        Ok(())
    }

    /// Pause or unpause the contract (admin only)
    pub fn set_pause_status(
        env: Env,
        admin: Address,
        is_paused: bool,
    ) -> Result<(), StakingError> {
        admin.require_auth();

        let mut config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        if admin != config.admin {
            return Err(StakingError::Unauthorized);
        }

        config.is_paused = is_paused;
        env.storage().persistent().set(&StorageKey::Config, &config);
        Ok(())
    }

    /// Enable or disable emergency withdrawals (admin only)
    pub fn set_emergency_withdrawal(
        env: Env,
        admin: Address,
        enabled: bool,
    ) -> Result<(), StakingError> {
        admin.require_auth();

        let mut config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        if admin != config.admin {
            return Err(StakingError::Unauthorized);
        }

        config.emergency_withdrawal_enabled = enabled;
        env.storage().persistent().set(&StorageKey::Config, &config);
        Ok(())
    }

    /// Update pool parameters (admin only)
    pub fn update_pool(
        env: Env,
        admin: Address,
        pool_id: u64,
        apy: Option<u64>,
        is_active: Option<bool>,
        max_total_stake: Option<i128>,
        early_withdrawal_penalty: Option<u64>,
        governance_multiplier: Option<u64>,
    ) -> Result<(), StakingError> {
        admin.require_auth();

        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        if admin != config.admin {
            return Err(StakingError::Unauthorized);
        }

        let mut pool: StakingPool = env.storage()
            .persistent()
            .get(&StorageKey::Pool(pool_id))
            .ok_or(StakingError::InvalidPool)?;

        // Update fields if provided
        if let Some(new_apy) = apy {
            if new_apy > 100_000 { // Max 1000% APY
                return Err(StakingError::InvalidParameters);
            }
            pool.apy = new_apy;
        }
        if let Some(active) = is_active {
            pool.is_active = active;
        }
        if let Some(max_stake) = max_total_stake {
            pool.max_total_stake = max_stake;
        }
        if let Some(penalty) = early_withdrawal_penalty {
            if penalty > 10000 { // Max 100%
                return Err(StakingError::InvalidParameters);
            }
            pool.early_withdrawal_penalty = penalty;
        }
        if let Some(multiplier) = governance_multiplier {
            if multiplier > 50000 { // Max 500% multiplier
                return Err(StakingError::InvalidParameters);
            }
            pool.governance_multiplier = multiplier;
        }

        env.storage().persistent().set(&StorageKey::Pool(pool_id), &pool);

        // Emit event
        let current_time = env.ledger().timestamp();
        let event = StakingEvent::PoolUpdated {
            pool_id,
            admin,
            timestamp: current_time,
        };
        env.events().publish(("admin_event", "pool_updated"), event);

        Ok(())
    }

    /// Get contract statistics
    pub fn get_contract_stats(env: Env) -> Result<(u64, u64, i128, i128), StakingError> {
        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        let mut total_staked = 0i128;
        let mut total_rewards_distributed = 0i128;
        let active_pools = config.total_pools_created;

        // Sum up all pool statistics
        for pool_id in 1..=config.total_pools_created {
            if let Some(pool) = env.storage().persistent().get::<StorageKey, StakingPool>(&StorageKey::Pool(pool_id)) {
                total_staked += pool.total_staked;
                total_rewards_distributed += pool.total_rewards_distributed;
            }
        }

        Ok((active_pools, config.total_proposals_created, total_staked, total_rewards_distributed))
    }

    /// Get pool statistics
    pub fn get_pool_stats(
        env: Env,
        pool_id: u64,
    ) -> Result<(i128, i128, u64, bool), StakingError> {
        let pool: StakingPool = env.storage()
            .persistent()
            .get(&StorageKey::Pool(pool_id))
            .ok_or(StakingError::InvalidPool)?;

        Ok((
            pool.total_staked,
            pool.total_rewards_distributed,
            pool.apy,
            pool.is_active,
        ))
    }

    /// Batch reward distribution (admin only) - for gas optimization
    pub fn batch_distribute_rewards(
        env: Env,
        admin: Address,
        pool_id: u64,
        recipients: Vec<Address>,
        amounts: Vec<i128>,
    ) -> Result<(), StakingError> {
        admin.require_auth();

        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        if admin != config.admin {
            return Err(StakingError::Unauthorized);
        }

        if recipients.len() != amounts.len() {
            return Err(StakingError::InvalidParameters);
        }

        let mut pool: StakingPool = env.storage()
            .persistent()
            .get(&StorageKey::Pool(pool_id))
            .ok_or(StakingError::InvalidPool)?;

        let current_time = env.ledger().timestamp();
        let mut total_distributed = 0i128;

        // Distribute rewards to each recipient
        for (i, recipient) in recipients.iter().enumerate() {
            let amount = amounts.get(i).unwrap_or(0);
            if amount <= 0 {
                continue;
            }

            let stake_key = StorageKey::UserStake(recipient.clone(), pool_id);
            if let Some(mut user_stake) = env.storage().persistent().get::<StorageKey, UserStake>(&stake_key) {
                user_stake.pending_rewards += amount;
                env.storage().persistent().set(&stake_key, &user_stake);
                total_distributed += amount;
            }
        }

        // Update pool statistics
        pool.total_rewards_distributed += total_distributed;
        pool.last_reward_distribution = current_time;
        env.storage().persistent().set(&StorageKey::Pool(pool_id), &pool);

        // Create distribution record
        let distribution = RewardDistribution {
            pool_id,
            distributed_at: current_time,
            total_amount: total_distributed,
            recipient_count: recipients.len() as u32,
            average_reward: if recipients.len() > 0 { total_distributed / recipients.len() as i128 } else { 0 },
            trigger_type: String::from_str(&env, "batch_admin"),
        };

        env.storage().persistent().set(
            &StorageKey::RewardDistribution(pool_id, current_time),
            &distribution,
        );

        Ok(())
    }

    /// Emergency withdrawal for all users in a pool (admin only)
    pub fn emergency_withdraw_all(
        env: Env,
        admin: Address,
        pool_id: u64,
        reason: String,
    ) -> Result<(), StakingError> {
        admin.require_auth();

        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        if admin != config.admin {
            return Err(StakingError::Unauthorized);
        }

        if !config.emergency_withdrawal_enabled {
            return Err(StakingError::ContractPaused);
        }

        // Mark pool as inactive
        let mut pool: StakingPool = env.storage()
            .persistent()
            .get(&StorageKey::Pool(pool_id))
            .ok_or(StakingError::InvalidPool)?;

        pool.is_active = false;
        env.storage().persistent().set(&StorageKey::Pool(pool_id), &pool);

        // In a real implementation, you would need to iterate through all users
        // and enable immediate withdrawal without penalties
        // This is a simplified version that just marks the pool as inactive

        Ok(())
    }

    /// Get active pools
    pub fn get_active_pools(env: Env) -> Vec<u64> {
        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .unwrap_or(ContractConfig {
                admin: Address::generate(&env), // Dummy value
                token_address: Address::generate(&env), // Dummy value
                min_voting_period: 0,
                max_voting_period: 0,
                default_quorum: 0,
                min_proposal_stake: 0,
                is_paused: false,
                total_pools_created: 0,
                total_proposals_created: 0,
                emergency_withdrawal_enabled: false,
                protocol_fee_rate: 0,
                fee_collector: Address::generate(&env), // Dummy value
                max_pools_per_user: 0,
            });

        let mut active_pools = Vec::new(&env);

        for pool_id in 1..=config.total_pools_created {
            if let Some(pool) = env.storage().persistent().get::<StorageKey, StakingPool>(&StorageKey::Pool(pool_id)) {
                if pool.is_active {
                    active_pools.push_back(pool_id);
                }
            }
        }

        active_pools
    }

    /// Get user's stakes across all pools
    pub fn get_user_all_stakes(
        env: Env,
        user: Address,
    ) -> Vec<UserStake> {
        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .unwrap_or(ContractConfig {
                admin: Address::generate(&env), // Dummy value
                token_address: Address::generate(&env), // Dummy value
                min_voting_period: 0,
                max_voting_period: 0,
                default_quorum: 0,
                min_proposal_stake: 0,
                is_paused: false,
                total_pools_created: 0,
                total_proposals_created: 0,
                emergency_withdrawal_enabled: false,
                protocol_fee_rate: 0,
                fee_collector: Address::generate(&env), // Dummy value
                max_pools_per_user: 0,
            });

        let mut user_stakes = Vec::new(&env);

        for pool_id in 1..=config.total_pools_created {
            let stake_key = StorageKey::UserStake(user.clone(), pool_id);
            if let Some(stake) = env.storage().persistent().get::<StorageKey, UserStake>(&stake_key) {
                user_stakes.push_back(stake);
            }
        }

        user_stakes
    }

    /// Check if pool exists and is valid
    pub fn is_valid_pool(env: Env, pool_id: u64) -> bool {
        env.storage()
            .persistent()
            .has(&StorageKey::Pool(pool_id))
    }

    /// Get total value locked in the contract
    pub fn get_total_value_locked(env: Env) -> Result<i128, StakingError> {
        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        let mut total_tvl = 0i128;

        for pool_id in 1..=config.total_pools_created {
            if let Some(pool) = env.storage().persistent().get::<StorageKey, StakingPool>(&StorageKey::Pool(pool_id)) {
                total_tvl += pool.total_staked;
            }
        }

        Ok(total_tvl)
    }

    /// Calculate APR from APY (Annual Percentage Rate vs Annual Percentage Yield)
    pub fn calculate_apr_from_apy(env: Env, apy: u64, compound_frequency: u64) -> u64 {
        // Simplified APR calculation
        // In a real implementation, this would use more complex mathematics
        // APR ≈ APY / (1 + APY/compound_frequency)^compound_frequency
        
        if compound_frequency == 0 {
            return apy; // If no compounding, APR = APY
        }

        // Simplified approximation for demonstration
        let adjustment = apy / (compound_frequency * 100);
        if apy > adjustment {
            apy - adjustment
        } else {
            apy
        }
    }

    /// Get pool utilization rate (current stake vs max stake)
    pub fn get_pool_utilization(env: Env, pool_id: u64) -> Result<u64, StakingError> {
        let pool: StakingPool = env.storage()
            .persistent()
            .get(&StorageKey::Pool(pool_id))
            .ok_or(StakingError::InvalidPool)?;

        if pool.max_total_stake == 0 {
            return Ok(0); // No limit, so 0% utilization metric
        }

        let utilization = (pool.total_staked * 10000) / pool.max_total_stake;
        Ok(utilization as u64) // Return as basis points (10000 = 100%)
    }
}