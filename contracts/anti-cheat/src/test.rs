#![cfg(test)]

use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Bytes, Env, String};

use crate::{
    AntiCheatContract, AntiCheatParams, Appeal, BehaviorPattern, DataKey, Sanction, SanctionStatus,
    SanctionType, SuspiciousActivity, TrustScore,
};

#[test]
fn test_initialize() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let reputation_contract = Address::generate(&env);

    AntiCheatContract::initialize(env.clone(), admin.clone(), reputation_contract.clone());

    let stored_admin: Address = env
        .storage()
        .persistent()
        .get(&DataKey::Admin)
        .expect("admin not found");

    assert_eq!(stored_admin, admin);

    let stored_reputation: Address = env
        .storage()
        .persistent()
        .get(&DataKey::ReputationContract)
        .expect("reputation contract not found");

    assert_eq!(stored_reputation, reputation_contract);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let reputation_contract = Address::generate(&env);

    AntiCheatContract::initialize(env.clone(), admin.clone(), reputation_contract.clone());
    AntiCheatContract::initialize(env, admin, reputation_contract);
}

#[test]
fn test_report_suspicious_activity() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let reporter = Address::generate(&env);
    let player = Address::generate(&env);
    let reputation_contract = Address::generate(&env);

    AntiCheatContract::initialize(env.clone(), admin, reputation_contract);

    let evidence = Bytes::new(&env);
    let pattern = BehaviorPattern::AbnormalReactionTime;
    let severity = 5;
    let match_id = 12345;

    let report_id = AntiCheatContract::report_suspicious_activity(
        env.clone(),
        reporter.clone(),
        player.clone(),
        match_id,
        pattern.clone(),
        evidence,
        severity,
    );

    let report: SuspiciousActivity = env
        .storage()
        .persistent()
        .get(&DataKey::Report(report_id))
        .expect("report not found");

    assert_eq!(report.reporter, reporter);
    assert_eq!(report.player, player);
    assert_eq!(report.match_id, match_id);
    assert_eq!(report.pattern, pattern);
    assert_eq!(report.severity, severity);
    assert!(!report.verified);
}

#[test]
#[should_panic(expected = "invalid severity")]
fn test_report_invalid_severity() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let reporter = Address::generate(&env);
    let player = Address::generate(&env);
    let reputation_contract = Address::generate(&env);

    AntiCheatContract::initialize(env.clone(), admin, reputation_contract);

    let evidence = Bytes::new(&env);
    let pattern = BehaviorPattern::AbnormalReactionTime;
    let severity = 11; // Invalid (> 10)

    AntiCheatContract::report_suspicious_activity(
        env, reporter, player, 12345, pattern, evidence, severity,
    );
}

#[test]
fn test_validate_game_action() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let player = Address::generate(&env);
    let reputation_contract = Address::generate(&env);

    AntiCheatContract::initialize(env.clone(), admin, reputation_contract);

    let action = Bytes::new(&env);
    let game_state = Bytes::new(&env);

    // New player with no trust score should pass basic validation
    let result = AntiCheatContract::validate_game_action(
        env.clone(),
        player.clone(),
        action.clone(),
        game_state.clone(),
    );

    assert!(result);
}

#[test]
fn test_calculate_cheat_probability() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let player = Address::generate(&env);
    let reputation_contract = Address::generate(&env);

    AntiCheatContract::initialize(env.clone(), admin, reputation_contract);

    let behavior_data = Bytes::new(&env);

    // New player should have medium probability
    let probability = AntiCheatContract::calculate_cheat_probability(
        env.clone(),
        player.clone(),
        behavior_data.clone(),
    );

    assert!(probability > 0 && probability <= 100);
}

#[test]
fn test_apply_sanction() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let player = Address::generate(&env);
    let reputation_contract = Address::generate(&env);

    AntiCheatContract::initialize(env.clone(), admin.clone(), reputation_contract);

    let reason = String::from_str(&env, "Test sanction");
    let duration = 86400; // 1 day

    let sanction_id = AntiCheatContract::apply_sanction(
        env.clone(),
        player.clone(),
        SanctionType::TemporaryBan,
        reason.clone(),
        duration,
    );

    let sanction: Sanction = env
        .storage()
        .persistent()
        .get(&DataKey::Sanction(sanction_id))
        .expect("sanction not found");

    assert_eq!(sanction.player, player);
    assert_eq!(sanction.sanction_type, SanctionType::TemporaryBan);
    assert_eq!(sanction.status, SanctionStatus::Active);
    assert_eq!(sanction.reason, reason);
    assert_eq!(sanction.duration, duration);
}

#[test]
#[should_panic(expected = "only admin can update parameters")]
fn test_apply_sanction_unauthorized() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let unauthorized = Address::generate(&env);
    let player = Address::generate(&env);
    let reputation_contract = Address::generate(&env);

    AntiCheatContract::initialize(env.clone(), admin, reputation_contract);

    let reason = String::from_str(&env, "Test sanction");
    let duration = 86400;

    AntiCheatContract::apply_sanction(env, player, SanctionType::TemporaryBan, reason, duration);
}

#[test]
fn test_appeal_sanction() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let player = Address::generate(&env);
    let reputation_contract = Address::generate(&env);

    AntiCheatContract::initialize(env.clone(), admin.clone(), reputation_contract);

    let reason = String::from_str(&env, "Test sanction");
    let duration = 86400;

    let sanction_id = AntiCheatContract::apply_sanction(
        env.clone(),
        player.clone(),
        SanctionType::TemporaryBan,
        reason.clone(),
        duration,
    );

    let appeal_reason = String::from_str(&env, "Appeal reason");
    let evidence = Bytes::new(&env);

    let appeal_id = AntiCheatContract::appeal_sanction(
        env.clone(),
        player.clone(),
        sanction_id,
        appeal_reason.clone(),
        evidence,
    );

    let appeal: Appeal = env
        .storage()
        .persistent()
        .get(&DataKey::Appeal(appeal_id))
        .expect("appeal not found");

    assert_eq!(appeal.sanction_id, sanction_id);
    assert_eq!(appeal.player, player);
    assert_eq!(appeal.reason, appeal_reason);
    assert!(!appeal.reviewed);

    let sanction: Sanction = env
        .storage()
        .persistent()
        .get(&DataKey::Sanction(sanction_id))
        .expect("sanction not found");

    assert_eq!(sanction.status, SanctionStatus::Appealed);
}

#[test]
#[should_panic(expected = "not your sanction")]
fn test_appeal_not_your_sanction() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let reputation_contract = Address::generate(&env);

    AntiCheatContract::initialize(env.clone(), admin.clone(), reputation_contract);

    let reason = String::from_str(&env, "Test sanction");
    let duration = 86400;

    let sanction_id = AntiCheatContract::apply_sanction(
        env.clone(),
        player1,
        SanctionType::TemporaryBan,
        reason,
        duration,
    );

    let appeal_reason = String::from_str(&env, "Appeal reason");
    let evidence = Bytes::new(&env);

    AntiCheatContract::appeal_sanction(env, player2, sanction_id, appeal_reason, evidence);
}

#[test]
fn test_review_appeal() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let player = Address::generate(&env);
    let reputation_contract = Address::generate(&env);

    AntiCheatContract::initialize(env.clone(), admin.clone(), reputation_contract);

    let reason = String::from_str(&env, "Test sanction");
    let duration = 86400;

    let sanction_id = AntiCheatContract::apply_sanction(
        env.clone(),
        player.clone(),
        SanctionType::TemporaryBan,
        reason,
        duration,
    );

    let appeal_reason = String::from_str(&env, "Appeal reason");
    let evidence = Bytes::new(&env);

    let appeal_id = AntiCheatContract::appeal_sanction(
        env.clone(),
        player.clone(),
        sanction_id,
        appeal_reason,
        evidence,
    );

    AntiCheatContract::review_appeal(env.clone(), appeal_id, true);

    let appeal: Appeal = env
        .storage()
        .persistent()
        .get(&DataKey::Appeal(appeal_id))
        .expect("appeal not found");

    assert!(appeal.reviewed);
    assert!(appeal.approved);

    let sanction: Sanction = env
        .storage()
        .persistent()
        .get(&DataKey::Sanction(sanction_id))
        .expect("sanction not found");

    assert_eq!(sanction.status, SanctionStatus::Overturned);
}

#[test]
fn test_get_player_trust_score() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let player = Address::generate(&env);
    let reputation_contract = Address::generate(&env);

    AntiCheatContract::initialize(env.clone(), admin, reputation_contract);

    let trust_score = AntiCheatContract::get_player_trust_score(env.clone(), player.clone());

    assert_eq!(trust_score.score, 100); // Default perfect score
    assert_eq!(trust_score.total_reports, 0);
}

#[test]
fn test_update_anticheat_params() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let reputation_contract = Address::generate(&env);

    AntiCheatContract::initialize(env.clone(), admin.clone(), reputation_contract);

    let new_params = AntiCheatParams {
        trust_threshold: 25,
        report_cooldown: 7200,
        appeal_window: 1209600,
        severity_multiplier: 3,
        max_reports_per_match: 10,
    };

    AntiCheatContract::update_anticheat_params(env.clone(), admin.clone(), new_params.clone());

    let stored_params: AntiCheatParams = env
        .storage()
        .persistent()
        .get(&DataKey::AntiCheatParams)
        .expect("params not found");

    assert_eq!(stored_params.trust_threshold, 25);
    assert_eq!(stored_params.report_cooldown, 7200);
}

#[test]
#[should_panic(expected = "only admin can update parameters")]
fn test_update_anticheat_params_unauthorized() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let unauthorized = Address::generate(&env);
    let reputation_contract = Address::generate(&env);

    AntiCheatContract::initialize(env.clone(), admin, reputation_contract);

    let new_params = AntiCheatParams {
        trust_threshold: 25,
        report_cooldown: 7200,
        appeal_window: 1209600,
        severity_multiplier: 3,
        max_reports_per_match: 10,
    };

    AntiCheatContract::update_anticheat_params(env, unauthorized, new_params);
}

#[test]
fn test_verify_activity() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let reporter = Address::generate(&env);
    let player = Address::generate(&env);
    let reputation_contract = Address::generate(&env);

    AntiCheatContract::initialize(env.clone(), admin.clone(), reputation_contract);

    let evidence = Bytes::new(&env);
    let pattern = BehaviorPattern::AbnormalReactionTime;
    let severity = 5;
    let match_id = 12345;

    let report_id = AntiCheatContract::report_suspicious_activity(
        env.clone(),
        reporter,
        player.clone(),
        match_id,
        pattern,
        evidence,
        severity,
    );

    AntiCheatContract::verify_activity(env.clone(), admin.clone(), report_id, true);

    let report: SuspiciousActivity = env
        .storage()
        .persistent()
        .get(&DataKey::Report(report_id))
        .expect("report not found");

    assert!(report.verified);
}

#[test]
#[should_panic(expected = "only admin can verify activity")]
fn test_verify_activity_unauthorized() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let reporter = Address::generate(&env);
    let player = Address::generate(&env);
    let unauthorized = Address::generate(&env);
    let reputation_contract = Address::generate(&env);

    AntiCheatContract::initialize(env.clone(), admin, reputation_contract);

    let evidence = Bytes::new(&env);
    let pattern = BehaviorPattern::AbnormalReactionTime;
    let severity = 5;
    let match_id = 12345;

    let report_id = AntiCheatContract::report_suspicious_activity(
        env.clone(),
        reporter,
        player,
        match_id,
        pattern,
        evidence,
        severity,
    );

    AntiCheatContract::verify_activity(env, unauthorized, report_id, true);
}
