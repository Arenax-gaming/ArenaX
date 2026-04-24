#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, Env, Map, String, Vec};

mod test;

// Sanction types
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SanctionType {
    Warning,
    TemporaryBan,
    PermanentBan,
    ReputationPenalty,
    PrizeForfeiture,
}

// Sanction status
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SanctionStatus {
    Active,
    Appealed,
    Upheld,
    Overturned,
    Expired,
}

// Behavior pattern types
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BehaviorPattern {
    AbnormalReactionTime,
    ImpossibleMovement,
    StatisticalAnomaly,
    NetworkManipulation,
    ExploitUsage,
    Other,
}

// Suspicious activity report
#[contracttype]
#[derive(Clone, Debug)]
pub struct SuspiciousActivity {
    pub report_id: u64,
    pub reporter: Address,
    pub player: Address,
    pub match_id: u64,
    pub pattern: BehaviorPattern,
    pub evidence: Bytes,
    pub severity: u32, // 1-10
    pub timestamp: u64,
    pub verified: bool,
}

// Sanction record
#[contracttype]
#[derive(Clone, Debug)]
pub struct Sanction {
    pub sanction_id: u64,
    pub player: Address,
    pub sanction_type: SanctionType,
    pub status: SanctionStatus,
    pub reason: String,
    pub duration: u64, // 0 for permanent
    pub start_time: u64,
    pub end_time: u64,
    pub appeal_deadline: u64,
}

// Appeal record
#[contracttype]
#[derive(Clone, Debug)]
pub struct Appeal {
    pub appeal_id: u64,
    pub sanction_id: u64,
    pub player: Address,
    pub reason: String,
    pub evidence: Bytes,
    pub submitted_at: u64,
    pub reviewed: bool,
    pub approved: bool,
}

// Player trust score
#[contracttype]
#[derive(Clone, Debug)]
pub struct TrustScore {
    pub player: Address,
    pub score: u32, // 0-100
    pub total_reports: u32,
    pub confirmed_cheats: u32,
    pub false_reports: u32,
    pub last_updated: u64,
}

// Anti-cheat parameters
#[contracttype]
#[derive(Clone, Debug)]
pub struct AntiCheatParams {
    pub trust_threshold: u32,     // Below this triggers review
    pub report_cooldown: u64,     // Time between reports
    pub appeal_window: u64,       // Time to appeal
    pub severity_multiplier: u32, // Multiplier for repeated offenses
    pub max_reports_per_match: u32,
}

// Storage keys
#[contracttype]
pub enum DataKey {
    Admin,
    ReputationContract,
    ReportCounter,
    SanctionCounter,
    AppealCounter,
    Report(u64),
    Sanction(u64),
    Appeal(u64),
    TrustScore(Address),
    PlayerReports(Address, u64), // player, match_id
    AntiCheatParams,
}

// Anti-cheat contract
#[contract]
pub struct AntiCheatContract;

#[contractimpl]
impl AntiCheatContract {
    // Initialize the anti-cheat contract
    pub fn initialize(env: Env, admin: Address, reputation_contract: Address) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        env.storage().persistent().set(&DataKey::Admin, &admin);

        env.storage()
            .persistent()
            .set(&DataKey::ReputationContract, &reputation_contract);

        // Set default anti-cheat parameters
        let params = AntiCheatParams {
            trust_threshold: 30,
            report_cooldown: 3600, // 1 hour
            appeal_window: 604800, // 7 days
            severity_multiplier: 2,
            max_reports_per_match: 5,
        };

        env.storage()
            .persistent()
            .set(&DataKey::AntiCheatParams, &params);

        env.storage()
            .persistent()
            .set(&DataKey::ReportCounter, &0u64);

        env.storage()
            .persistent()
            .set(&DataKey::SanctionCounter, &0u64);

        env.storage()
            .persistent()
            .set(&DataKey::AppealCounter, &0u64);
    }

    // Report suspicious activity
    pub fn report_suspicious_activity(
        env: Env,
        reporter: Address,
        player: Address,
        match_id: u64,
        pattern: BehaviorPattern,
        evidence: Bytes,
        severity: u32,
    ) -> u64 {
        let params: AntiCheatParams = env
            .storage()
            .persistent()
            .get(&DataKey::AntiCheatParams)
            .expect("params not found");

        // Validate severity
        if severity == 0 || severity > 10 {
            panic!("invalid severity");
        }

        // Check report cooldown
        let report_key = DataKey::PlayerReports(player.clone(), match_id);
        if let Some(last_report_time) = env.storage().persistent().get::<DataKey, u64>(&report_key)
        {
            let current_time = env.ledger().timestamp();
            if current_time - last_report_time < params.report_cooldown {
                panic!("report cooldown not met");
            }
        }

        // Check max reports per match
        let counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ReportCounter)
            .unwrap_or(0);
        let report_id = counter + 1;
        env.storage()
            .persistent()
            .set(&DataKey::ReportCounter, &report_id);

        let current_time = env.ledger().timestamp();

        let activity = SuspiciousActivity {
            report_id,
            reporter: reporter.clone(),
            player: player.clone(),
            match_id,
            pattern: pattern.clone(),
            evidence: evidence.clone(),
            severity,
            timestamp: current_time,
            verified: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Report(report_id), &activity);

        // Update last report time
        env.storage().persistent().set(&report_key, &current_time);

        // Update trust score
        Self::update_trust_score(&env, &player, severity, false);

        // Emit event
        arenax_events::anti_cheat::emit_suspicious_activity_reported(
            &env,
            &reporter,
            &player,
            match_id,
            pattern as u32,
            severity,
            report_id,
        );

        report_id
    }

    // Validate game action
    pub fn validate_game_action(
        env: Env,
        player: Address,
        action: Bytes,
        game_state: Bytes,
    ) -> bool {
        let trust_score: Option<TrustScore> = env
            .storage()
            .persistent()
            .get(&DataKey::TrustScore(player.clone()));

        if let Some(score) = trust_score {
            // If trust score is below threshold, require additional validation
            let params: AntiCheatParams = env
                .storage()
                .persistent()
                .get(&DataKey::AntiCheatParams)
                .expect("params not found");

            if score.score < params.trust_threshold {
                // Perform additional validation checks
                // In production, this would involve more sophisticated analysis
                return Self::perform_deep_validation(&env, &action, &game_state);
            }
        }

        // Basic validation passes
        true
    }

    // Calculate cheat probability
    pub fn calculate_cheat_probability(env: Env, player: Address, behavior_data: Bytes) -> u32 {
        let trust_score: Option<TrustScore> = env
            .storage()
            .persistent()
            .get(&DataKey::TrustScore(player.clone()));

        let base_probability = if let Some(score) = trust_score {
            // Lower trust score = higher cheat probability
            (100 - score.score) as u32
        } else {
            50 // Default medium probability
        };

        // Analyze behavior data (simplified)
        // In production, this would use ML models or statistical analysis
        let behavior_factor = Self::analyze_behavior(&env, &behavior_data);

        let probability = (base_probability + behavior_factor) / 2;

        // Clamp to 0-100
        if probability > 100 {
            100
        } else {
            probability
        }
    }

    // Apply sanction to player
    pub fn apply_sanction(
        env: Env,
        player: Address,
        sanction_type: SanctionType,
        reason: String,
        duration: u64,
    ) -> u64 {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("not initialized");

        admin.require_auth();

        let params: AntiCheatParams = env
            .storage()
            .persistent()
            .get(&DataKey::AntiCheatParams)
            .expect("params not found");

        let counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::SanctionCounter)
            .unwrap_or(0);
        let sanction_id = counter + 1;
        env.storage()
            .persistent()
            .set(&DataKey::SanctionCounter, &sanction_id);

        let current_time = env.ledger().timestamp();
        let end_time = if duration == 0 {
            u64::MAX // Permanent
        } else {
            current_time + duration
        };

        let appeal_deadline = current_time + params.appeal_window;

        let sanction = Sanction {
            sanction_id,
            player: player.clone(),
            sanction_type: sanction_type.clone(),
            status: SanctionStatus::Active,
            reason: reason.clone(),
            duration,
            start_time: current_time,
            end_time,
            appeal_deadline,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Sanction(sanction_id), &sanction);

        // Update trust score significantly
        Self::update_trust_score(&env, &player, 10, true);

        // Emit event
        arenax_events::anti_cheat::emit_sanction_applied(
            &env,
            &player,
            sanction_id,
            sanction_type as u32,
            &reason,
            duration,
        );

        sanction_id
    }

    // Appeal a sanction
    pub fn appeal_sanction(
        env: Env,
        player: Address,
        sanction_id: u64,
        reason: String,
        evidence: Bytes,
    ) -> u64 {
        let mut sanction: Sanction = env
            .storage()
            .persistent()
            .get(&DataKey::Sanction(sanction_id))
            .expect("sanction not found");

        if sanction.player != player {
            panic!("not your sanction");
        }

        if sanction.status != SanctionStatus::Active {
            panic!("sanction not active");
        }

        let current_time = env.ledger().timestamp();
        if current_time > sanction.appeal_deadline {
            panic!("appeal deadline passed");
        }

        let counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::AppealCounter)
            .unwrap_or(0);
        let appeal_id = counter + 1;
        env.storage()
            .persistent()
            .set(&DataKey::AppealCounter, &appeal_id);

        let appeal = Appeal {
            appeal_id,
            sanction_id,
            player: player.clone(),
            reason: reason.clone(),
            evidence: evidence.clone(),
            submitted_at: current_time,
            reviewed: false,
            approved: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Appeal(appeal_id), &appeal);

        // Update sanction status
        sanction.status = SanctionStatus::Appealed;
        env.storage()
            .persistent()
            .set(&DataKey::Sanction(sanction_id), &sanction);

        // Emit event
        arenax_events::anti_cheat::emit_sanction_appealed(
            &env,
            &player,
            sanction_id,
            appeal_id,
            &reason,
        );

        appeal_id
    }

    // Review appeal (admin only)
    pub fn review_appeal(env: Env, appeal_id: u64, approved: bool) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("not initialized");

        admin.require_auth();

        let mut appeal: Appeal = env
            .storage()
            .persistent()
            .get(&DataKey::Appeal(appeal_id))
            .expect("appeal not found");

        if appeal.reviewed {
            panic!("appeal already reviewed");
        }

        appeal.reviewed = true;
        appeal.approved = approved;
        env.storage()
            .persistent()
            .set(&DataKey::Appeal(appeal_id), &appeal);

        // Update sanction status
        let mut sanction: Sanction = env
            .storage()
            .persistent()
            .get(&DataKey::Sanction(appeal.sanction_id))
            .expect("sanction not found");

        if approved {
            sanction.status = SanctionStatus::Overturned;
            // Restore trust score
            Self::restore_trust_score(&env, &sanction.player);
        } else {
            sanction.status = SanctionStatus::Upheld;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Sanction(appeal.sanction_id), &sanction);

        // Emit event
        arenax_events::anti_cheat::emit_appeal_reviewed(&env, appeal_id, approved);
    }

    // Get player trust score
    pub fn get_player_trust_score(env: Env, player: Address) -> TrustScore {
        env.storage()
            .persistent()
            .get(&DataKey::TrustScore(player))
            .unwrap_or(TrustScore {
                player,
                score: 100, // Default perfect score
                total_reports: 0,
                confirmed_cheats: 0,
                false_reports: 0,
                last_updated: env.ledger().timestamp(),
            })
    }

    // Get suspicious activity report
    pub fn get_report(env: Env, report_id: u64) -> SuspiciousActivity {
        env.storage()
            .persistent()
            .get(&DataKey::Report(report_id))
            .expect("report not found")
    }

    // Get sanction
    pub fn get_sanction(env: Env, sanction_id: u64) -> Sanction {
        env.storage()
            .persistent()
            .get(&DataKey::Sanction(sanction_id))
            .expect("sanction not found")
    }

    // Get appeal
    pub fn get_appeal(env: Env, appeal_id: u64) -> Appeal {
        env.storage()
            .persistent()
            .get(&DataKey::Appeal(appeal_id))
            .expect("appeal not found")
    }

    // Update anti-cheat parameters (admin only)
    pub fn update_anticheat_params(env: Env, caller: Address, params: AntiCheatParams) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("not initialized");

        if caller != admin {
            panic!("only admin can update parameters");
        }

        env.storage()
            .persistent()
            .set(&DataKey::AntiCheatParams, &params);
    }

    // Verify suspicious activity (admin only)
    pub fn verify_activity(env: Env, caller: Address, report_id: u64, verified: bool) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("not initialized");

        if caller != admin {
            panic!("only admin can verify activity");
        }

        let mut activity: SuspiciousActivity = env
            .storage()
            .persistent()
            .get(&DataKey::Report(report_id))
            .expect("report not found");

        activity.verified = verified;
        env.storage()
            .persistent()
            .set(&DataKey::Report(report_id), &activity);

        if verified {
            // Apply automatic sanction for verified cheating
            Self::apply_sanction(
                env,
                activity.player.clone(),
                SanctionType::ReputationPenalty,
                String::from_str(&env, "Verified suspicious activity"),
                0,
            );
        }
    }

    // Helper: Update trust score
    fn update_trust_score(env: &Env, player: &Address, severity: u32, is_confirmed_cheat: bool) {
        let mut trust_score: TrustScore = env
            .storage()
            .persistent()
            .get(&DataKey::TrustScore(player.clone()))
            .unwrap_or(TrustScore {
                player: player.clone(),
                score: 100,
                total_reports: 0,
                confirmed_cheats: 0,
                false_reports: 0,
                last_updated: env.ledger().timestamp(),
            });

        trust_score.total_reports += 1;

        if is_confirmed_cheat {
            trust_score.confirmed_cheats += 1;
            // Significant penalty for confirmed cheats
            let penalty = (severity as u32 * 5).min(50);
            trust_score.score = trust_score.score.saturating_sub(penalty);
        } else {
            // Smaller penalty for unverified reports
            let penalty = (severity as u32).min(10);
            trust_score.score = trust_score.score.saturating_sub(penalty);
        }

        trust_score.last_updated = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::TrustScore(player.clone()), &trust_score);
    }

    // Helper: Restore trust score
    fn restore_trust_score(env: &Env, player: &Address) {
        let mut trust_score: TrustScore = env
            .storage()
            .persistent()
            .get(&DataKey::TrustScore(player.clone()))
            .expect("trust score not found");

        // Restore score (partial restoration)
        trust_score.score = (trust_score.score + 30).min(100);
        trust_score.last_updated = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::TrustScore(player.clone()), &trust_score);
    }

    // Helper: Perform deep validation
    fn perform_deep_validation(env: &Env, action: &Bytes, game_state: &Bytes) -> bool {
        // Simplified deep validation
        // In production, this would analyze action patterns against game state
        // For now, return true (pass) for demonstration
        true
    }

    // Helper: Analyze behavior
    fn analyze_behavior(env: &Env, behavior_data: &Bytes) -> u32 {
        // Simplified behavior analysis
        // In production, this would use ML models or statistical analysis
        // For now, return a moderate factor based on data length
        let len = behavior_data.len();
        if len > 100 {
            30
        } else if len > 50 {
            20
        } else {
            10
        }
    }
}
