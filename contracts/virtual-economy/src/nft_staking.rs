//! NFT staking helper utilities.
//!
//! Provides reward calculation and analytics helpers used by the contract
//! entry-points in [`lib.rs`].

#![allow(dead_code)]

use crate::storage::{DataKey, NftStakeConfig, NftStakedPosition, NftStakingAnalytics};
use soroban_sdk::Env;

pub struct NftStakingManager;

impl NftStakingManager {
    /// Calculate pending (un-snapshotted) rewards for a staked position.
    ///
    /// Formula:
    ///   `rewards = rarity * reward_rate_bps * intervals_elapsed / 10_000`
    ///
    /// where `intervals_elapsed = elapsed_seconds / reward_interval`.
    pub fn calc_rewards(
        position: &NftStakedPosition,
        config: &NftStakeConfig,
        rarity: u32,
        now: u64,
    ) -> i128 {
        let elapsed = now.saturating_sub(position.last_reward_ts);
        if elapsed == 0 || config.reward_interval == 0 {
            return 0;
        }
        let intervals = elapsed / config.reward_interval;
        if intervals == 0 {
            return 0;
        }
        rarity as i128 * config.reward_rate_bps as i128 * intervals as i128 / 10_000
    }

    /// Increment the `total_staked` counter in the staking analytics.
    pub fn increment_staked(env: &Env) {
        let mut analytics: NftStakingAnalytics = env
            .storage()
            .instance()
            .get(&DataKey::NftStakingAnalytics)
            .unwrap_or(NftStakingAnalytics {
                total_staked: 0,
                total_rewards_distributed: 0,
                unique_stakers: 0,
            });
        analytics.total_staked += 1;
        env.storage()
            .instance()
            .set(&DataKey::NftStakingAnalytics, &analytics);
    }

    /// Decrement the `total_staked` counter and add `rewards` to
    /// `total_rewards_distributed`.
    pub fn decrement_staked(env: &Env, rewards: i128) {
        let mut analytics: NftStakingAnalytics = env
            .storage()
            .instance()
            .get(&DataKey::NftStakingAnalytics)
            .unwrap_or(NftStakingAnalytics {
                total_staked: 0,
                total_rewards_distributed: 0,
                unique_stakers: 0,
            });
        analytics.total_staked = analytics.total_staked.saturating_sub(1);
        analytics.total_rewards_distributed += rewards;
        env.storage()
            .instance()
            .set(&DataKey::NftStakingAnalytics, &analytics);
    }

    /// Record a reward distribution (used during claim without unstake).
    pub fn record_rewards_distributed(env: &Env, rewards: i128) {
        let mut analytics: NftStakingAnalytics = env
            .storage()
            .instance()
            .get(&DataKey::NftStakingAnalytics)
            .unwrap_or(NftStakingAnalytics {
                total_staked: 0,
                total_rewards_distributed: 0,
                unique_stakers: 0,
            });
        analytics.total_rewards_distributed += rewards;
        env.storage()
            .instance()
            .set(&DataKey::NftStakingAnalytics, &analytics);
    }
}
