//! Slashing functionality for the ArenaX Staking Contract

use soroban_sdk::{Address, Env, String, token};
use crate::types::*;

impl crate::StakingContract {
    /// Slash a user's stake (admin only)
    pub fn slash_user(
        env: Env,
        admin: Address,
        user: Address,
        pool_id: u64,
        slash_amount: i128,
        reason: String,
    ) -> Result<(), StakingError> {
        admin.require_auth();

        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        // Verify admin permissions
        if admin != config.admin {
            return Err(StakingError::Unauthorized);
        }

        let mut pool: StakingPool = env.storage()
            .persistent()
            .get(&StorageKey::Pool(pool_id))
            .ok_or(StakingError::InvalidPool)?;

        let stake_key = StorageKey::UserStake(user.clone(), pool_id);
        let mut user_stake: UserStake = env.storage()
            .persistent()
            .get(&stake_key)
            .ok_or(StakingError::InvalidPool)?;

        if slash_amount > user_stake.amount {
            return Err(StakingError::InsufficientBalance);
        }

        let current_time = env.ledger().timestamp();

        // Calculate and add pending rewards before slashing
        let pending_rewards = Self::calculate_pending_rewards(&env, &user_stake, &pool, current_time)?;
        user_stake.pending_rewards += pending_rewards;

        // Apply slash
        user_stake.amount -= slash_amount;
        user_stake.last_reward_claim = current_time;

        // Update reputation multiplier (slash reduces reputation)
        let reputation_penalty = 500; // 5% reduction in reputation multiplier
        user_stake.reputation_multiplier = user_stake.reputation_multiplier.saturating_sub(reputation_penalty);
        
        // Ensure reputation multiplier doesn't go below 10% (1000 basis points)
        if user_stake.reputation_multiplier < 1000 {
            user_stake.reputation_multiplier = 1000;
        }

        // Update pool total
        pool.total_staked -= slash_amount;

        // Create slash record
        let slash_record = SlashRecord {
            user: user.clone(),
            amount: slash_amount,
            reason: reason.clone(),
            slashed_at: current_time,
            slashed_by: admin.clone(),
            pool_id,
        };

        // Store updated data
        env.storage().persistent().set(&stake_key, &user_stake);
        env.storage().persistent().set(&StorageKey::Pool(pool_id), &pool);
        env.storage().persistent().set(&StorageKey::SlashRecord(user.clone(), current_time), &slash_record);

        // Update user's total staked amount
        let total_staked_key = StorageKey::UserTotalStaked(user.clone());
        let mut user_total_staked: i128 = env.storage()
            .persistent()
            .get(&total_staked_key)
            .unwrap_or(0);
        user_total_staked -= slash_amount;
        env.storage().persistent().set(&total_staked_key, &user_total_staked);

        // Transfer slashed tokens to fee collector (or burn them)
        let token_client = token::Client::new(&env, &config.token_address);
        token_client.transfer(&env.current_contract_address(), &config.fee_collector, &slash_amount);

        // Emit event
        let event = StakingEvent::UserSlashed {
            user,
            amount: slash_amount,
            reason,
            timestamp: current_time,
        };
        env.events().publish(("slashing_event", "user_slashed"), event);

        Ok(())
    }

    /// Mass slash multiple users (admin only) - for gas optimization
    pub fn mass_slash(
        env: Env,
        admin: Address,
        slash_data: Vec<(Address, u64, i128, String)>, // (user, pool_id, amount, reason)
    ) -> Result<(), StakingError> {
        admin.require_auth();

        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        // Verify admin permissions
        if admin != config.admin {
            return Err(StakingError::Unauthorized);
        }

        let current_time = env.ledger().timestamp();
        let token_client = token::Client::new(&env, &config.token_address);
        let mut total_slashed = 0i128;

        for (user, pool_id, slash_amount, reason) in slash_data.iter() {
            let mut pool: StakingPool = env.storage()
                .persistent()
                .get(&StorageKey::Pool(*pool_id))
                .ok_or(StakingError::InvalidPool)?;

            let stake_key = StorageKey::UserStake(user.clone(), *pool_id);
            let mut user_stake: UserStake = env.storage()
                .persistent()
                .get(&stake_key)
                .ok_or(StakingError::InvalidPool)?;

            if *slash_amount > user_stake.amount {
                continue; // Skip invalid slashes
            }

            // Calculate and add pending rewards before slashing
            let pending_rewards = Self::calculate_pending_rewards(&env, &user_stake, &pool, current_time)?;
            user_stake.pending_rewards += pending_rewards;

            // Apply slash
            user_stake.amount -= slash_amount;
            user_stake.last_reward_claim = current_time;

            // Update reputation multiplier
            let reputation_penalty = 500; // 5% reduction
            user_stake.reputation_multiplier = user_stake.reputation_multiplier.saturating_sub(reputation_penalty);
            if user_stake.reputation_multiplier < 1000 {
                user_stake.reputation_multiplier = 1000;
            }

            // Update pool total
            pool.total_staked -= slash_amount;

            // Create slash record
            let slash_record = SlashRecord {
                user: user.clone(),
                amount: *slash_amount,
                reason: reason.clone(),
                slashed_at: current_time,
                slashed_by: admin.clone(),
                pool_id: *pool_id,
            };

            // Store updated data
            env.storage().persistent().set(&stake_key, &user_stake);
            env.storage().persistent().set(&StorageKey::Pool(*pool_id), &pool);
            env.storage().persistent().set(&StorageKey::SlashRecord(user.clone(), current_time), &slash_record);

            // Update user's total staked amount
            let total_staked_key = StorageKey::UserTotalStaked(user.clone());
            let mut user_total_staked: i128 = env.storage()
                .persistent()
                .get(&total_staked_key)
                .unwrap_or(0);
            user_total_staked -= slash_amount;
            env.storage().persistent().set(&total_staked_key, &user_total_staked);

            total_slashed += slash_amount;

            // Emit event for each slash
            let event = StakingEvent::UserSlashed {
                user: user.clone(),
                amount: *slash_amount,
                reason: reason.clone(),
                timestamp: current_time,
            };
            env.events().publish(("slashing_event", "user_slashed"), event);
        }

        // Transfer all slashed tokens at once for gas efficiency
        if total_slashed > 0 {
            token_client.transfer(&env.current_contract_address(), &config.fee_collector, &total_slashed);
        }

        Ok(())
    }

    /// Automatic slashing for specific violations
    pub fn auto_slash(
        env: Env,
        user: Address,
        pool_id: u64,
        violation_type: String,
    ) -> Result<(), StakingError> {
        // This function can be called by authorized contracts or oracles
        // to automatically slash users for specific violations
        
        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        let stake_key = StorageKey::UserStake(user.clone(), pool_id);
        let user_stake: UserStake = env.storage()
            .persistent()
            .get(&stake_key)
            .ok_or(StakingError::InvalidPool)?;

        // Define slash amounts for different violation types
        let slash_amount = match violation_type.as_str() {
            "governance_violation" => user_stake.amount * 10 / 100, // 10% slash
            "malicious_behavior" => user_stake.amount * 25 / 100,   // 25% slash
            "protocol_violation" => user_stake.amount * 5 / 100,    // 5% slash
            _ => return Err(StakingError::InvalidParameters),
        };

        // Call the main slash function
        Self::slash_user(env, config.admin, user, pool_id, slash_amount, violation_type)
    }

    /// Get user's slash history
    pub fn get_user_slash_history(
        env: Env,
        user: Address,
    ) -> Vec<SlashRecord> {
        // In a real implementation, this would iterate through slash records
        // For now, we'll return an empty vector as this requires more complex indexing
        Vec::new(&env)
    }

    /// Restore user reputation (admin only) - for cases where slashing was incorrect
    pub fn restore_reputation(
        env: Env,
        admin: Address,
        user: Address,
        pool_id: u64,
        reputation_boost: u64,
    ) -> Result<(), StakingError> {
        admin.require_auth();

        let config: ContractConfig = env.storage()
            .persistent()
            .get(&StorageKey::Config)
            .ok_or(StakingError::InvalidParameters)?;

        if admin != config.admin {
            return Err(StakingError::Unauthorized);
        }

        let stake_key = StorageKey::UserStake(user.clone(), pool_id);
        let mut user_stake: UserStake = env.storage()
            .persistent()
            .get(&stake_key)
            .ok_or(StakingError::InvalidPool)?;

        // Restore reputation (but cap at 150% maximum)
        user_stake.reputation_multiplier = (user_stake.reputation_multiplier + reputation_boost).min(15000);

        env.storage().persistent().set(&stake_key, &user_stake);

        Ok(())
    }

    /// Check if user is eligible for slashing based on behavior patterns
    pub fn check_slash_eligibility(
        env: Env,
        user: Address,
        pool_id: u64,
    ) -> Result<bool, StakingError> {
        let stake_key = StorageKey::UserStake(user, pool_id);
        let user_stake: UserStake = env.storage()
            .persistent()
            .get(&stake_key)
            .ok_or(StakingError::InvalidPool)?;

        // Simple heuristics for slash eligibility
        // In a real implementation, this would involve complex analysis
        
        // Users with very low reputation multiplier might be eligible for further slashing
        let is_low_reputation = user_stake.reputation_multiplier < 5000; // Below 50%
        
        // Users who frequently request unstaking might be trying to game the system
        let is_frequent_unstaker = user_stake.unstake_requested_at > 0;

        Ok(is_low_reputation || is_frequent_unstaker)
    }

    /// Set slashing parameters for a pool (admin only)
    pub fn set_pool_slashing_parameters(
        env: Env,
        admin: Address,
        pool_id: u64,
        early_withdrawal_penalty: u64,
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

        if early_withdrawal_penalty > 10000 {
            return Err(StakingError::InvalidParameters);
        }

        pool.early_withdrawal_penalty = early_withdrawal_penalty;
        env.storage().persistent().set(&StorageKey::Pool(pool_id), &pool);

        Ok(())
    }
}