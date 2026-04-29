#![no_std]

use arenax_events::staking as events;
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, BytesN, Env, Vec};

// ─── Storage Keys ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    AxToken,
    TournamentContract,
    DisputeContract,
    Stake(BytesN<32>, Address),
    TournamentInfo(BytesN<32>),
    UserStakeInfo(Address),
    // Reward staking (general, non-tournament)
    RewardStake(Address),
    RewardPool,
    RewardConfig,
    TotalRewardStaked,
    Paused,
}

// ─── Types ───────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TournamentState {
    NotStarted = 0,
    Active = 1,
    Completed = 2,
    Cancelled = 3,
}

/// Tier unlocked by staking amount (used for premium features & governance weight)
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum StakeTier {
    None = 0,
    Bronze = 1,   // ≥ 1 000 AX
    Silver = 2,   // ≥ 5 000 AX
    Gold = 3,     // ≥ 25 000 AX
    Platinum = 4, // ≥ 100 000 AX
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakeInfo {
    pub user: Address,
    pub tournament_id: BytesN<32>,
    pub amount: i128,
    pub staked_at: u64,
    pub is_locked: bool,
    pub can_withdraw: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TournamentInfo {
    pub tournament_id: BytesN<32>,
    pub state: u32,
    pub stake_requirement: i128,
    pub total_staked: i128,
    pub participant_count: u32,
    pub created_at: u64,
    pub completed_at: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserStakeInfo {
    pub user: Address,
    pub total_staked: i128,
    pub total_slashed: i128,
    pub active_tournaments: u32,
    pub completed_tournaments: u32,
}

/// General reward-staking position (separate from tournament stakes)
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardStakePosition {
    pub user: Address,
    pub amount: i128,
    pub staked_at: u64,
    /// Accumulated rewards not yet claimed
    pub pending_rewards: i128,
    /// Last ledger timestamp at which rewards were snapshotted
    pub last_reward_ts: u64,
    pub tier: u32,
    /// Governance voting weight = amount * tier_multiplier
    pub governance_weight: i128,
}

/// Global reward pool configuration
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardConfig {
    /// Annual reward rate in basis points (e.g. 1200 = 12 %)
    pub annual_rate_bps: u32,
    /// Minimum stake to earn rewards
    pub min_stake: i128,
    /// Seconds in a year (used for pro-rata calculation)
    pub secs_per_year: u64,
}

// ─── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct StakingManager;

#[contractimpl]
impl StakingManager {
    // ── Initialisation ───────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address, ax_token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::AxToken, &ax_token);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage()
            .instance()
            .set(&DataKey::TotalRewardStaked, &0i128);
        env.storage().instance().set(&DataKey::RewardPool, &0i128);
        env.storage().instance().set(
            &DataKey::RewardConfig,
            &RewardConfig {
                annual_rate_bps: 1200, // 12 % APY default
                min_stake: 1_000,
                secs_per_year: 31_536_000,
            },
        );
        events::emit_initialized(&env, &admin, &ax_token);
    }

    // ── Admin setters ────────────────────────────────────────────────────────

    pub fn set_ax_token(env: Env, ax_token: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::AxToken, &ax_token);
        events::emit_token_set(&env, &ax_token);
    }

    pub fn set_tournament_contract(env: Env, tournament_contract: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::TournamentContract, &tournament_contract);
        events::emit_tournament_contract_set(&env, &tournament_contract);
    }

    pub fn set_dispute_contract(env: Env, dispute_contract: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::DisputeContract, &dispute_contract);
        events::emit_dispute_contract_set(&env, &dispute_contract);
    }

    pub fn set_reward_config(env: Env, annual_rate_bps: u32, min_stake: i128) {
        Self::require_admin(&env);
        if annual_rate_bps > 10_000 {
            panic!("rate exceeds 100%");
        }
        let cfg = RewardConfig {
            annual_rate_bps,
            min_stake,
            secs_per_year: 31_536_000,
        };
        env.storage().instance().set(&DataKey::RewardConfig, &cfg);
    }

    /// Fund the reward pool (admin deposits AX tokens)
    pub fn fund_reward_pool(env: Env, funder: Address, amount: i128) {
        Self::require_not_paused(&env);
        funder.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let ax_token = Self::get_ax_token(env.clone());
        let contract_addr = env.current_contract_address();
        token::Client::new(&env, &ax_token).transfer(&funder, &contract_addr, &amount);
        let pool: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RewardPool)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::RewardPool, &(pool + amount));
    }

    // ── Reward Staking ───────────────────────────────────────────────────────

    /// Stake AX tokens for rewards, governance weight, and premium tier access.
    pub fn stake_for_rewards(env: Env, user: Address, amount: i128) {
        Self::require_not_paused(&env);
        user.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let cfg: RewardConfig = env
            .storage()
            .instance()
            .get(&DataKey::RewardConfig)
            .unwrap();
        if amount < cfg.min_stake {
            panic!("below minimum stake");
        }

        let ax_token = Self::get_ax_token(env.clone());
        let contract_addr = env.current_contract_address();
        token::Client::new(&env, &ax_token).transfer(&user, &contract_addr, &amount);

        let now = env.ledger().timestamp();
        let existing: Option<RewardStakePosition> = env
            .storage()
            .persistent()
            .get(&DataKey::RewardStake(user.clone()));

        let position = if let Some(mut pos) = existing {
            // Snapshot pending rewards before adding more stake
            pos.pending_rewards += Self::calc_pending(&pos, &cfg, now);
            pos.last_reward_ts = now;
            pos.amount += amount;
            pos.tier = Self::tier_for_amount(pos.amount) as u32;
            pos.governance_weight = Self::governance_weight(pos.amount, pos.tier);
            pos
        } else {
            let tier = Self::tier_for_amount(amount) as u32;
            RewardStakePosition {
                user: user.clone(),
                amount,
                staked_at: now,
                pending_rewards: 0,
                last_reward_ts: now,
                tier,
                governance_weight: Self::governance_weight(amount, tier),
            }
        };

        env.storage()
            .persistent()
            .set(&DataKey::RewardStake(user.clone()), &position);
        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalRewardStaked)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalRewardStaked, &(total + amount));

        events::emit_staked(&env, &user, &BytesN::from_array(&env, &[0u8; 32]), amount);
    }

    /// Claim accrued rewards without unstaking.
    pub fn claim_rewards(env: Env, user: Address) -> i128 {
        Self::require_not_paused(&env);
        user.require_auth();

        let cfg: RewardConfig = env
            .storage()
            .instance()
            .get(&DataKey::RewardConfig)
            .unwrap();
        let now = env.ledger().timestamp();
        let mut pos: RewardStakePosition = env
            .storage()
            .persistent()
            .get(&DataKey::RewardStake(user.clone()))
            .expect("no stake found");

        let accrued = Self::calc_pending(&pos, &cfg, now) + pos.pending_rewards;
        if accrued <= 0 {
            panic!("no rewards to claim");
        }

        let pool: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RewardPool)
            .unwrap_or(0);
        let payout = accrued.min(pool);
        if payout == 0 {
            panic!("reward pool empty");
        }

        pos.pending_rewards = 0;
        pos.last_reward_ts = now;
        env.storage()
            .persistent()
            .set(&DataKey::RewardStake(user.clone()), &pos);
        env.storage()
            .instance()
            .set(&DataKey::RewardPool, &(pool - payout));

        let ax_token = Self::get_ax_token(env.clone());
        let contract_addr = env.current_contract_address();
        token::Client::new(&env, &ax_token).transfer(&contract_addr, &user, &payout);

        events::emit_withdrawn(&env, &user, &BytesN::from_array(&env, &[0u8; 32]), payout);
        payout
    }

    /// Unstake all tokens (claims pending rewards first).
    pub fn unstake_rewards(env: Env, user: Address) {
        Self::require_not_paused(&env);
        user.require_auth();

        let cfg: RewardConfig = env
            .storage()
            .instance()
            .get(&DataKey::RewardConfig)
            .unwrap();
        let now = env.ledger().timestamp();
        let pos: RewardStakePosition = env
            .storage()
            .persistent()
            .get(&DataKey::RewardStake(user.clone()))
            .expect("no stake found");

        let accrued = Self::calc_pending(&pos, &cfg, now) + pos.pending_rewards;
        let pool: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RewardPool)
            .unwrap_or(0);
        let reward_payout = accrued.min(pool);

        let ax_token = Self::get_ax_token(env.clone());
        let contract_addr = env.current_contract_address();
        let client = token::Client::new(&env, &ax_token);

        // Return principal
        client.transfer(&contract_addr, &user, &pos.amount);
        // Pay rewards if any
        if reward_payout > 0 {
            client.transfer(&contract_addr, &user, &reward_payout);
            env.storage()
                .instance()
                .set(&DataKey::RewardPool, &(pool - reward_payout));
        }

        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalRewardStaked)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalRewardStaked, &(total - pos.amount).max(0));
        env.storage()
            .persistent()
            .remove(&DataKey::RewardStake(user.clone()));

        events::emit_withdrawn(
            &env,
            &user,
            &BytesN::from_array(&env, &[0u8; 32]),
            pos.amount,
        );
    }

    /// View pending rewards without claiming.
    pub fn pending_rewards(env: Env, user: Address) -> i128 {
        let cfg: RewardConfig = env
            .storage()
            .instance()
            .get(&DataKey::RewardConfig)
            .unwrap();
        let now = env.ledger().timestamp();
        if let Some(pos) = env
            .storage()
            .persistent()
            .get::<DataKey, RewardStakePosition>(&DataKey::RewardStake(user))
        {
            Self::calc_pending(&pos, &cfg, now) + pos.pending_rewards
        } else {
            0
        }
    }

    pub fn get_reward_stake(env: Env, user: Address) -> Option<RewardStakePosition> {
        env.storage().persistent().get(&DataKey::RewardStake(user))
    }

    pub fn get_governance_weight(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get::<DataKey, RewardStakePosition>(&DataKey::RewardStake(user))
            .map(|p| p.governance_weight)
            .unwrap_or(0)
    }

    pub fn get_stake_tier(env: Env, user: Address) -> u32 {
        env.storage()
            .persistent()
            .get::<DataKey, RewardStakePosition>(&DataKey::RewardStake(user))
            .map(|p| p.tier)
            .unwrap_or(0)
    }

    pub fn total_reward_staked(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalRewardStaked)
            .unwrap_or(0)
    }

    pub fn reward_pool_balance(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::RewardPool)
            .unwrap_or(0)
    }

    // ── Tournament Staking (unchanged API, kept for compatibility) ────────────

    pub fn create_tournament(env: Env, tournament_id: BytesN<32>, stake_requirement: i128) {
        Self::require_not_paused(&env);
        Self::require_admin(&env);
        if stake_requirement <= 0 {
            panic!("stake requirement must be positive");
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::TournamentInfo(tournament_id.clone()))
        {
            panic!("tournament already exists");
        }
        let info = TournamentInfo {
            tournament_id: tournament_id.clone(),
            state: TournamentState::NotStarted as u32,
            stake_requirement,
            total_staked: 0,
            participant_count: 0,
            created_at: env.ledger().timestamp(),
            completed_at: None,
        };
        env.storage()
            .persistent()
            .set(&DataKey::TournamentInfo(tournament_id.clone()), &info);
        events::emit_tournament_created(&env, &tournament_id, stake_requirement);
    }

    pub fn update_tournament_state(env: Env, tournament_id: BytesN<32>, state: u32) {
        Self::require_not_paused(&env);
        Self::require_admin(&env);
        let mut info: TournamentInfo = env
            .storage()
            .persistent()
            .get(&DataKey::TournamentInfo(tournament_id.clone()))
            .expect("tournament not found");
        info.state = state;
        if state == TournamentState::Completed as u32 || state == TournamentState::Cancelled as u32
        {
            info.completed_at = Some(env.ledger().timestamp());
        }
        env.storage()
            .persistent()
            .set(&DataKey::TournamentInfo(tournament_id.clone()), &info);
        events::emit_tournament_updated(&env, &tournament_id, state);
    }

    pub fn stake(env: Env, user: Address, tournament_id: BytesN<32>, amount: i128) {
        Self::require_not_paused(&env);
        user.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let info: TournamentInfo = env
            .storage()
            .persistent()
            .get(&DataKey::TournamentInfo(tournament_id.clone()))
            .expect("tournament not found");
        if info.state != TournamentState::Active as u32 {
            panic!("tournament not active");
        }
        if amount < info.stake_requirement {
            panic!("below stake requirement");
        }
        let stake_key = DataKey::Stake(tournament_id.clone(), user.clone());
        if env.storage().persistent().has(&stake_key) {
            panic!("already staked");
        }

        let ax_token = Self::get_ax_token(env.clone());
        token::Client::new(&env, &ax_token).transfer(
            &user,
            &env.current_contract_address(),
            &amount,
        );

        env.storage().persistent().set(
            &stake_key,
            &StakeInfo {
                user: user.clone(),
                tournament_id: tournament_id.clone(),
                amount,
                staked_at: env.ledger().timestamp(),
                is_locked: true,
                can_withdraw: false,
            },
        );
        let mut updated = info;
        updated.total_staked += amount;
        updated.participant_count += 1;
        env.storage()
            .persistent()
            .set(&DataKey::TournamentInfo(tournament_id.clone()), &updated);
        Self::update_user_stake_info(&env, &user, amount, 0, 1, 0);
        events::emit_staked(&env, &user, &tournament_id, amount);
    }

    pub fn withdraw(env: Env, user: Address, tournament_id: BytesN<32>) {
        Self::require_not_paused(&env);
        user.require_auth();
        let stake_key = DataKey::Stake(tournament_id.clone(), user.clone());
        let info: StakeInfo = env
            .storage()
            .persistent()
            .get(&stake_key)
            .expect("no stake");
        if !info.can_withdraw {
            panic!("stake not withdrawable");
        }
        token::Client::new(&env, &Self::get_ax_token(env.clone())).transfer(
            &env.current_contract_address(),
            &user,
            &info.amount,
        );
        env.storage().persistent().remove(&stake_key);
        Self::update_user_stake_info(&env, &user, -info.amount, 0, -1, 1);
        events::emit_withdrawn(&env, &user, &tournament_id, info.amount);
    }

    pub fn slash(
        env: Env,
        user: Address,
        tournament_id: BytesN<32>,
        amount: i128,
        slashed_by: Address,
    ) {
        Self::require_not_paused(&env);
        Self::require_dispute_contract_or_admin(&env, &slashed_by);
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let stake_key = DataKey::Stake(tournament_id.clone(), user.clone());
        let mut info: StakeInfo = env
            .storage()
            .persistent()
            .get(&stake_key)
            .expect("no stake");
        if amount > info.amount {
            panic!("slash exceeds stake");
        }
        let treasury: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        token::Client::new(&env, &Self::get_ax_token(env.clone())).transfer(
            &env.current_contract_address(),
            &treasury,
            &amount,
        );
        info.amount -= amount;
        if info.amount == 0 {
            env.storage().persistent().remove(&stake_key);
        } else {
            env.storage().persistent().set(&stake_key, &info);
        }
        let mut t: TournamentInfo = env
            .storage()
            .persistent()
            .get(&DataKey::TournamentInfo(tournament_id.clone()))
            .unwrap();
        t.total_staked -= amount;
        if info.amount == 0 {
            t.participant_count -= 1;
        }
        env.storage()
            .persistent()
            .set(&DataKey::TournamentInfo(tournament_id.clone()), &t);
        Self::update_user_stake_info(&env, &user, 0, amount, 0, 0);
        events::emit_slashed(&env, &user, &tournament_id, amount, &slashed_by);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    pub fn get_stake(env: Env, user: Address, tournament_id: BytesN<32>) -> StakeInfo {
        env.storage()
            .persistent()
            .get(&DataKey::Stake(tournament_id, user))
            .expect("stake not found")
    }

    pub fn get_tournament_info(env: Env, tournament_id: BytesN<32>) -> TournamentInfo {
        env.storage()
            .persistent()
            .get(&DataKey::TournamentInfo(tournament_id))
            .expect("tournament not found")
    }

    pub fn get_user_stake_info(env: Env, user: Address) -> UserStakeInfo {
        env.storage()
            .instance()
            .get(&DataKey::UserStakeInfo(user.clone()))
            .unwrap_or(UserStakeInfo {
                user,
                total_staked: 0,
                total_slashed: 0,
                active_tournaments: 0,
                completed_tournaments: 0,
            })
    }

    pub fn can_withdraw(env: Env, user: Address, tournament_id: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, StakeInfo>(&DataKey::Stake(tournament_id, user))
            .map(|s| s.can_withdraw)
            .unwrap_or(false)
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    pub fn get_ax_token(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::AxToken)
            .expect("AX token not set")
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn set_paused(env: Env, paused: bool) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Paused, &paused);
        events::emit_contract_paused(&env, paused, &env.current_contract_address());
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    /// Pro-rata reward: principal * rate * elapsed / (secs_per_year * 10_000)
    fn calc_pending(pos: &RewardStakePosition, cfg: &RewardConfig, now: u64) -> i128 {
        let elapsed = now.saturating_sub(pos.last_reward_ts) as i128;
        pos.amount * cfg.annual_rate_bps as i128 * elapsed / (cfg.secs_per_year as i128 * 10_000)
    }

    fn tier_for_amount(amount: i128) -> StakeTier {
        if amount >= 100_000 {
            StakeTier::Platinum
        } else if amount >= 25_000 {
            StakeTier::Gold
        } else if amount >= 5_000 {
            StakeTier::Silver
        } else if amount >= 1_000 {
            StakeTier::Bronze
        } else {
            StakeTier::None
        }
    }

    /// Governance weight = amount * (1 + tier * 0.25), scaled ×100
    fn governance_weight(amount: i128, tier: u32) -> i128 {
        amount * (100 + tier as i128 * 25) / 100
    }

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
    }

    fn require_not_paused(env: &Env) {
        if env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Paused)
            .unwrap_or(false)
        {
            panic!("contract is paused");
        }
    }

    fn require_dispute_contract_or_admin(env: &Env, caller: &Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if caller == &admin {
            return;
        }
        if let Some(dc) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::DisputeContract)
        {
            if caller == &dc {
                return;
            }
        }
        panic!("caller not authorized");
    }

    fn update_user_stake_info(
        env: &Env,
        user: &Address,
        staked: i128,
        slashed: i128,
        active_d: i32,
        completed_d: i32,
    ) {
        let mut info: UserStakeInfo = env
            .storage()
            .instance()
            .get(&DataKey::UserStakeInfo(user.clone()))
            .unwrap_or(UserStakeInfo {
                user: user.clone(),
                total_staked: 0,
                total_slashed: 0,
                active_tournaments: 0,
                completed_tournaments: 0,
            });
        info.total_staked += staked;
        info.total_slashed += slashed;
        info.active_tournaments = (info.active_tournaments as i32 + active_d) as u32;
        info.completed_tournaments = (info.completed_tournaments as i32 + completed_d) as u32;
        env.storage()
            .instance()
            .set(&DataKey::UserStakeInfo(user.clone()), &info);
    }
}
