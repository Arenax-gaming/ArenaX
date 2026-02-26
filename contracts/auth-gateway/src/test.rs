#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, Vec,
};

fn create_test_env() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let referee = Address::generate(&env);
    let player = Address::generate(&env);
    (env, admin, operator, referee, player)
}

fn initialize_contract(env: &Env, admin: &Address) -> Address {
    let contract_id = Address::generate(env);
    env.register_contract(&contract_id, AuthGateway);
    let client = AuthGatewayClient::new(env, &contract_id);
    
    env.mock_all_auths();
    client.initialize(admin);
    
    contract_id
}

#[test]
fn test_initialization() {
    let (env, admin, _, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    assert_eq!(client.get_admin(), admin);
    assert!(!client.is_paused());
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialization() {
    let (env, admin, _, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    client.initialize(&admin);
}

#[test]
fn test_assign_role() {
    let (env, admin, operator, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.assign_role(&operator, Role::Operator);

    assert_eq!(client.get_role(&operator), Role::Operator);
    assert!(client.has_role(&operator, Role::Operator));
    assert!(!client.has_role(&operator, Role::Admin));
}

#[test]
#[should_panic(expected = "use revoke_role to remove roles")]
fn test_assign_none_role_fails() {
    let (env, admin, operator, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.assign_role(&operator, Role::None);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_assign_role_unauthorized() {
    let (env, admin, operator, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    client.assign_role(&operator, Role::Operator);
}

#[test]
fn test_revoke_role() {
    let (env, admin, operator, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.assign_role(&operator, Role::Operator);
    assert_eq!(client.get_role(&operator), Role::Operator);

    client.revoke_role(&operator);
    assert_eq!(client.get_role(&operator), Role::None);
    assert!(!client.has_role(&operator, Role::Operator));
}

#[test]
#[should_panic(expected = "address has no role to revoke")]
fn test_revoke_nonexistent_role_fails() {
    let (env, admin, operator, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.revoke_role(&operator);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_revoke_role_unauthorized() {
    let (env, admin, operator, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.assign_role(&operator, Role::Operator);

    client.revoke_role(&operator);
}

#[test]
fn test_whitelist_contract() {
    let (env, admin, _, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    let target_contract = Address::generate(&env);

    env.mock_all_auths();
    client.whitelist_contract(&target_contract);

    assert!(client.is_contract_whitelisted(&target_contract));
}

#[test]
#[should_panic(expected = "contract already whitelisted")]
fn test_whitelist_duplicate_contract_fails() {
    let (env, admin, _, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    let target_contract = Address::generate(&env);

    env.mock_all_auths();
    client.whitelist_contract(&target_contract);
    client.whitelist_contract(&target_contract);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_whitelist_contract_unauthorized() {
    let (env, admin, _, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    let target_contract = Address::generate(&env);
    client.whitelist_contract(&target_contract);
}

#[test]
fn test_remove_contract() {
    let (env, admin, _, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    let target_contract = Address::generate(&env);

    env.mock_all_auths();
    client.whitelist_contract(&target_contract);
    assert!(client.is_contract_whitelisted(&target_contract));

    client.remove_contract(&target_contract);
    assert!(!client.is_contract_whitelisted(&target_contract));
}

#[test]
#[should_panic(expected = "contract not whitelisted")]
fn test_remove_non_whitelisted_contract_fails() {
    let (env, admin, _, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    let target_contract = Address::generate(&env);

    env.mock_all_auths();
    client.remove_contract(&target_contract);
}

#[test]
fn test_pause_contract() {
    let (env, admin, _, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    env.mock_all_auths();

    assert!(!client.is_paused());
    client.set_paused(&true);
    assert!(client.is_paused());
    client.set_paused(&false);
    assert!(!client.is_paused());
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_pause_contract_unauthorized() {
    let (env, admin, _, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    client.set_paused(&true);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_operations_when_paused() {
    let (env, admin, operator, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.set_paused(&true);

    client.assign_role(&operator, Role::Operator);
}

#[test]
fn test_has_any_role() {
    let (env, admin, operator, referee, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.assign_role(&operator, Role::Operator);
    client.assign_role(&referee, Role::Referee);

    let roles = vec![&env, Role::Operator, Role::Referee];
    assert!(client.has_any_role(&operator, roles.clone()));
    assert!(client.has_any_role(&referee, roles));

    let admin_roles = vec![&env, Role::Admin, Role::Operator];
    assert!(!client.has_any_role(&operator, admin_roles));
}

#[test]
fn test_batch_assign_roles() {
    let (env, admin, operator, referee, player) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    env.mock_all_auths();

    let addresses = vec![&env, operator.clone(), referee.clone(), player.clone()];
    let roles = vec![&env, Role::Operator, Role::Referee, Role::Player];

    client.batch_assign_roles(addresss, roles);

    assert_eq!(client.get_role(&operator), Role::Operator);
    assert_eq!(client.get_role(&referee), Role::Referee);
    assert_eq!(client.get_role(&player), Role::Player);
}

#[test]
#[should_panic(expected = "addresses and roles arrays must have same length")]
fn test_batch_assign_roles_mismatched_length_fails() {
    let (env, admin, operator, referee, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    env.mock_all_auths();

    let addresses = vec![&env, operator.clone(), referee.clone()];
    let roles = vec![&env, Role::Operator];

    client.batch_assign_roles(addresses, roles);
}

#[test]
#[should_panic(expected = "use revoke_role to remove roles")]
fn test_batch_assign_roles_with_none_fails() {
    let (env, admin, operator, referee, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    env.mock_all_auths();

    let addresses = vec![&env, operator.clone(), referee.clone()];
    let roles = vec![&env, Role::Operator, Role::None];

    client.batch_assign_roles(addresses, roles);
}

#[test]
fn test_transfer_admin() {
    let (env, admin, operator, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    env.mock_all_auths();

    assert_eq!(client.get_admin(), admin);
    client.transfer_admin(&operator);

    assert_eq!(client.get_admin(), operator);
    assert_eq!(client.get_role(&operator), Role::Admin);
    assert_eq!(client.get_role(&admin), Role::None);
}

#[test]
#[should_panic(expected = "new admin must have no existing role")]
fn test_transfer_admin_with_existing_role_fails() {
    let (env, admin, operator, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.assign_role(&operator, Role::Operator);
    client.transfer_admin(&operator);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_transfer_admin_unauthorized() {
    let (env, admin, operator, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    client.transfer_admin(&operator);
}

#[test]
fn test_all_role_types() {
    let (env, admin, operator, referee, player) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.assign_role(&operator, Role::Operator);
    client.assign_role(&referee, Role::Referee);
    client.assign_role(&player, Role::Player);

    assert_eq!(client.get_role(&admin), Role::Admin);
    assert_eq!(client.get_role(&operator), Role::Operator);
    assert_eq!(client.get_role(&referee), Role::Referee);
    assert_eq!(client.get_role(&player), Role::Player);

    assert!(client.has_role(&admin, Role::Admin));
    assert!(client.has_role(&operator, Role::Operator));
    assert!(client.has_role(&referee, Role::Referee));
    assert!(client.has_role(&player, Role::Player));

    assert!(!client.has_role(&admin, Role::Operator));
    assert!(!client.has_role(&operator, Role::Referee));
    assert!(!client.has_role(&referee, Role::Player));
    assert!(!client.has_role(&player, Role::Admin));
}

#[test]
fn test_role_overwrite() {
    let (env, admin, operator, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    env.mock_all_auths();

    client.assign_role(&operator, Role::Operator);
    assert_eq!(client.get_role(&operator), Role::Operator);

    client.assign_role(&operator, Role::Referee);
    assert_eq!(client.get_role(&operator), Role::Referee);
    assert!(!client.has_role(&operator, Role::Operator));
    assert!(client.has_role(&operator, Role::Referee));
}

#[test]
fn test_multiple_contracts_whitelisting() {
    let (env, admin, _, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    let contract1 = Address::generate(&env);
    let contract2 = Address::generate(&env);
    let contract3 = Address::generate(&env);

    env.mock_all_auths();

    client.whitelist_contract(&contract1);
    client.whitelist_contract(&contract2);
    client.whitelist_contract(&contract3);

    assert!(client.is_contract_whitelisted(&contract1));
    assert!(client.is_contract_whitelisted(&contract2));
    assert!(client.is_contract_whitelisted(&contract3));

    client.remove_contract(&contract2);
    assert!(client.is_contract_whitelisted(&contract1));
    assert!(!client.is_contract_whitelisted(&contract2));
    assert!(client.is_contract_whitelisted(&contract3));
}

#[test]
fn test_cross_contract_integration_simulation() {
    let (env, admin, operator, referee, player) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    let match_contract = Address::generate(&env);
    let prize_contract = Address::generate(&env);

    env.mock_all_auths();

    client.whitelist_contract(&match_contract);
    client.whitelist_contract(&prize_contract);

    client.assign_role(&operator, Role::Operator);
    client.assign_role(&referee, Role::Referee);
    client.assign_role(&player, Role::Player);

    assert!(client.is_contract_whitelisted(&match_contract));
    assert!(client.is_contract_whitelisted(&prize_contract));

    let resolver_roles = vec![&env, Role::Admin, Role::Referee];
    assert!(client.has_any_role(&referee, resolver_roles));
    assert!(!client.has_any_role(&player, resolver_roles));

    let participant_roles = vec![&env, Role::Operator, Role::Player];
    assert!(client.has_any_role(&operator, participant_roles));
    assert!(client.has_any_role(&player, participant_roles));
    assert!(!client.has_any_role(&referee, participant_roles));
}

#[test]
fn test_edge_cases() {
    let (env, admin, operator, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = AuthGatewayClient::new(&env, &contract_id);

    env.mock_all_auths();

    let non_existent_address = Address::generate(&env);
    assert_eq!(client.get_role(&non_existent_address), Role::None);
    assert!(!client.has_role(&non_existent_address, Role::Admin));

    let non_whitelisted_contract = Address::generate(&env);
    assert!(!client.is_contract_whitelisted(&non_whitelisted_contract));

    let empty_roles = Vec::new(&env);
    assert!(!client.has_any_role(&operator, empty_roles));
}
