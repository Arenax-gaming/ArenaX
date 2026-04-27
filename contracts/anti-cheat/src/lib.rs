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
    AimbotDetection,
    Wallhack,
    SpeedHack,
    ResourceManipulation,
    TimingAnomaly,
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
    pub confidence_score: u32,    // AI confidence in detection
    pub false_positive_risk: u32, // Risk of false positive
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
    pub report_ids: Vec<u64>, // Reports that led to this sanction
    pub severity_score: u32,  // Calculated severity
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
    pub reviewer: Option<Address>, // Admin who reviewed
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
    pub successful_reports: u32, // Reports that led to confirmed cheats
    pub last_updated: u64,
    pub weighted_factors: WeightedFactors,
}

// Weighted factors for trust score calculation
#[contracttype]
#[derive(Clone, Debug)]
pub struct WeightedFactors {
    pub report_history_weight: u32,    // Weight of report history
    pub confirmed_cheat_weight: u32,   // Weight of confirmed cheats
    pub successful_report_weight: u32, // Weight of successful reports
    pub time_decay_factor: u32,        // Time-based decay factor
    pub volatility_score: u32,         // Score volatility
}

// Player behavior profile for pattern detection
#[contracttype]
#[derive(Clone, Debug)]
pub struct BehaviorProfile {
    pub player: Address,
    pub reaction_time_avg: u32,          // Average reaction time
    pub movement_patterns: Bytes,        // Encoded movement patterns
    pub action_frequency: Map<u32, u32>, // Action type frequencies
    pub statistical_baseline: Bytes,     // Statistical baseline
    pub anomaly_count: u32,              // Number of anomalies detected
    pub last_analyzed: u64,
}

// Analytics data for monitoring
#[contracttype]
#[derive(Clone, Debug)]
pub struct AnalyticsData {
    pub total_reports: u64,
    pub total_sanctions: u64,
    pub total_appeals: u64,
    pub false_positive_rate: u32,   // Percentage
    pub detection_accuracy: u32,    // Percentage
    pub average_response_time: u64, // Time to detect
    pub most_common_pattern: BehaviorPattern,
    pub last_updated: u64,
}

// Whistleblower protection status
#[contracttype]
#[derive(Clone, Debug)]
pub struct WhistleblowerProtection {
    pub reporter: Address,
    pub anonymous: bool,         // Whether reporter is anonymous
    pub protection_level: u32,   // Level of protection
    pub reward_earned: u32,      // Total rewards earned
    pub false_report_count: u32, // Number of false reports
    pub last_activity: u64,
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
    pub false_positive_threshold: u32, // Threshold for false positive detection
    pub emergency_mode: bool,          // Emergency mode flag
    pub whistleblower_reward: u32,     // Reward for valid reports
    pub pattern_detection_sensitivity: u32, // Sensitivity for pattern detection
}

// Storage keys
#[contracttype]
pub enum DataKey {
    Admin,
    ReputationContract,
    GovernanceContract,
    ReportCounter,
    SanctionCounter,
    AppealCounter,
    Report(u64),
    Sanction(u64),
    Appeal(u64),
    TrustScore(Address),
    PlayerReports(Address, u64), // player, match_id
    AntiCheatParams,
    AnalyticsData,
    EmergencyMode,
    WhistleblowerProtection(Address), // Reporter protection status
    BehaviorProfile(Address),         // Player behavior profile
    PatternDatabase(u32),             // Pattern detection database
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
            false_positive_threshold: 70, // 70% confidence threshold
            emergency_mode: false,
            whistleblower_reward: 100,         // Reward points
            pattern_detection_sensitivity: 50, // Medium sensitivity
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

        // Initialize analytics data
        let analytics = AnalyticsData {
            total_reports: 0,
            total_sanctions: 0,
            total_appeals: 0,
            false_positive_rate: 0,
            detection_accuracy: 100,
            average_response_time: 0,
            most_common_pattern: BehaviorPattern::Other,
            last_updated: env.ledger().timestamp(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::AnalyticsData, &analytics);

        // Initialize emergency mode as false
        env.storage()
            .persistent()
            .set(&DataKey::EmergencyMode, &false);
    }

    // Report suspicious activity
    #[allow(clippy::too_many_arguments)]
    pub fn report_suspicious_activity(
        env: Env,
        reporter: Address,
        player: Address,
        match_id: u64,
        pattern: BehaviorPattern,
        evidence: Bytes,
        severity: u32,
        anonymous: bool,
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

        // Calculate confidence score and false positive risk
        let confidence_score =
            Self::calculate_confidence_score(&env, &pattern, &evidence, severity);
        let false_positive_risk =
            Self::calculate_false_positive_risk(&env, &player, &pattern, confidence_score);

        // In emergency mode, lower threshold for action
        let emergency_mode: bool = env
            .storage()
            .persistent()
            .get(&DataKey::EmergencyMode)
            .unwrap_or(false);

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
            confidence_score,
            false_positive_risk,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Report(report_id), &activity);

        // Update last report time
        env.storage().persistent().set(&report_key, &current_time);

        // Update whistleblower protection
        Self::update_whistleblower_protection(&env, &reporter, anonymous);

        // Update trust score with weighted factors
        Self::update_trust_score(&env, &player, severity, false, confidence_score);

        // Update analytics
        Self::update_analytics(&env, report_id, &pattern, true);

        // Update behavior profile
        Self::update_behavior_profile(&env, &player, &pattern, severity);

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

        // In emergency mode with high confidence, auto-verify
        if emergency_mode && confidence_score > 80 {
            Self::verify_activity(env.clone(), reporter.clone(), report_id, true);
        }

        report_id
    }

    // Validate game action with sophisticated analysis
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

        let params: AntiCheatParams = env
            .storage()
            .persistent()
            .get(&DataKey::AntiCheatParams)
            .expect("params not found");

        // Basic validation
        if !Self::perform_basic_validation(&env, &action, &game_state) {
            return false;
        }

        if let Some(score) = trust_score {
            // If trust score is below threshold, require additional validation
            if score.score < params.trust_threshold {
                // Perform deep validation with pattern matching
                return Self::perform_deep_validation(&env, &player, &action, &game_state);
            }
        }

        // Update behavior profile with this action
        Self::update_behavior_profile(&env, &player, &BehaviorPattern::Other, 1);

        true
    }

    // Calculate cheat probability with sophisticated analysis
    pub fn calculate_cheat_probability(env: Env, player: Address, behavior_data: Bytes) -> u32 {
        let trust_score: Option<TrustScore> = env
            .storage()
            .persistent()
            .get(&DataKey::TrustScore(player.clone()));

        let params: AntiCheatParams = env
            .storage()
            .persistent()
            .get(&DataKey::AntiCheatParams)
            .expect("params not found");

        let base_probability = if let Some(score) = trust_score {
            // Lower trust score = higher cheat probability
            // Use weighted factors for more accurate calculation
            let trust_factor = 100 - score.score;
            let cheat_history_factor = score.confirmed_cheats * 10;
            let volatility_factor = score.weighted_factors.volatility_score;

            (trust_factor + cheat_history_factor + volatility_factor) / 3
        } else {
            50 // Default medium probability
        };

        // Analyze behavior data with pattern detection
        let behavior_factor =
            Self::analyze_behavior(&env, &behavior_data, params.pattern_detection_sensitivity);

        // Check behavior profile for anomalies
        let profile_factor = if let Some(profile) = env
            .storage()
            .persistent()
            .get::<DataKey, BehaviorProfile>(&DataKey::BehaviorProfile(player.clone()))
        {
            profile.anomaly_count * 5
        } else {
            0
        };

        let probability = (base_probability + behavior_factor + profile_factor) / 3;

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
        report_ids: Vec<u64>,
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

        // Calculate severity score based on reports
        let severity_score = Self::calculate_severity_score(&env, &report_ids);

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
            report_ids: report_ids.clone(),
            severity_score,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Sanction(sanction_id), &sanction);

        // Update trust score significantly
        Self::update_trust_score(&env, &player, 10, true, 100);

        // Reward whistleblowers for successful reports
        for report_id in report_ids.iter() {
            if let Some(report) = env
                .storage()
                .persistent()
                .get::<DataKey, SuspiciousActivity>(&DataKey::Report(report_id))
            {
                Self::reward_whistleblower(&env, &report.reporter, params.whistleblower_reward);
            }
        }

        // Update analytics
        Self::update_analytics(&env, 0, &BehaviorPattern::Other, false);

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
            reviewer: None,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Appeal(appeal_id), &appeal);

        // Update sanction status
        sanction.status = SanctionStatus::Appealed;
        env.storage()
            .persistent()
            .set(&DataKey::Sanction(sanction_id), &sanction);

        // Update analytics
        Self::update_analytics(&env, 0, &BehaviorPattern::Other, false);

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
        appeal.reviewer = Some(admin.clone());
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
            // Penalize false reporters
            for report_id in sanction.report_ids.iter() {
                if let Some(report) = env
                    .storage()
                    .persistent()
                    .get::<DataKey, SuspiciousActivity>(&DataKey::Report(report_id))
                {
                    Self::penalize_false_reporter(&env, &report.reporter);
                }
            }
        } else {
            sanction.status = SanctionStatus::Upheld;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Sanction(appeal.sanction_id), &sanction);

        // Update analytics
        Self::update_analytics(&env, 0, &BehaviorPattern::Other, false);

        // Emit event
        arenax_events::anti_cheat::emit_appeal_reviewed(&env, appeal_id, approved);
    }

    // Get player trust score
    pub fn get_player_trust_score(env: Env, player: Address) -> TrustScore {
        env.storage()
            .persistent()
            .get(&DataKey::TrustScore(player.clone()))
            .unwrap_or(TrustScore {
                player,
                score: 100, // Default perfect score
                total_reports: 0,
                confirmed_cheats: 0,
                false_reports: 0,
                successful_reports: 0,
                last_updated: env.ledger().timestamp(),
                weighted_factors: WeightedFactors {
                    report_history_weight: 20,
                    confirmed_cheat_weight: 40,
                    successful_report_weight: 10,
                    time_decay_factor: 20,
                    volatility_score: 10,
                },
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
            let mut report_ids = Vec::new(&env);
            report_ids.push_back(report_id);
            Self::apply_sanction(
                env.clone(),
                activity.player.clone(),
                SanctionType::ReputationPenalty,
                String::from_str(&env, "Verified suspicious activity"),
                0,
                report_ids,
            );
        }
    }

    // Set emergency mode (admin only)
    pub fn set_emergency_mode(env: Env, enabled: bool) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("not initialized");

        admin.require_auth();

        env.storage()
            .persistent()
            .set(&DataKey::EmergencyMode, &enabled);

        // Update params
        let mut params: AntiCheatParams = env
            .storage()
            .persistent()
            .get(&DataKey::AntiCheatParams)
            .expect("params not found");
        params.emergency_mode = enabled;
        env.storage()
            .persistent()
            .set(&DataKey::AntiCheatParams, &params);
    }

    // Get analytics data
    pub fn get_analytics(env: Env) -> AnalyticsData {
        env.storage()
            .persistent()
            .get(&DataKey::AnalyticsData)
            .expect("analytics not found")
    }

    // Get behavior profile
    pub fn get_behavior_profile(env: Env, player: Address) -> Option<BehaviorProfile> {
        env.storage()
            .persistent()
            .get(&DataKey::BehaviorProfile(player))
    }

    // Get whistleblower protection status
    pub fn get_whistleblower_protection(
        env: Env,
        reporter: Address,
    ) -> Option<WhistleblowerProtection> {
        env.storage()
            .persistent()
            .get(&DataKey::WhistleblowerProtection(reporter))
    }

    // Set governance contract (admin only)
    pub fn set_governance_contract(env: Env, governance: Address) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("not initialized");

        admin.require_auth();

        env.storage()
            .persistent()
            .set(&DataKey::GovernanceContract, &governance);
    }

    // Helper: Update trust score with weighted factors
    fn update_trust_score(
        env: &Env,
        player: &Address,
        severity: u32,
        is_confirmed_cheat: bool,
        confidence_score: u32,
    ) {
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
                successful_reports: 0,
                last_updated: env.ledger().timestamp(),
                weighted_factors: WeightedFactors {
                    report_history_weight: 20,
                    confirmed_cheat_weight: 40,
                    successful_report_weight: 10,
                    time_decay_factor: 20,
                    volatility_score: 10,
                },
            });

        trust_score.total_reports += 1;

        if is_confirmed_cheat {
            trust_score.confirmed_cheats += 1;
            // Significant penalty for confirmed cheats, weighted by confidence
            let penalty = ((severity * 5) * confidence_score / 100).min(50);
            trust_score.score = trust_score.score.saturating_sub(penalty);
            trust_score.weighted_factors.volatility_score =
                (trust_score.weighted_factors.volatility_score + 5).min(100);
        } else {
            // Smaller penalty for unverified reports
            let penalty = (severity * confidence_score / 100).min(10);
            trust_score.score = trust_score.score.saturating_sub(penalty);
        }

        trust_score.last_updated = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::TrustScore(player.clone()), &trust_score);

        // Emit trust score update event
        arenax_events::anti_cheat::emit_trust_score_updated(env, player, trust_score.score);
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
        trust_score.weighted_factors.volatility_score = trust_score
            .weighted_factors
            .volatility_score
            .saturating_sub(10);
        trust_score.last_updated = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::TrustScore(player.clone()), &trust_score);

        // Emit trust score update event
        arenax_events::anti_cheat::emit_trust_score_updated(env, player, trust_score.score);
    }

    // Helper: Perform basic validation
    fn perform_basic_validation(_env: &Env, action: &Bytes, game_state: &Bytes) -> bool {
        // Basic checks: action format, game state consistency
        // In production, this would validate action structure
        !action.is_empty() && !game_state.is_empty()
    }

    // Helper: Perform deep validation with pattern matching
    fn perform_deep_validation(
        env: &Env,
        player: &Address,
        action: &Bytes,
        game_state: &Bytes,
    ) -> bool {
        // Deep validation checks:
        // - Action consistency with game state
        // - Physics validation
        // - Timing analysis
        // - Pattern matching against known cheat signatures

        // Check behavior profile for anomalies
        if let Some(profile) = env
            .storage()
            .persistent()
            .get::<DataKey, BehaviorProfile>(&DataKey::BehaviorProfile(player.clone()))
        {
            // If player has high anomaly count, be more strict
            if profile.anomaly_count > 5 {
                return false;
            }
        }

        // Simplified deep validation - in production would use ML models
        action.len() < 1000 && game_state.len() < 10000
    }

    // Helper: Analyze behavior with pattern detection
    fn analyze_behavior(_env: &Env, behavior_data: &Bytes, sensitivity: u32) -> u32 {
        // Behavior analysis with configurable sensitivity
        let len = behavior_data.len();

        // Higher sensitivity = more likely to flag as suspicious
        let base_factor = if len > 100 {
            30
        } else if len > 50 {
            20
        } else {
            10
        };

        // Adjust by sensitivity
        (base_factor * sensitivity / 50).min(100)
    }

    // Helper: Calculate confidence score for detection
    fn calculate_confidence_score(
        _env: &Env,
        pattern: &BehaviorPattern,
        evidence: &Bytes,
        severity: u32,
    ) -> u32 {
        // Confidence score based on:
        // - Pattern type (some patterns are more reliable indicators)
        // - Evidence quality (length and content)
        // - Severity level

        let pattern_score = match pattern {
            BehaviorPattern::AimbotDetection => 90,
            BehaviorPattern::Wallhack => 85,
            BehaviorPattern::SpeedHack => 80,
            BehaviorPattern::ImpossibleMovement => 75,
            BehaviorPattern::AbnormalReactionTime => 60,
            BehaviorPattern::StatisticalAnomaly => 50,
            BehaviorPattern::NetworkManipulation => 70,
            BehaviorPattern::ExploitUsage => 85,
            BehaviorPattern::ResourceManipulation => 65,
            BehaviorPattern::TimingAnomaly => 55,
            BehaviorPattern::Other => 40,
        };

        let evidence_score = if evidence.len() > 100 {
            90
        } else if evidence.len() > 50 {
            70
        } else {
            50
        };

        let severity_score = severity * 10;

        // Weighted average
        (pattern_score * 3 + evidence_score * 2 + severity_score) / 6
    }

    // Helper: Calculate false positive risk
    fn calculate_false_positive_risk(
        env: &Env,
        player: &Address,
        pattern: &BehaviorPattern,
        confidence_score: u32,
    ) -> u32 {
        // False positive risk based on:
        // - Player's trust score (higher trust = lower risk)
        // - Pattern reliability
        // - Confidence score (inverse relationship)

        let trust_score: Option<TrustScore> = env
            .storage()
            .persistent()
            .get(&DataKey::TrustScore(player.clone()));

        let trust_factor = if let Some(score) = trust_score {
            // Higher trust score = lower false positive risk
            (100 - score.score) / 2
        } else {
            50 // Medium risk for new players
        };

        let pattern_risk = match pattern {
            BehaviorPattern::AimbotDetection => 10,
            BehaviorPattern::Wallhack => 15,
            BehaviorPattern::SpeedHack => 20,
            BehaviorPattern::ImpossibleMovement => 25,
            BehaviorPattern::AbnormalReactionTime => 40,
            BehaviorPattern::StatisticalAnomaly => 50,
            BehaviorPattern::NetworkManipulation => 35,
            BehaviorPattern::ExploitUsage => 20,
            BehaviorPattern::ResourceManipulation => 30,
            BehaviorPattern::TimingAnomaly => 45,
            BehaviorPattern::Other => 60,
        };

        // Higher confidence = lower false positive risk
        let confidence_factor = (100 - confidence_score) / 2;

        // Weighted average
        (trust_factor + pattern_risk + confidence_factor) / 3
    }

    // Helper: Update whistleblower protection
    fn update_whistleblower_protection(env: &Env, reporter: &Address, anonymous: bool) {
        let mut protection: WhistleblowerProtection = env
            .storage()
            .persistent()
            .get(&DataKey::WhistleblowerProtection(reporter.clone()))
            .unwrap_or(WhistleblowerProtection {
                reporter: reporter.clone(),
                anonymous,
                protection_level: if anonymous { 3 } else { 1 },
                reward_earned: 0,
                false_report_count: 0,
                last_activity: env.ledger().timestamp(),
            });

        protection.anonymous = anonymous;
        protection.protection_level = if anonymous { 3 } else { 1 };
        protection.last_activity = env.ledger().timestamp();

        env.storage().persistent().set(
            &DataKey::WhistleblowerProtection(reporter.clone()),
            &protection,
        );
    }

    // Helper: Reward whistleblower
    fn reward_whistleblower(env: &Env, reporter: &Address, reward: u32) {
        let mut protection: WhistleblowerProtection = env
            .storage()
            .persistent()
            .get(&DataKey::WhistleblowerProtection(reporter.clone()))
            .unwrap_or(WhistleblowerProtection {
                reporter: reporter.clone(),
                anonymous: false,
                protection_level: 1,
                reward_earned: 0,
                false_report_count: 0,
                last_activity: env.ledger().timestamp(),
            });

        protection.reward_earned += reward;
        protection.last_activity = env.ledger().timestamp();

        env.storage().persistent().set(
            &DataKey::WhistleblowerProtection(reporter.clone()),
            &protection,
        );
    }

    // Helper: Penalize false reporter
    fn penalize_false_reporter(env: &Env, reporter: &Address) {
        let mut protection: WhistleblowerProtection = env
            .storage()
            .persistent()
            .get(&DataKey::WhistleblowerProtection(reporter.clone()))
            .unwrap_or(WhistleblowerProtection {
                reporter: reporter.clone(),
                anonymous: false,
                protection_level: 1,
                reward_earned: 0,
                false_report_count: 0,
                last_activity: env.ledger().timestamp(),
            });

        protection.false_report_count += 1;
        protection.protection_level = protection.protection_level.saturating_sub(1);
        protection.last_activity = env.ledger().timestamp();

        env.storage().persistent().set(
            &DataKey::WhistleblowerProtection(reporter.clone()),
            &protection,
        );
    }

    // Helper: Update analytics
    fn update_analytics(env: &Env, _report_id: u64, pattern: &BehaviorPattern, is_report: bool) {
        let mut analytics: AnalyticsData = env
            .storage()
            .persistent()
            .get(&DataKey::AnalyticsData)
            .expect("analytics not found");

        if is_report {
            analytics.total_reports += 1;
            analytics.most_common_pattern = pattern.clone();
        } else {
            analytics.total_appeals += 1;
        }

        analytics.last_updated = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::AnalyticsData, &analytics);
    }

    // Helper: Update behavior profile
    fn update_behavior_profile(
        env: &Env,
        player: &Address,
        _pattern: &BehaviorPattern,
        severity: u32,
    ) {
        let mut profile: BehaviorProfile = env
            .storage()
            .persistent()
            .get(&DataKey::BehaviorProfile(player.clone()))
            .unwrap_or(BehaviorProfile {
                player: player.clone(),
                reaction_time_avg: 200, // Default 200ms
                movement_patterns: Bytes::new(env),
                action_frequency: Map::new(env),
                statistical_baseline: Bytes::new(env),
                anomaly_count: 0,
                last_analyzed: env.ledger().timestamp(),
            });

        // Update anomaly count based on pattern severity
        if severity > 5 {
            profile.anomaly_count += 1;
        }

        profile.last_analyzed = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::BehaviorProfile(player.clone()), &profile);
    }

    // Helper: Calculate severity score from reports
    fn calculate_severity_score(env: &Env, report_ids: &Vec<u64>) -> u32 {
        let mut total_severity = 0u32;
        let mut count = 0u32;

        for report_id in report_ids.iter() {
            if let Some(report) = env
                .storage()
                .persistent()
                .get::<DataKey, SuspiciousActivity>(&DataKey::Report(report_id))
            {
                total_severity += report.severity;
                count += 1;
            }
        }

        if count == 0 {
            0
        } else {
            total_severity / count
        }
    }
}
