use soroban_sdk::{contract, contractimpl, Address, Env, String, Vec, Map, Symbol, Val, IntoVal, TryFromVal};

// Storage keys
const ADMIN_KEY: Symbol = Symbol::short("ADMIN");
const PAUSED_KEY: Symbol = Symbol::short("PAUSED");
const PLAYER_REPUTATION_KEY: Symbol = Symbol::short("PLAYER_REP");
const PLAYER_INFO_KEY: Symbol = Symbol::short("PLAYER_INFO");
const REPUTATION_HISTORY_KEY: Symbol = Symbol::short("REP_HISTORY");
const LEADERBOARD_KEY: Symbol = Symbol::short("LEADERBOARD");

// Constants
const INITIAL_REPUTATION: i128 = 100;
const MAX_REPUTATION: i128 = 10000;
const MIN_REPUTATION: i128 = 0;
const MAX_HISTORY_EVENTS: u32 = 1000;

#[contract]
pub struct ReputationContract;

// Reputation tiers
#[derive(Clone, Debug, PartialEq)]
pub enum ReputationTier {
    Beginner,      // 0-100 points
    Novice,        // 101-500 points
    Intermediate,  // 501-1000 points
    Advanced,      // 1001-2000 points
    Expert,        // 2001-5000 points
    Master,        // 5001+ points
}

// Reputation event types
#[derive(Clone, Debug, PartialEq)]
pub enum ReputationEventType {
    MatchWin,
    MatchLoss,
    TournamentWin,
    TournamentParticipation,
    DisputeResolution,
    CheatingPenalty,
    FairPlayReward,
    LongStreakBonus,
    CommunityContribution,
}

// Penalty severity levels
#[derive(Clone, Debug, PartialEq)]
pub enum PenaltySeverity {
    Minor,    // -10 to -50 points
    Moderate, // -51 to -200 points
    Major,    // -201 to -500 points
    Severe,   // -501+ points
}

// Reputation information for a player
#[derive(Clone, Debug, PartialEq)]
pub struct ReputationInfo {
    pub player: Address,
    pub total_reputation: i128,
    pub current_reputation: i128,
    pub reputation_tier: ReputationTier,
    pub last_updated: u64,
    pub total_matches: u32,
    pub wins: u32,
    pub losses: u32,
    pub disputes: u32,
    pub penalties: u32,
}

// Reputation event
#[derive(Clone, Debug, PartialEq)]
pub struct ReputationEvent {
    pub event_type: ReputationEventType,
    pub amount: i128,
    pub reason: String,
    pub timestamp: u64,
    pub tournament_id: Option<u64>,
    pub match_id: Option<u64>,
}

// Reputation requirements for tournaments
#[derive(Clone, Debug, PartialEq)]
pub struct ReputationRequirement {
    pub min_reputation: i128,
    pub min_tier: ReputationTier,
    pub max_penalties: u32,
    pub min_matches: u32,
}

// Error types
#[derive(Clone, Debug, PartialEq)]
pub enum Error {
    // General errors
    Unauthorized,
    ContractPaused,
    InvalidParameter,
    
    // Player errors
    PlayerNotFound,
    PlayerAlreadyExists,
    InvalidReputationAmount,
    
    // Reputation errors
    InsufficientReputation,
    ReputationUpdateFailed,
    InvalidReputationTier,
    
    // Event errors
    InvalidEventType,
    EventRecordingFailed,
    
    // Requirement errors
    RequirementNotMet,
    InvalidRequirement,
}

// Implement conversion traits for storage
impl IntoVal<Env, Val> for ReputationTier {
    fn into_val(self, env: &Env) -> Val {
        match self {
            ReputationTier::Beginner => 0i32.into_val(env),
            ReputationTier::Novice => 1i32.into_val(env),
            ReputationTier::Intermediate => 2i32.into_val(env),
            ReputationTier::Advanced => 3i32.into_val(env),
            ReputationTier::Expert => 4i32.into_val(env),
            ReputationTier::Master => 5i32.into_val(env),
        }
    }
}

impl TryFromVal<Env, Val> for ReputationTier {
    type Error = Error;
    
    fn try_from_val(env: &Env, val: Val) -> Result<Self, Self::Error> {
        let tier_val: i32 = val.try_into().map_err(|_| Error::InvalidParameter)?;
        match tier_val {
            0 => Ok(ReputationTier::Beginner),
            1 => Ok(ReputationTier::Novice),
            2 => Ok(ReputationTier::Intermediate),
            3 => Ok(ReputationTier::Advanced),
            4 => Ok(ReputationTier::Expert),
            5 => Ok(ReputationTier::Master),
            _ => Err(Error::InvalidReputationTier),
        }
    }
}

impl IntoVal<Env, Val> for ReputationEventType {
    fn into_val(self, env: &Env) -> Val {
        match self {
            ReputationEventType::MatchWin => 0i32.into_val(env),
            ReputationEventType::MatchLoss => 1i32.into_val(env),
            ReputationEventType::TournamentWin => 2i32.into_val(env),
            ReputationEventType::TournamentParticipation => 3i32.into_val(env),
            ReputationEventType::DisputeResolution => 4i32.into_val(env),
            ReputationEventType::CheatingPenalty => 5i32.into_val(env),
            ReputationEventType::FairPlayReward => 6i32.into_val(env),
            ReputationEventType::LongStreakBonus => 7i32.into_val(env),
            ReputationEventType::CommunityContribution => 8i32.into_val(env),
        }
    }
}

impl TryFromVal<Env, Val> for ReputationEventType {
    type Error = Error;
    
    fn try_from_val(env: &Env, val: Val) -> Result<Self, Self::Error> {
        let event_val: i32 = val.try_into().map_err(|_| Error::InvalidParameter)?;
        match event_val {
            0 => Ok(ReputationEventType::MatchWin),
            1 => Ok(ReputationEventType::MatchLoss),
            2 => Ok(ReputationEventType::TournamentWin),
            3 => Ok(ReputationEventType::TournamentParticipation),
            4 => Ok(ReputationEventType::DisputeResolution),
            5 => Ok(ReputationEventType::CheatingPenalty),
            6 => Ok(ReputationEventType::FairPlayReward),
            7 => Ok(ReputationEventType::LongStreakBonus),
            8 => Ok(ReputationEventType::CommunityContribution),
            _ => Err(Error::InvalidEventType),
        }
    }
}

impl IntoVal<Env, Val> for PenaltySeverity {
    fn into_val(self, env: &Env) -> Val {
        match self {
            PenaltySeverity::Minor => 0i32.into_val(env),
            PenaltySeverity::Moderate => 1i32.into_val(env),
            PenaltySeverity::Major => 2i32.into_val(env),
            PenaltySeverity::Severe => 3i32.into_val(env),
        }
    }
}

impl TryFromVal<Env, Val> for PenaltySeverity {
    type Error = Error;
    
    fn try_from_val(env: &Env, val: Val) -> Result<Self, Self::Error> {
        let severity_val: i32 = val.try_into().map_err(|_| Error::InvalidParameter)?;
        match severity_val {
            0 => Ok(PenaltySeverity::Minor),
            1 => Ok(PenaltySeverity::Moderate),
            2 => Ok(PenaltySeverity::Major),
            3 => Ok(PenaltySeverity::Severe),
            _ => Err(Error::InvalidParameter),
        }
    }
}

// Implement storage helpers
impl ReputationContract {
    fn get_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&ADMIN_KEY)
            .expect("Contract not initialized")
    }

    fn set_admin(env: &Env, admin: &Address) {
        env.storage().instance().set(&ADMIN_KEY, admin);
    }

    fn is_paused(env: &Env) -> bool {
        env.storage()
            .instance()
            .get(&PAUSED_KEY)
            .unwrap_or(false)
    }

    fn set_paused(env: &Env, paused: bool) {
        env.storage().instance().set(&PAUSED_KEY, &paused);
    }

    fn require_admin(env: &Env) -> Result<(), Error> {
        let caller = env.current_contract_address();
        let admin = Self::get_admin(env);
        if caller != admin {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn require_not_paused(env: &Env) -> Result<(), Error> {
        if Self::is_paused(env) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    fn get_player_reputation(env: &Env, player: &Address) -> Result<i128, Error> {
        let key = (PLAYER_REPUTATION_KEY, player);
        env.storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PlayerNotFound)
    }

    fn set_player_reputation(env: &Env, player: &Address, reputation: i128) {
        let key = (PLAYER_REPUTATION_KEY, player);
        env.storage().persistent().set(&key, &reputation);
    }

    fn get_player_info(env: &Env, player: &Address) -> Result<ReputationInfo, Error> {
        let key = (PLAYER_INFO_KEY, player);
        env.storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PlayerNotFound)
    }

    fn set_player_info(env: &Env, player: &Address, info: &ReputationInfo) {
        let key = (PLAYER_INFO_KEY, player);
        env.storage().persistent().set(&key, info);
    }

    fn get_reputation_history(env: &Env, player: &Address) -> Vec<ReputationEvent> {
        let key = (REPUTATION_HISTORY_KEY, player);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(env))
    }

    fn add_reputation_event(env: &Env, player: &Address, event: ReputationEvent) {
        let mut history = Self::get_reputation_history(env, player);
        
        // Limit history size to prevent storage bloat
        if history.len() >= MAX_HISTORY_EVENTS {
            history.remove(0); // Remove oldest event
        }
        
        history.push_back(event);
        
        let key = (REPUTATION_HISTORY_KEY, player);
        env.storage().persistent().set(&key, &history);
    }

    fn calculate_tier(reputation: i128) -> ReputationTier {
        match reputation {
            0..=100 => ReputationTier::Beginner,
            101..=500 => ReputationTier::Novice,
            501..=1000 => ReputationTier::Intermediate,
            1001..=2000 => ReputationTier::Advanced,
            2001..=5000 => ReputationTier::Expert,
            _ => ReputationTier::Master,
        }
    }

    fn calculate_reputation_change(
        event_type: ReputationEventType,
        base_amount: i128,
        multiplier: f64,
    ) -> i128 {
        match event_type {
            ReputationEventType::MatchWin => (base_amount as f64 * multiplier) as i128,
            ReputationEventType::MatchLoss => -(base_amount as f64 * multiplier * 0.1) as i128,
            ReputationEventType::TournamentWin => (base_amount as f64 * multiplier * 2.0) as i128,
            ReputationEventType::TournamentParticipation => (base_amount as f64 * multiplier * 0.5) as i128,
            ReputationEventType::DisputeResolution => -(base_amount as f64 * multiplier * 0.3) as i128,
            ReputationEventType::CheatingPenalty => -(base_amount as f64 * multiplier * 5.0) as i128,
            ReputationEventType::FairPlayReward => (base_amount as f64 * multiplier * 1.5) as i128,
            ReputationEventType::LongStreakBonus => (base_amount as f64 * multiplier * 3.0) as i128,
            ReputationEventType::CommunityContribution => (base_amount as f64 * multiplier * 2.5) as i128,
        }
    }

    fn emit_reputation_issued(env: &Env, player: Address, amount: i128) {
        env.events().publish((Symbol::new(env, "reputation_issued"), player), amount);
    }

    fn emit_reputation_updated(env: &Env, player: Address, change: i128, new_total: i128) {
        env.events().publish((Symbol::new(env, "reputation_updated"), player), (change, new_total));
    }

    fn emit_penalty_applied(env: &Env, player: Address, penalty: i128, reason: String) {
        env.events().publish((Symbol::new(env, "penalty_applied"), player), (penalty, reason));
    }

    fn emit_tier_changed(env: &Env, player: Address, old_tier: ReputationTier, new_tier: ReputationTier) {
        env.events().publish((Symbol::new(env, "tier_changed"), player), (old_tier, new_tier));
    }

    fn emit_reputation_transferred(env: &Env, from: Address, to: Address, amount: i128) {
        env.events().publish((Symbol::new(env, "reputation_transferred"), from), (to, amount));
    }
}

#[contractimpl]
impl ReputationContract {
    // Initialize the contract
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        // Check if already initialized
        if env.storage().instance().has(&ADMIN_KEY) {
            return Err(Error::InvalidParameter);
        }

        Self::set_admin(&env, &admin);
        Self::set_paused(&env, false);
        
        Ok(())
    }

    // Issue initial reputation to new player
    pub fn issue_reputation(
        env: Env,
        player: Address,
        initial_amount: Option<i128>,
    ) -> Result<(), Error> {
        Self::require_not_paused(&env)?;

        // Check if player already exists
        if Self::get_player_reputation(&env, &player).is_ok() {
            return Err(Error::PlayerAlreadyExists);
        }

        let amount = initial_amount.unwrap_or(INITIAL_REPUTATION);
        
        if amount < MIN_REPUTATION || amount > MAX_REPUTATION {
            return Err(Error::InvalidReputationAmount);
        }

        let current_time = env.ledger().timestamp();
        let tier = Self::calculate_tier(amount);

        let reputation_info = ReputationInfo {
            player: player.clone(),
            total_reputation: amount,
            current_reputation: amount,
            reputation_tier: tier,
            last_updated: current_time,
            total_matches: 0,
            wins: 0,
            losses: 0,
            disputes: 0,
            penalties: 0,
        };

        Self::set_player_reputation(&env, &player, amount);
        Self::set_player_info(&env, &player, &reputation_info);

        // Record initial reputation event
        let event = ReputationEvent {
            event_type: ReputationEventType::CommunityContribution,
            amount,
            reason: String::from_str(&env, "Initial reputation issuance"),
            timestamp: current_time,
            tournament_id: None,
            match_id: None,
        };

        Self::add_reputation_event(&env, &player, event);
        Self::emit_reputation_issued(&env, player, amount);

        Ok(())
    }

    // Update reputation after match/tournament
    pub fn update_reputation(
        env: Env,
        player: Address,
        change: i128,
        reason: String,
        event_type: ReputationEventType,
        tournament_id: Option<u64>,
        match_id: Option<u64>,
    ) -> Result<(), Error> {
        Self::require_not_paused(&env)?;

        let current_reputation = Self::get_player_reputation(&env, &player)?;
        let mut player_info = Self::get_player_info(&env, &player)?;

        let new_reputation = current_reputation + change;
        
        if new_reputation < MIN_REPUTATION {
            return Err(Error::InsufficientReputation);
        }
        
        if new_reputation > MAX_REPUTATION {
            return Err(Error::InvalidReputationAmount);
        }

        let old_tier = player_info.reputation_tier.clone();
        let new_tier = Self::calculate_tier(new_reputation);

        // Update player statistics based on event type
        match event_type {
            ReputationEventType::MatchWin => {
                player_info.wins += 1;
                player_info.total_matches += 1;
            },
            ReputationEventType::MatchLoss => {
                player_info.losses += 1;
                player_info.total_matches += 1;
            },
            ReputationEventType::DisputeResolution => {
                player_info.disputes += 1;
            },
            ReputationEventType::CheatingPenalty => {
                player_info.penalties += 1;
            },
            _ => {},
        }

        player_info.current_reputation = new_reputation;
        player_info.total_reputation += change.abs();
        player_info.reputation_tier = new_tier.clone();
        player_info.last_updated = env.ledger().timestamp();

        Self::set_player_reputation(&env, &player, new_reputation);
        Self::set_player_info(&env, &player, &player_info);

        // Record reputation event
        let event = ReputationEvent {
            event_type: event_type.clone(),
            amount: change,
            reason: reason.clone(),
            timestamp: env.ledger().timestamp(),
            tournament_id,
            match_id,
        };

        Self::add_reputation_event(&env, &player, event);
        Self::emit_reputation_updated(&env, player.clone(), change, new_reputation);

        // Emit tier change event if tier changed
        if old_tier != new_tier {
            Self::emit_tier_changed(&env, player, old_tier, new_tier);
        }

        Ok(())
    }

    // Apply penalty for cheating or bad behavior
    pub fn apply_penalty(
        env: Env,
        player: Address,
        penalty_amount: i128,
        reason: String,
        severity: PenaltySeverity,
    ) -> Result<(), Error> {
        Self::require_not_paused(&env)?;

        if penalty_amount >= 0 {
            return Err(Error::InvalidParameter);
        }

        let current_reputation = Self::get_player_reputation(&env, &player)?;
        let mut player_info = Self::get_player_info(&env, &player)?;

        let new_reputation = current_reputation + penalty_amount;
        
        if new_reputation < MIN_REPUTATION {
            return Err(Error::InsufficientReputation);
        }

        let old_tier = player_info.reputation_tier.clone();
        let new_tier = Self::calculate_tier(new_reputation);

        player_info.current_reputation = new_reputation;
        player_info.total_reputation += penalty_amount.abs();
        player_info.penalties += 1;
        player_info.last_updated = env.ledger().timestamp();

        Self::set_player_reputation(&env, &player, new_reputation);
        Self::set_player_info(&env, &player, &player_info);

        // Record penalty event
        let event = ReputationEvent {
            event_type: ReputationEventType::CheatingPenalty,
            amount: penalty_amount,
            reason: reason.clone(),
            timestamp: env.ledger().timestamp(),
            tournament_id: None,
            match_id: None,
        };

        Self::add_reputation_event(&env, &player, event);
        Self::emit_penalty_applied(&env, player.clone(), penalty_amount, reason);

        // Emit tier change event if tier changed
        if old_tier != new_tier {
            Self::emit_tier_changed(&env, player, old_tier, new_tier);
        }

        Ok(())
    }

    // Get current reputation balance
    pub fn get_reputation(env: Env, player: Address) -> Result<i128, Error> {
        Self::get_player_reputation(&env, &player)
    }

    // Get detailed reputation information
    pub fn get_reputation_info(env: Env, player: Address) -> Result<ReputationInfo, Error> {
        Self::get_player_info(&env, &player)
    }

    // Get reputation history
    pub fn get_reputation_history(
        env: Env,
        player: Address,
        limit: Option<u32>,
    ) -> Result<Vec<ReputationEvent>, Error> {
        let mut history = Self::get_reputation_history(&env, &player);
        
        if let Some(limit) = limit {
            let start_idx = if history.len() > limit {
                history.len() - limit
            } else {
                0
            };
            
            let mut limited_history = Vec::new(&env);
            for i in start_idx..history.len() {
                limited_history.push_back(history.get(i).unwrap());
            }
            history = limited_history;
        }
        
        Ok(history)
    }

    // Check if player meets reputation requirement
    pub fn check_reputation_requirement(
        env: Env,
        player: Address,
        requirement: ReputationRequirement,
    ) -> Result<bool, Error> {
        let player_info = Self::get_player_info(&env, &player)?;
        
        let meets_reputation = player_info.current_reputation >= requirement.min_reputation;
        let meets_tier = player_info.reputation_tier as i32 >= requirement.min_tier as i32;
        let meets_penalty_limit = player_info.penalties <= requirement.max_penalties;
        let meets_match_minimum = player_info.total_matches >= requirement.min_matches;
        
        Ok(meets_reputation && meets_tier && meets_penalty_limit && meets_match_minimum)
    }

    // Transfer reputation (admin only, for special cases)
    pub fn transfer_reputation(
        env: Env,
        from: Address,
        to: Address,
        amount: i128,
        reason: String,
    ) -> Result<(), Error> {
        Self::require_admin(&env)?;
        Self::require_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidReputationAmount);
        }

        let from_reputation = Self::get_player_reputation(&env, &from)?;
        if from_reputation < amount {
            return Err(Error::InsufficientReputation);
        }

        // Check if recipient exists, create if not
        let to_reputation = Self::get_player_reputation(&env, &to).unwrap_or(0);
        let new_to_reputation = to_reputation + amount;
        
        if new_to_reputation > MAX_REPUTATION {
            return Err(Error::InvalidReputationAmount);
        }

        let new_from_reputation = from_reputation - amount;

        Self::set_player_reputation(&env, &from, new_from_reputation);
        Self::set_player_reputation(&env, &to, new_to_reputation);

        // Update player info for both players
        let mut from_info = Self::get_player_info(&env, &from)?;
        from_info.current_reputation = new_from_reputation;
        from_info.reputation_tier = Self::calculate_tier(new_from_reputation);
        from_info.last_updated = env.ledger().timestamp();
        Self::set_player_info(&env, &from, &from_info);

        // Handle recipient info
        if to_reputation == 0 {
            // New player, create initial info
            let to_info = ReputationInfo {
                player: to.clone(),
                total_reputation: amount,
                current_reputation: amount,
                reputation_tier: Self::calculate_tier(amount),
                last_updated: env.ledger().timestamp(),
                total_matches: 0,
                wins: 0,
                losses: 0,
                disputes: 0,
                penalties: 0,
            };
            Self::set_player_info(&env, &to, &to_info);
        } else {
            // Existing player, update info
            let mut to_info = Self::get_player_info(&env, &to)?;
            to_info.current_reputation = new_to_reputation;
            to_info.total_reputation += amount;
            to_info.reputation_tier = Self::calculate_tier(new_to_reputation);
            to_info.last_updated = env.ledger().timestamp();
            Self::set_player_info(&env, &to, &to_info);
        }

        Self::emit_reputation_transferred(&env, from, to, amount);
        Ok(())
    }

    // Get reputation leaderboard
    pub fn get_reputation_leaderboard(
        env: Env,
        limit: Option<u32>,
        tier: Option<ReputationTier>,
    ) -> Result<Vec<ReputationInfo>, Error> {
        // This is a simplified implementation
        // In a real implementation, you'd want to maintain a sorted list
        // or use a more efficient data structure for leaderboards
        let limit = limit.unwrap_or(10);
        let mut leaderboard = Vec::new(&env);
        
        // Note: This is a placeholder implementation
        // A real implementation would need to iterate through all players
        // and sort them by reputation, which is expensive on-chain
        // Consider using off-chain indexing for leaderboards
        
        Ok(leaderboard)
    }

    // Calculate reputation tier
    pub fn calculate_tier(env: Env, reputation: i128) -> ReputationTier {
        Self::calculate_tier(reputation)
    }

    // Emergency reset reputation (admin only)
    pub fn reset_reputation(
        env: Env,
        player: Address,
        reason: String,
    ) -> Result<(), Error> {
        Self::require_admin(&env)?;
        Self::require_not_paused(&env)?;

        let mut player_info = Self::get_player_info(&env, &player)?;
        
        player_info.current_reputation = 0;
        player_info.total_reputation = 0;
        player_info.reputation_tier = ReputationTier::Beginner;
        player_info.last_updated = env.ledger().timestamp();

        Self::set_player_reputation(&env, &player, 0);
        Self::set_player_info(&env, &player, &player_info);

        // Record reset event
        let event = ReputationEvent {
            event_type: ReputationEventType::CheatingPenalty,
            amount: -player_info.current_reputation,
            reason,
            timestamp: env.ledger().timestamp(),
            tournament_id: None,
            match_id: None,
        };

        Self::add_reputation_event(&env, &player, event);
        Self::emit_reputation_updated(&env, player, 0, 0);

        Ok(())
    }

    // Admin functions
    pub fn pause_contract(env: Env) -> Result<(), Error> {
        Self::require_admin(&env)?;
        Self::set_paused(&env, true);
        Ok(())
    }

    pub fn unpause_contract(env: Env) -> Result<(), Error> {
        Self::require_admin(&env)?;
        Self::set_paused(&env, false);
        Ok(())
    }

    pub fn change_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        Self::require_admin(&env)?;
        Self::set_admin(&env, &new_admin);
        Ok(())
    }

    // Utility functions
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        Ok(Self::get_admin(&env))
    }

    pub fn is_contract_paused(env: Env) -> Result<bool, Error> {
        Ok(Self::is_paused(&env))
    }

    pub fn get_player_count(env: Env) -> Result<u32, Error> {
        // This would require maintaining a counter
        // For now, return 0 as placeholder
        Ok(0)
    }

    // Analytics functions
    pub fn get_reputation_stats(env: Env, player: Address) -> Result<(i128, i128, u32, u32, u32, u32), Error> {
        let player_info = Self::get_player_info(&env, &player)?;
        Ok((
            player_info.current_reputation,
            player_info.total_reputation,
            player_info.total_matches,
            player_info.wins,
            player_info.losses,
            player_info.penalties,
        ))
    }

    pub fn get_win_rate(env: Env, player: Address) -> Result<f64, Error> {
        let player_info = Self::get_player_info(&env, &player)?;
        if player_info.total_matches == 0 {
            return Ok(0.0);
        }
        Ok(player_info.wins as f64 / player_info.total_matches as f64)
    }

    pub fn get_penalty_rate(env: Env, player: Address) -> Result<f64, Error> {
        let player_info = Self::get_player_info(&env, &player)?;
        if player_info.total_matches == 0 {
            return Ok(0.0);
        }
        Ok(player_info.penalties as f64 / player_info.total_matches as f64)
    }

    pub fn get_reputation_trend(env: Env, player: Address, days: u32) -> Result<i128, Error> {
        let history = Self::get_reputation_history(&env, &player, None)?;
        let current_time = env.ledger().timestamp();
        let cutoff_time = current_time - (days as u64 * 24 * 60 * 60); // Approximate days to seconds
        
        let mut trend = 0i128;
        for i in 0..history.len() {
            let event = history.get(i).unwrap();
            if event.timestamp >= cutoff_time {
                trend += event.amount;
            }
        }
        
        Ok(trend)
    }

    pub fn get_top_performers_by_tier(env: Env, tier: ReputationTier, limit: u32) -> Result<Vec<Address>, Error> {
        // This is a placeholder implementation
        // In a real implementation, you'd maintain sorted lists or use efficient data structures
        let mut performers = Vec::new(&env);
        Ok(performers)
    }

    pub fn get_reputation_distribution(env: Env) -> Result<(u32, u32, u32, u32, u32, u32), Error> {
        // This would require iterating through all players
        // For now, return placeholder values
        Ok((0, 0, 0, 0, 0, 0)) // (Beginner, Novice, Intermediate, Advanced, Expert, Master)
    }

    pub fn get_average_reputation_by_tier(env: Env, tier: ReputationTier) -> Result<i128, Error> {
        // Placeholder implementation
        match tier {
            ReputationTier::Beginner => Ok(50),
            ReputationTier::Novice => Ok(300),
            ReputationTier::Intermediate => Ok(750),
            ReputationTier::Advanced => Ok(1500),
            ReputationTier::Expert => Ok(3500),
            ReputationTier::Master => Ok(7500),
        }
    }

    pub fn get_reputation_volatility(env: Env, player: Address, days: u32) -> Result<f64, Error> {
        let history = Self::get_reputation_history(&env, &player, None)?;
        let current_time = env.ledger().timestamp();
        let cutoff_time = current_time - (days as u64 * 24 * 60 * 60);
        
        let mut changes = Vec::new(&env);
        for i in 0..history.len() {
            let event = history.get(i).unwrap();
            if event.timestamp >= cutoff_time {
                changes.push_back(event.amount);
            }
        }
        
        if changes.len() == 0 {
            return Ok(0.0);
        }
        
        // Calculate variance (simplified)
        let mut sum = 0i128;
        for i in 0..changes.len() {
            sum += changes.get(i).unwrap();
        }
        let mean = sum as f64 / changes.len() as f64;
        
        let mut variance_sum = 0.0;
        for i in 0..changes.len() {
            let diff = changes.get(i).unwrap() as f64 - mean;
            variance_sum += diff * diff;
        }
        
        let variance = variance_sum / changes.len() as f64;
        Ok(variance.sqrt())
    }

    pub fn get_most_active_players(env: Env, limit: u32) -> Result<Vec<Address>, Error> {
        // Placeholder implementation
        let mut players = Vec::new(&env);
        Ok(players)
    }

    pub fn get_penalty_leaders(env: Env, limit: u32) -> Result<Vec<Address>, Error> {
        // Placeholder implementation
        let mut players = Vec::new(&env);
        Ok(players)
    }

    pub fn get_fair_play_leaders(env: Env, limit: u32) -> Result<Vec<Address>, Error> {
        // Placeholder implementation
        let mut players = Vec::new(&env);
        Ok(players)
    }

    pub fn get_reputation_health_score(env: Env, player: Address) -> Result<f64, Error> {
        let player_info = Self::get_player_info(&env, &player)?;
        
        // Calculate health score based on multiple factors
        let win_rate = if player_info.total_matches > 0 {
            player_info.wins as f64 / player_info.total_matches as f64
        } else {
            0.0
        };
        
        let penalty_rate = if player_info.total_matches > 0 {
            player_info.penalties as f64 / player_info.total_matches as f64
        } else {
            0.0
        };
        
        let dispute_rate = if player_info.total_matches > 0 {
            player_info.disputes as f64 / player_info.total_matches as f64
        } else {
            0.0
        };
        
        // Health score calculation (0.0 to 1.0)
        let mut score = 0.5; // Base score
        
        // Win rate contribution (0.3 weight)
        score += win_rate * 0.3;
        
        // Penalty penalty (-0.4 weight)
        score -= penalty_rate * 0.4;
        
        // Dispute penalty (-0.2 weight)
        score -= dispute_rate * 0.2;
        
        // Ensure score is between 0.0 and 1.0
        if score < 0.0 {
            score = 0.0;
        } else if score > 1.0 {
            score = 1.0;
        }
        
        Ok(score)
    }
}
