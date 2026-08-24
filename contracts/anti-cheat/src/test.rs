#![cfg(test)]

use crate::{
    AntiCheatContract, AntiCheatContractClient, AntiCheatParams, Appeal,
    BehaviorPattern, DataKey, MlModelParams, Sanction, SanctionStatus,
    SanctionType, SuspiciousActivity,
};
use soroban_sdk::{
    testutils::Address as _,
    Address, Bytes, Env, Map, String, Vec,
};

fn setup_env() -> (Env, Address, Address, Address) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let player = Address::generate(&env);
    let reputation_contract = Address::generate(&env);
    (env, admin, player, reputation_contract)
}

fn register_contract(env: &Env) -> (Address, AntiCheatContractClient<'_>) {
    let contract_id = env.register(AntiCheatContract, ());
    let client = AntiCheatContractClient::new(env, &contract_id);
    (contract_id, client)
}

#[test]
fn test_initialize() {
    let (env, admin, _, reputation_contract) = setup_env();
    let (contract_id, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    env.as_contract(&contract_id, || {
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
    });
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice() {
    let (env, admin, _, reputation_contract) = setup_env();
    let (_, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);
    client.initialize(&admin, &reputation_contract);
}

#[test]
fn test_report_suspicious_activity() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (contract_id, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let reporter = Address::generate(&env);
    let evidence = Bytes::new(&env);
    let pattern = BehaviorPattern::AbnormalReactionTime;
    let severity = 5;
    let match_id = 12345;

    env.mock_all_auths();
    let report_id = client.report_suspicious_activity(
        &reporter, &player, &match_id, &pattern, &evidence, &severity, &false,
    );

    assert_eq!(report_id, 1);

    env.as_contract(&contract_id, || {
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
    });
}

#[test]
#[should_panic(expected = "invalid severity")]
fn test_report_invalid_severity() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (_, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let reporter = Address::generate(&env);
    let evidence = Bytes::new(&env);
    let pattern = BehaviorPattern::AbnormalReactionTime;
    let severity = 11; // Invalid (> 10)
    let match_id = 12345;

    env.mock_all_auths();
    client.report_suspicious_activity(
        &reporter, &player, &match_id, &pattern, &evidence, &severity, &false,
    );
}

#[test]
fn test_validate_game_action() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (_, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let mut action = Bytes::new(&env);
    action.push_back(1);
    let mut game_state = Bytes::new(&env);
    game_state.push_back(1);

    let result = client.validate_game_action(&player, &action, &game_state);
    assert!(result);
}

#[test]
fn test_calculate_cheat_probability() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (_, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let behavior_data = Bytes::new(&env);
    let probability = client.calculate_cheat_probability(&player, &behavior_data);

    assert!(probability <= 100);
}

#[test]
fn test_apply_sanction() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (contract_id, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let reason = String::from_str(&env, "Test sanction");
    let duration = 86400; // 1 day
    let report_ids = Vec::new(&env);

    env.mock_all_auths();
    let sanction_id = client.apply_sanction(
        &player,
        &SanctionType::TemporaryBan,
        &reason,
        &duration,
        &report_ids,
    );

    assert_eq!(sanction_id, 1);

    env.as_contract(&contract_id, || {
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
    });
}

#[test]
#[should_panic]
fn test_apply_sanction_unauthorized() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (_, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let reason = String::from_str(&env, "Test sanction");
    let duration = 86400;
    let report_ids = Vec::new(&env);

    // Should panic because calling apply_sanction directly registers admin requirement
    // without mocking auth for admin.
    client.apply_sanction(
        &player,
        &SanctionType::TemporaryBan,
        &reason,
        &duration,
        &report_ids,
    );
}

#[test]
fn test_appeal_sanction() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (contract_id, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let reason = String::from_str(&env, "Test sanction");
    let duration = 86400;
    let report_ids = Vec::new(&env);

    env.mock_all_auths();
    let sanction_id = client.apply_sanction(
        &player,
        &SanctionType::TemporaryBan,
        &reason,
        &duration,
        &report_ids,
    );

    let appeal_reason = String::from_str(&env, "Not guilty");
    let evidence = Bytes::new(&env);

    let appeal_id = client.appeal_sanction(&player, &sanction_id, &appeal_reason, &evidence);
    assert_eq!(appeal_id, 1);

    env.as_contract(&contract_id, || {
        let appeal: Appeal = env
            .storage()
            .persistent()
            .get(&DataKey::Appeal(appeal_id))
            .expect("appeal not found");

        assert_eq!(appeal.player, player);
        assert_eq!(appeal.sanction_id, sanction_id);
        assert_eq!(appeal.reason, appeal_reason);
        assert!(!appeal.reviewed);
    });
}

#[test]
#[should_panic(expected = "not your sanction")]
fn test_appeal_not_your_sanction() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (_, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let reason = String::from_str(&env, "Test sanction");
    let duration = 86400;
    let report_ids = Vec::new(&env);

    env.mock_all_auths();
    let sanction_id = client.apply_sanction(
        &player,
        &SanctionType::TemporaryBan,
        &reason,
        &duration,
        &report_ids,
    );

    let stranger = Address::generate(&env);
    let appeal_reason = String::from_str(&env, "Not guilty");
    let evidence = Bytes::new(&env);

    client.appeal_sanction(&stranger, &sanction_id, &appeal_reason, &evidence);
}

#[test]
fn test_review_appeal() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (contract_id, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let reason = String::from_str(&env, "Test sanction");
    let duration = 86400;
    let report_ids = Vec::new(&env);

    env.mock_all_auths();
    let sanction_id = client.apply_sanction(
        &player,
        &SanctionType::TemporaryBan,
        &reason,
        &duration,
        &report_ids,
    );

    let appeal_reason = String::from_str(&env, "Not guilty");
    let evidence = Bytes::new(&env);
    let appeal_id = client.appeal_sanction(&player, &sanction_id, &appeal_reason, &evidence);

    client.review_appeal(&appeal_id, &true);

    env.as_contract(&contract_id, || {
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
    });
}

#[test]
fn test_get_player_trust_score() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (_, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let trust = client.get_player_trust_score(&player);
    assert_eq!(trust.score, 100);
}

#[test]
fn test_update_anticheat_params() {
    let (env, admin, _, reputation_contract) = setup_env();
    let (contract_id, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let new_params = AntiCheatParams {
        trust_threshold: 40,
        report_cooldown: 1800,
        appeal_window: 302400,
        severity_multiplier: 3,
        max_reports_per_match: 10,
        false_positive_threshold: 60,
        emergency_mode: true,
        whistleblower_reward: 50,
        pattern_detection_sensitivity: 70,
    };

    env.mock_all_auths();
    client.update_anticheat_params(&admin, &new_params);

    env.as_contract(&contract_id, || {
        let stored: AntiCheatParams = env
            .storage()
            .persistent()
            .get(&DataKey::AntiCheatParams)
            .unwrap();
        assert_eq!(stored.trust_threshold, 40);
        assert_eq!(stored.report_cooldown, 1800);
    });
}

#[test]
#[should_panic(expected = "only admin can update parameters")]
fn test_update_anticheat_params_unauthorized() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (_, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let new_params = AntiCheatParams {
        trust_threshold: 40,
        report_cooldown: 1800,
        appeal_window: 302400,
        severity_multiplier: 3,
        max_reports_per_match: 10,
        false_positive_threshold: 60,
        emergency_mode: true,
        whistleblower_reward: 50,
        pattern_detection_sensitivity: 70,
    };

    client.update_anticheat_params(&player, &new_params);
}

#[test]
fn test_verify_activity() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (contract_id, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let reporter = Address::generate(&env);
    let evidence = Bytes::new(&env);
    let pattern = BehaviorPattern::AbnormalReactionTime;
    let severity = 5;
    let match_id = 12345;

    env.mock_all_auths();
    let report_id = client.report_suspicious_activity(
        &reporter, &player, &match_id, &pattern, &evidence, &severity, &false,
    );

    client.verify_activity(&admin, &report_id, &true);

    env.as_contract(&contract_id, || {
        let report: SuspiciousActivity = env
            .storage()
            .persistent()
            .get(&DataKey::Report(report_id))
            .unwrap();
        assert!(report.verified);
    });
}

#[test]
#[should_panic(expected = "only admin can verify activity")]
fn test_verify_activity_unauthorized() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (_, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let reporter = Address::generate(&env);
    let evidence = Bytes::new(&env);
    let pattern = BehaviorPattern::AbnormalReactionTime;
    let severity = 5;
    let match_id = 12345;

    env.mock_all_auths();
    let report_id = client.report_suspicious_activity(
        &reporter, &player, &match_id, &pattern, &evidence, &severity, &false,
    );

    client.verify_activity(&player, &report_id, &true);
}

#[test]
fn test_emergency_mode() {
    let (env, admin, _, reputation_contract) = setup_env();
    let (contract_id, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    env.mock_all_auths();
    client.set_emergency_mode(&true);

    env.as_contract(&contract_id, || {
        let is_emergency: bool = env
            .storage()
            .persistent()
            .get(&DataKey::EmergencyMode)
            .unwrap();
        assert!(is_emergency);
    });
}

#[test]
fn test_whistleblower_protection() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (_contract_id, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let reporter = Address::generate(&env);
    let evidence = Bytes::new(&env);
    let pattern = BehaviorPattern::AbnormalReactionTime;
    let severity = 5;
    let match_id = 12345;

    env.mock_all_auths();
    client.report_suspicious_activity(
        &reporter, &player, &match_id, &pattern, &evidence, &severity, &false,
    );

    let protection = client.get_whistleblower_protection(&reporter).unwrap();
    assert_eq!(protection.reporter, reporter);
    assert!(!protection.anonymous);
}

#[test]
fn test_analytics() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (_, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let reporter = Address::generate(&env);
    let evidence = Bytes::new(&env);
    let pattern = BehaviorPattern::AbnormalReactionTime;
    let severity = 5;
    let match_id = 12345;

    env.mock_all_auths();
    client.report_suspicious_activity(
        &reporter, &player, &match_id, &pattern, &evidence, &severity, &false,
    );

    let analytics = client.get_analytics();
    assert_eq!(analytics.total_reports, 1);
}

#[test]
fn test_behavior_profile() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (_, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let reporter = Address::generate(&env);
    let evidence = Bytes::new(&env);
    let pattern = BehaviorPattern::AbnormalReactionTime;
    let severity = 8;
    let match_id = 12345;

    env.mock_all_auths();
    client.report_suspicious_activity(
        &reporter, &player, &match_id, &pattern, &evidence, &severity, &false,
    );

    let profile = client.get_behavior_profile(&player).unwrap();
    assert_eq!(profile.anomaly_count, 1);
}

#[test]
fn test_confidence_score() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (_, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let reporter = Address::generate(&env);
    let evidence = Bytes::new(&env);
    let pattern = BehaviorPattern::AimbotDetection;
    let severity = 9;
    let match_id = 12345;

    env.mock_all_auths();
    let report_id = client.report_suspicious_activity(
        &reporter, &player, &match_id, &pattern, &evidence, &severity, &false,
    );

    let report = client.get_report(&report_id);
    assert!(report.confidence_score > 50);
}

#[test]
fn test_false_positive_prevention() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (_, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let reporter = Address::generate(&env);
    let evidence = Bytes::new(&env);
    let pattern = BehaviorPattern::AimbotDetection;
    let severity = 8;
    let match_id = 12345;

    env.mock_all_auths();
    let report_id = client.report_suspicious_activity(
        &reporter, &player, &match_id, &pattern, &evidence, &severity, &false,
    );

    let report = client.get_report(&report_id);
    assert!(report.false_positive_risk < 50);
}

// ---------------------------------------------------------------------------
// Machine Learning Integration & Behavior Analysis Tests
// ---------------------------------------------------------------------------

#[test]
fn test_ml_model_governance() {
    let (env, admin, _, reputation_contract) = setup_env();
    let (contract_id, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let mut weights: Map<u32, i32> = Map::new(&env);
    weights.set(0, 15); // Feature 0 weight
    weights.set(1, 5); // Feature 1 weight
    weights.set(2, 25); // Feature 2 weight
    let bias = 100;
    let threshold = 80;

    env.mock_all_auths();
    client.update_ml_model(&admin, &weights, &bias, &threshold);

    env.as_contract(&contract_id, || {
        let stored_model: MlModelParams = env
            .storage()
            .persistent()
            .get(&DataKey::MlModelParams)
            .unwrap();
        assert_eq!(stored_model.bias, 100);
        assert_eq!(stored_model.threshold, 80);
        assert_eq!(stored_model.weights.get(2).unwrap(), 25);
    });
}

#[test]
#[should_panic(expected = "only admin can update ml model")]
fn test_ml_model_unauthorized() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (_, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    let weights = Map::new(&env);
    client.update_ml_model(&player, &weights, &0, &80);
}

#[test]
fn test_ml_action_validation_triggers() {
    let (env, admin, player, reputation_contract) = setup_env();
    let (_, client) = register_contract(&env);

    client.initialize(&admin, &reputation_contract);

    // Setup ML weights to heavily flag feature 0 (reaction time deviation)
    let mut weights: Map<u32, i32> = Map::new(&env);
    weights.set(0, 100); // 100x multiplier for feature 0
    let bias = 0;
    let threshold = 60; // Flag above 60

    env.mock_all_auths();
    client.update_ml_model(&admin, &weights, &bias, &threshold);

    // Action payload: first byte represents reaction time. If 220ms, deviation from 120ms is 100.
    // ML Score: 100 (feature 0 val) * 100 (weight 0) / 100 (scale factor) + 0 (bias) = 100.
    // 100 >= 95 threshold, validate_game_action should return false (cheat auto-reject)
    let mut action_bytes = Bytes::new(&env);
    action_bytes.push_back(220); // First byte

    let state_bytes = Bytes::new(&env);

    let valid = client.validate_game_action(&player, &action_bytes, &state_bytes);
    assert!(!valid); // Blocked by ML model!
}
