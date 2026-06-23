#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardParams {
    pub annual_rate_bps: u32,
    pub min_lock_period: u64,
    pub max_lock_period: u64,
    pub early_unstake_penalty_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakingPosition {
    pub user: Address,
    pub amount: i128,
    pub lock_period: u64,
    pub staked_at: u64,
    pub last_reward_at: u64,
    pub pending_rewards: i128,
    pub governance_weight: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StakingPositionOption {
    None,
    Some(StakingPosition),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakingInfo {
    pub position: StakingPositionOption,
    pub claimable_rewards: i128,
    pub reward_pool: i128,
    pub total_staked: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Token,
    Paused,
    Params,
    RewardPool,
    TotalStaked,
    Stake(Address),
    EpochDistributed(u64),
    GlobalPauseContract,
}

#[contract]
pub struct StakingRewardsContract;

#[contractimpl]
impl StakingRewardsContract {
    pub fn initialize(env: Env, admin: Address, token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::RewardPool, &0i128);
        env.storage().instance().set(&DataKey::TotalStaked, &0i128);
        env.storage().instance().set(&DataKey::Params, &RewardParams {
            annual_rate_bps: 1200,
            min_lock_period: 0,
            max_lock_period: 31_536_000,
            early_unstake_penalty_bps: 500,
        });
    }

    pub fn stake_tokens(env: Env, user: Address, amount: i128, lock_period: u64) {
        Self::require_not_paused(&env);
        user.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let params: RewardParams = env.storage().instance().get(&DataKey::Params).expect("params missing");
        if lock_period < params.min_lock_period || lock_period > params.max_lock_period {
            panic!("invalid lock period");
        }

        let token = Self::token(&env);
        token::Client::new(&env, &token).transfer(&user, &env.current_contract_address(), &amount);

        let now = env.ledger().timestamp();
        let key = DataKey::Stake(user.clone());
        let position = if let Some(mut current) = env.storage().persistent().get::<DataKey, StakingPosition>(&key) {
            current.pending_rewards += Self::calculate_position_rewards(&current, &params, now);
            current.amount += amount;
            current.lock_period = current.lock_period.max(lock_period);
            current.last_reward_at = now;
            current.governance_weight = Self::governance_weight(current.amount, current.lock_period);
            current
        } else {
            StakingPosition {
                user: user.clone(),
                amount,
                lock_period,
                staked_at: now,
                last_reward_at: now,
                pending_rewards: 0,
                governance_weight: Self::governance_weight(amount, lock_period),
            }
        };

        env.storage().persistent().set(&key, &position);
        let total = env.storage().instance().get::<DataKey, i128>(&DataKey::TotalStaked).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalStaked, &(total + amount));
        env.events().publish((soroban_sdk::symbol_short!("STAKED"), user), (amount, lock_period));
    }

    pub fn unstake_tokens(env: Env, user: Address, amount: i128) {
        Self::require_not_paused(&env);
        user.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let params: RewardParams = env.storage().instance().get(&DataKey::Params).expect("params missing");
        let key = DataKey::Stake(user.clone());
        let mut position: StakingPosition = env.storage().persistent().get(&key).expect("stake not found");
        if amount > position.amount {
            panic!("insufficient staked amount");
        }

        let now = env.ledger().timestamp();
        position.pending_rewards += Self::calculate_position_rewards(&position, &params, now);
        let unlocked_at = position.staked_at + position.lock_period;
        let penalty = if now < unlocked_at {
            amount * params.early_unstake_penalty_bps as i128 / 10_000
        } else {
            0
        };
        let payout = amount - penalty;

        position.amount -= amount;
        position.last_reward_at = now;
        position.governance_weight = Self::governance_weight(position.amount, position.lock_period);
        if position.amount == 0 {
            env.storage().persistent().remove(&key);
        } else {
            env.storage().persistent().set(&key, &position);
        }

        let total = env.storage().instance().get::<DataKey, i128>(&DataKey::TotalStaked).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalStaked, &(total - amount).max(0));
        let token = Self::token(&env);
        token::Client::new(&env, &token).transfer(&env.current_contract_address(), &user, &payout);
        if penalty > 0 {
            let pool = env.storage().instance().get::<DataKey, i128>(&DataKey::RewardPool).unwrap_or(0);
            env.storage().instance().set(&DataKey::RewardPool, &(pool + penalty));
        }
        env.events().publish((soroban_sdk::symbol_short!("UNSTAKED"), user), (amount, payout));
    }

    pub fn calculate_rewards(env: Env, user: Address, period: u64) -> i128 {
        let params: RewardParams = env.storage().instance().get(&DataKey::Params).expect("params missing");
        if let Some(position) = env.storage().persistent().get::<DataKey, StakingPosition>(&DataKey::Stake(user)) {
            let synthetic_now = position.last_reward_at + period;
            Self::calculate_position_rewards(&position, &params, synthetic_now) + position.pending_rewards
        } else {
            0
        }
    }

    pub fn distribute_rewards(env: Env, epoch: u64) {
        Self::require_admin(&env);
        if env.storage().persistent().has(&DataKey::EpochDistributed(epoch)) {
            panic!("epoch already distributed");
        }

        let total = env.storage().instance().get::<DataKey, i128>(&DataKey::TotalStaked).unwrap_or(0);
        let pool = env.storage().instance().get::<DataKey, i128>(&DataKey::RewardPool).unwrap_or(0);
        let distribution = pool.min(total / 100);
        env.storage().instance().set(&DataKey::RewardPool, &(pool - distribution));
        env.storage().persistent().set(&DataKey::EpochDistributed(epoch), &distribution);
        env.events().publish((soroban_sdk::symbol_short!("REWARD"), epoch), distribution);
    }

    pub fn claim_rewards(env: Env, user: Address) -> i128 {
        Self::require_not_paused(&env);
        user.require_auth();
        let params: RewardParams = env.storage().instance().get(&DataKey::Params).expect("params missing");
        let key = DataKey::Stake(user.clone());
        let mut position: StakingPosition = env.storage().persistent().get(&key).expect("stake not found");
        let now = env.ledger().timestamp();
        let rewards = position.pending_rewards + Self::calculate_position_rewards(&position, &params, now);
        if rewards <= 0 {
            panic!("no rewards");
        }

        let pool = env.storage().instance().get::<DataKey, i128>(&DataKey::RewardPool).unwrap_or(0);
        let payout = rewards.min(pool);
        if payout <= 0 {
            panic!("reward pool empty");
        }

        position.pending_rewards = rewards - payout;
        position.last_reward_at = now;
        env.storage().persistent().set(&key, &position);
        env.storage().instance().set(&DataKey::RewardPool, &(pool - payout));
        let token = Self::token(&env);
        token::Client::new(&env, &token).transfer(&env.current_contract_address(), &user, &payout);
        payout
    }

    pub fn get_staking_info(env: Env, user: Address) -> StakingInfo {
        let position_opt = env.storage().persistent().get::<DataKey, StakingPosition>(&DataKey::Stake(user.clone()));
        let reward_pool = env.storage().instance().get::<DataKey, i128>(&DataKey::RewardPool).unwrap_or(0);
        let total_staked = env.storage().instance().get::<DataKey, i128>(&DataKey::TotalStaked).unwrap_or(0);
        let claimable_rewards = position_opt.clone()
            .map(|p| {
                let params: RewardParams = env.storage().instance().get(&DataKey::Params).expect("params missing");
                Self::calculate_position_rewards(&p, &params, env.ledger().timestamp()) + p.pending_rewards
            })
            .unwrap_or(0);

        let position = match position_opt {
            Some(pos) => StakingPositionOption::Some(pos),
            None => StakingPositionOption::None,
        };

        StakingInfo {
            position,
            claimable_rewards,
            reward_pool,
            total_staked,
        }
    }

    pub fn update_reward_parameters(env: Env, new_params: RewardParams) {
        Self::require_admin(&env);
        if new_params.annual_rate_bps > 10_000 || new_params.early_unstake_penalty_bps > 10_000 {
            panic!("invalid reward parameters");
        }
        if new_params.min_lock_period > new_params.max_lock_period {
            panic!("invalid lock range");
        }
        env.storage().instance().set(&DataKey::Params, &new_params);
        env.events().publish((soroban_sdk::symbol_short!("PARAMS"),), new_params.annual_rate_bps);
    }

    pub fn fund_reward_pool(env: Env, funder: Address, amount: i128) {
        Self::require_not_paused(&env);
        funder.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let token = Self::token(&env);
        token::Client::new(&env, &token).transfer(&funder, &env.current_contract_address(), &amount);
        let pool = env.storage().instance().get::<DataKey, i128>(&DataKey::RewardPool).unwrap_or(0);
        env.storage().instance().set(&DataKey::RewardPool, &(pool + amount));
    }

    pub fn get_governance_weight(env: Env, user: Address) -> i128 {
        env.storage().persistent()
            .get::<DataKey, StakingPosition>(&DataKey::Stake(user))
            .map(|p| p.governance_weight)
            .unwrap_or(0)
    }

    pub fn list_epoch_distributions(env: Env, epochs: Vec<u64>) -> Vec<i128> {
        let mut values = Vec::new(&env);
        let mut i = 0;
        while i < epochs.len() {
            let epoch = epochs.get(i).expect("epoch");
            values.push_back(env.storage().persistent().get::<DataKey, i128>(&DataKey::EpochDistributed(epoch)).unwrap_or(0));
            i += 1;
        }
        values
    }

    pub fn set_paused(env: Env, paused: bool) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Paused, &paused);
    }

    pub fn set_global_pause_contract(env: Env, global_pause: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::GlobalPauseContract, &global_pause);
    }

    fn calculate_position_rewards(position: &StakingPosition, params: &RewardParams, now: u64) -> i128 {
        let elapsed = now.saturating_sub(position.last_reward_at) as i128;
        let lock_multiplier_bps = 10_000 + (position.lock_period.min(31_536_000) as i128 * 5_000 / 31_536_000);
        position.amount * params.annual_rate_bps as i128 * lock_multiplier_bps * elapsed
            / (31_536_000i128 * 10_000 * 10_000)
    }

    fn governance_weight(amount: i128, lock_period: u64) -> i128 {
        let lock_bonus_bps = lock_period.min(31_536_000) as i128 * 5_000 / 31_536_000;
        amount * (10_000 + lock_bonus_bps) / 10_000
    }

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        admin.require_auth();
    }

    fn require_not_paused(env: &Env) {
        if env.storage().instance().get::<DataKey, bool>(&DataKey::Paused).unwrap_or(false) {
            panic!("contract is paused");
        }
        if let Some(global_pause) = env.storage().instance().get::<DataKey, Address>(&DataKey::GlobalPauseContract) {
            use soroban_sdk::IntoVal;
            let is_paused: bool = env.invoke_contract(
                &global_pause,
                &soroban_sdk::Symbol::new(env, "is_paused"),
                (env.current_contract_address(), Option::<soroban_sdk::Symbol>::None).into_val(env),
            );
            if is_paused {
                panic!("contract execution is paused");
            }
        }
    }

    fn token(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::Token).expect("token not set")
    }
}
