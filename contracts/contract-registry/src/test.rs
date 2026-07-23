#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger as _},
    Address, Env, Symbol,
};

fn create_test_env() -> (Env, Address, Address, Address) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract1 = Address::generate(&env);
    let contract2 = Address::generate(&env);
    (env, admin, contract1, contract2)
}

fn initialize_contract(env: &Env, admin: &Address) -> Address {
    let contract_id = env.register(ContractRegistry, ());
    let client = ContractRegistryClient::new(env, &contract_id);

    env.mock_all_auths();
    client.initialize(admin);

    contract_id
}

#[test]
fn test_initialization() {
    let (env, admin, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    assert_eq!(client.get_admin(), admin);
    assert!(!client.is_paused());
    assert_eq!(client.get_contract_count(), 0);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialization() {
    let (env, admin, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    client.initialize(&admin);
}

#[test]
fn test_register_contract() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);

    assert!(client.is_contract_registered(&name));
    assert_eq!(client.get_contract(&name), contract1);
    assert_eq!(client.get_contract_count(), 1);

    let contract_list = client.list_contracts();
    assert_eq!(contract_list.len(), 1);
    assert_eq!(contract_list.get(0), Some(name));
}

#[test]
#[should_panic(expected = "contract name cannot be empty")]
fn test_register_empty_name_fails() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let empty_name = Symbol::new(&env, "");

    env.mock_all_auths();
    client.register_contract(&empty_name, &contract1);
}

#[test]
#[should_panic(expected = "contract name already registered")]
fn test_register_duplicate_name_fails() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.register_contract(&name, &contract2);
}

#[test]
fn test_update_contract() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    assert_eq!(client.get_contract(&name), contract1);

    client.update_contract(&name, &contract2);
    assert_eq!(client.get_contract(&name), contract2);

    let contract_info = client.get_contract_info(&name);
    assert_eq!(contract_info.address, contract2);
    assert!(contract_info.updated_at.is_some());
}

#[test]
#[should_panic(expected = "new address is the same as current address")]
fn test_update_same_address_fails() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.update_contract(&name, &contract1);
}

#[test]
#[should_panic(expected = "contract not registered")]
fn test_update_nonexistent_contract_fails() {
    let (env, admin, _contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "nonexistent");

    env.mock_all_auths();
    client.update_contract(&name, &contract2);
}

#[test]
fn test_remove_contract() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    assert!(client.is_contract_registered(&name));
    assert_eq!(client.get_contract_count(), 1);

    client.remove_contract(&name);
    assert!(!client.is_contract_registered(&name));
    assert_eq!(client.get_contract_count(), 0);
}

#[test]
#[should_panic(expected = "contract not registered")]
fn test_remove_nonexistent_contract_fails() {
    let (env, admin, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "nonexistent");

    env.mock_all_auths();
    client.remove_contract(&name);
}

#[test]
fn test_pause_contract() {
    let (env, admin, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    env.mock_all_auths();

    assert!(!client.is_paused());
    client.set_paused(&true);
    assert!(client.is_paused());
    client.set_paused(&false);
    assert!(!client.is_paused());
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_operations_when_paused() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.set_paused(&true);

    client.register_contract(&name, &contract1);
}

#[test]
fn test_get_contract_info() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    env.ledger().set_timestamp(1000);
    client.register_contract(&name, &contract1);

    let contract_info = client.get_contract_info(&name);
    assert_eq!(contract_info.address, contract1);
    assert_eq!(contract_info.name, name);
    assert_eq!(contract_info.registered_at, 1000);
    assert!(contract_info.updated_at.is_none());
}

#[test]
fn test_list_contracts() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name1 = Symbol::new(&env, "match_contract");
    let name2 = Symbol::new(&env, "token_contract");
    let name3 = Symbol::new(&env, "registry_contract");

    env.mock_all_auths();

    client.register_contract(&name1, &contract1);
    client.register_contract(&name2, &contract2);
    client.register_contract(&name3, &contract1);

    let contract_list = client.list_contracts();
    assert_eq!(contract_list.len(), 3);
    assert_eq!(client.get_contract_count(), 3);

    assert!(contract_list.contains(&name1));
    assert!(contract_list.contains(&name2));
    assert!(contract_list.contains(&name3));
}

#[test]
fn test_batch_register_contracts() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let names = soroban_sdk::vec![
        &env,
        Symbol::new(&env, "match_contract"),
        Symbol::new(&env, "token_contract"),
        Symbol::new(&env, "registry_contract")
    ];
    let addresses = soroban_sdk::vec![
        &env,
        contract1.clone(),
        contract2.clone(),
        contract1.clone()
    ];

    env.mock_all_auths();
    client.batch_register_contracts(&names, &addresses);

    assert_eq!(client.get_contract_count(), 3);
    assert!(client.is_contract_registered(&Symbol::new(&env, "match_contract")));
    assert!(client.is_contract_registered(&Symbol::new(&env, "token_contract")));
    assert!(client.is_contract_registered(&Symbol::new(&env, "registry_contract")));
}

#[test]
#[should_panic(expected = "names and addresses arrays must have same length")]
fn test_batch_register_mismatched_length_fails() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let names = soroban_sdk::vec![
        &env,
        Symbol::new(&env, "match_contract"),
        Symbol::new(&env, "token_contract")
    ];
    let addresses = soroban_sdk::vec![&env, contract1];

    env.mock_all_auths();
    client.batch_register_contracts(&names, &addresses);
}

#[test]
#[should_panic(expected = "contract name cannot be empty")]
fn test_batch_register_empty_name_fails() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let names = soroban_sdk::vec![
        &env,
        Symbol::new(&env, "match_contract"),
        Symbol::new(&env, "")
    ];
    let addresses = soroban_sdk::vec![&env, contract1.clone(), contract1];

    env.mock_all_auths();
    client.batch_register_contracts(&names, &addresses);
}

#[test]
fn test_get_contracts_by_registrar() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name1 = Symbol::new(&env, "match_contract");
    let name2 = Symbol::new(&env, "token_contract");

    env.mock_all_auths();

    client.register_contract(&name1, &contract1);
    client.register_contract(&name2, &contract2);

    let contracts_by_registrar = client.get_contracts_by_registrar(&contract_id);

    assert_eq!(contracts_by_registrar.len(), 2);
    assert!(contracts_by_registrar.contains(&name1));
    assert!(contracts_by_registrar.contains(&name2));
}

#[test]
fn test_get_contracts_updated_in_range() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name1 = Symbol::new(&env, "match_contract");
    let name2 = Symbol::new(&env, "token_contract");

    env.mock_all_auths();

    env.ledger().set_timestamp(1000);
    client.register_contract(&name1, &contract1);
    client.register_contract(&name2, &contract2);

    env.ledger().set_timestamp(2000);
    client.update_contract(&name1, &contract2);

    let updated_contracts = client.get_contracts_updated_in_range(&1500, &2500);
    assert_eq!(updated_contracts.len(), 1);
    assert!(updated_contracts.contains(&name1));

    let updated_contracts = client.get_contracts_updated_in_range(&500, &1500);
    assert_eq!(updated_contracts.len(), 0);
}

#[test]
fn test_transfer_admin() {
    let (env, admin, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let new_admin = Address::generate(&env);

    env.mock_all_auths();
    client.transfer_admin(&new_admin);

    assert_eq!(client.get_admin(), new_admin);
}

#[test]
fn test_contract_info_metadata() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();

    env.ledger().set_timestamp(1000);
    client.register_contract(&name, &contract1);

    let contract_info = client.get_contract_info(&name);
    assert_eq!(contract_info.registered_at, 1000);
    assert!(contract_info.updated_at.is_none());
    assert_eq!(contract_info.registered_by, contract_id);

    env.ledger().set_timestamp(2000);
    client.update_contract(&name, &contract2);

    let updated_info = client.get_contract_info(&name);
    assert_eq!(updated_info.registered_at, 1000);
    assert_eq!(updated_info.updated_at, Some(2000));
    assert_eq!(updated_info.address, contract2);
}

#[test]
fn test_multiple_operations() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let match_name = Symbol::new(&env, "match_contract");
    let token_name = Symbol::new(&env, "token_contract");
    let registry_name = Symbol::new(&env, "registry_contract");

    env.mock_all_auths();

    client.register_contract(&match_name, &contract1);
    client.register_contract(&token_name, &contract2);
    client.register_contract(&registry_name, &contract1);

    assert_eq!(client.get_contract_count(), 3);
    assert_eq!(client.get_contract(&match_name), contract1);
    assert_eq!(client.get_contract(&token_name), contract2);
    assert_eq!(client.get_contract(&registry_name), contract1);

    client.update_contract(&match_name, &contract2);
    assert_eq!(client.get_contract(&match_name), contract2);

    client.remove_contract(&token_name);
    assert!(!client.is_contract_registered(&token_name));
    assert_eq!(client.get_contract_count(), 2);

    let remaining_contracts = client.list_contracts();
    assert_eq!(remaining_contracts.len(), 2);
    assert!(remaining_contracts.contains(&match_name));
    assert!(remaining_contracts.contains(&registry_name));
}

#[test]
fn test_edge_cases() {
    let (env, admin, _contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let nonexistent_name = Symbol::new(&env, "nonexistent");
    assert!(!client.is_contract_registered(&nonexistent_name));

    let empty_list = client.list_contracts();
    assert_eq!(empty_list.len(), 0);

    let empty_count = client.get_contract_count();
    assert_eq!(empty_count, 0);
}

#[test]
fn test_deterministic_resolution() {
    let (env, admin, contract1, _contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);

    let address1 = client.get_contract(&name);
    let address2 = client.get_contract(&name);
    let address3 = client.get_contract(&name);

    assert_eq!(address1, contract1);
    assert_eq!(address2, contract1);
    assert_eq!(address3, contract1);
    assert_eq!(address1, address2);
    assert_eq!(address2, address3);
}

// ========================================
// Version Management Tests
// ========================================

#[test]
fn test_register_first_version_auto_active() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");
    let notes = Symbol::new(&env, "initial_release");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.register_version(&admin, &name, &1, &contract1, &notes);

    let active = client.get_active_version(&name);
    assert_eq!(active.version, 1);
    assert_eq!(active.address, contract1);
    assert!(active.is_active);
    assert_eq!(active.notes, notes);
}

#[test]
fn test_register_subsequent_version_not_active() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");
    let notes = Symbol::new(&env, "v2_notes");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.register_version(&admin, &name, &1, &contract1, &symbol_short!("v1"));
    client.register_version(&admin, &name, &2, &contract2, &notes);

    let active = client.get_active_version(&name);
    assert_eq!(active.version, 1);

    let v2 = client.get_version(&name, &2);
    assert_eq!(v2.version, 2);
    assert_eq!(v2.address, contract2);
    assert!(!v2.is_active);
}

#[test]
#[should_panic(expected = "version already exists")]
fn test_register_duplicate_version_fails() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");
    let notes = symbol_short!("v1");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.register_version(&admin, &name, &1, &contract1, &notes);
    client.register_version(&admin, &name, &1, &contract1, &notes);
}

#[test]
#[should_panic(expected = "contract not registered")]
fn test_register_version_for_unregistered_contract_fails() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "nonexistent");
    let notes = symbol_short!("v1");

    env.mock_all_auths();
    client.register_version(&admin, &name, &1, &contract1, &notes);
}

#[test]
fn test_set_active_version() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.register_version(&admin, &name, &1, &contract1, &symbol_short!("v1"));
    client.register_version(&admin, &name, &2, &contract2, &symbol_short!("v2"));

    client.set_active_version(&admin, &name, &2);

    let active = client.get_active_version(&name);
    assert_eq!(active.version, 2);
    assert!(active.is_active);

    let v1 = client.get_version(&name, &1);
    assert!(!v1.is_active);
}

#[test]
#[should_panic(expected = "version not found")]
fn test_set_active_version_nonexistent_fails() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.set_active_version(&admin, &name, &99);
}

#[test]
fn test_get_version_history() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.register_version(&admin, &name, &1, &contract1, &symbol_short!("v1"));
    client.register_version(&admin, &name, &2, &contract2, &symbol_short!("v2"));
    client.register_version(&admin, &name, &3, &contract1, &symbol_short!("v3"));

    let history = client.get_version_history(&name);
    assert_eq!(history.len(), 3);
    assert_eq!(history.get(0).unwrap().version, 1);
    assert_eq!(history.get(1).unwrap().version, 2);
    assert_eq!(history.get(2).unwrap().version, 3);
}

#[test]
fn test_get_version_history_empty() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);

    let history = client.get_version_history(&name);
    assert_eq!(history.len(), 0);
}

#[test]
fn test_deprecate_version() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.register_version(&admin, &name, &1, &contract1, &symbol_short!("v1"));
    client.register_version(&admin, &name, &2, &contract2, &symbol_short!("v2"));

    client.set_active_version(&admin, &name, &2);

    client.deprecate_version(&admin, &name, &1);

    let v1 = client.get_version(&name, &1);
    assert!(!v1.is_active);

    let v2 = client.get_version(&name, &2);
    assert!(v2.is_active);

    let history = client.get_version_history(&name);
    assert_eq!(history.len(), 2);
}

#[test]
fn test_deprecate_active_version_removes_active() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.register_version(&admin, &name, &1, &contract1, &symbol_short!("v1"));

    client.deprecate_version(&admin, &name, &1);

    let v1 = client.get_version(&name, &1);
    assert!(!v1.is_active);

    let history = client.get_version_history(&name);
    assert_eq!(history.len(), 1);
    assert!(!history.get(0).unwrap().is_active);
}

#[test]
#[should_panic(expected = "version not found")]
fn test_deprecate_nonexistent_version_fails() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.deprecate_version(&admin, &name, &99);
}

#[test]
fn test_get_latest_version() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.register_version(&admin, &name, &1, &contract1, &symbol_short!("v1"));
    client.register_version(&admin, &name, &2, &contract2, &symbol_short!("v2"));

    let latest = client.get_latest_version(&name);
    assert_eq!(latest.version, 2);
    assert_eq!(latest.address, contract2);
}

#[test]
#[should_panic(expected = "no versions registered")]
fn test_get_latest_version_no_versions_fails() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.get_latest_version(&name);
}

#[test]
fn test_version_deployment_timestamp() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    env.ledger().set_timestamp(5000);
    client.register_contract(&name, &contract1);
    client.register_version(&admin, &name, &1, &contract1, &symbol_short!("v1"));

    let v1 = client.get_version(&name, &1);
    assert_eq!(v1.deployed_at, 5000);
    assert_eq!(v1.deployed_by, admin);
}

// ========================================
// Discovery Tests
// ========================================

#[test]
fn test_get_contract_by_address() {
    let (env, admin, contract1, _contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);

    let found_name = client.get_contract_by_address(&contract1);
    assert_eq!(found_name, name);
}

#[test]
#[should_panic(expected = "no contract found for address")]
fn test_get_contract_by_address_not_found_fails() {
    let (env, admin, _, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.get_contract_by_address(&contract2);
}

#[test]
fn test_set_and_get_contract_category() {
    let (env, admin, contract1, _contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");
    let category = Symbol::new(&env, "gaming");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.set_contract_category(&admin, &name, &category);

    let result = client.get_contracts_by_category(&category);
    assert_eq!(result.len(), 1);
    assert_eq!(result.get(0), Some(name));
}

#[test]
fn test_get_contracts_by_category_multiple() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name1 = Symbol::new(&env, "match_contract");
    let name2 = Symbol::new(&env, "token_contract");
    let name3 = Symbol::new(&env, "escrow_contract");
    let gaming = Symbol::new(&env, "gaming");
    let defi = Symbol::new(&env, "defi");

    env.mock_all_auths();
    client.register_contract(&name1, &contract1);
    client.register_contract(&name2, &contract2);
    client.register_contract(&name3, &contract1);

    client.set_contract_category(&admin, &name1, &gaming);
    client.set_contract_category(&admin, &name2, &defi);
    client.set_contract_category(&admin, &name3, &gaming);

    let gaming_contracts = client.get_contracts_by_category(&gaming);
    assert_eq!(gaming_contracts.len(), 2);
    assert!(gaming_contracts.contains(&name1));
    assert!(gaming_contracts.contains(&name3));

    let defi_contracts = client.get_contracts_by_category(&defi);
    assert_eq!(defi_contracts.len(), 1);
    assert!(defi_contracts.contains(&name2));
}

#[test]
fn test_list_categories() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name1 = Symbol::new(&env, "match_contract");
    let name2 = Symbol::new(&env, "token_contract");
    let gaming = Symbol::new(&env, "gaming");
    let defi = Symbol::new(&env, "defi");

    env.mock_all_auths();
    client.register_contract(&name1, &contract1);
    client.register_contract(&name2, &contract2);

    client.set_contract_category(&admin, &name1, &gaming);
    client.set_contract_category(&admin, &name2, &defi);

    let categories = client.list_categories();
    assert_eq!(categories.len(), 2);
    assert!(categories.contains(&gaming));
    assert!(categories.contains(&defi));
}

#[test]
fn test_list_categories_no_duplicates() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name1 = Symbol::new(&env, "match_contract");
    let name2 = Symbol::new(&env, "token_contract");
    let gaming = Symbol::new(&env, "gaming");

    env.mock_all_auths();
    client.register_contract(&name1, &contract1);
    client.register_contract(&name2, &contract2);

    client.set_contract_category(&admin, &name1, &gaming);
    client.set_contract_category(&admin, &name2, &gaming);

    let categories = client.list_categories();
    assert_eq!(categories.len(), 1);
}

#[test]
fn test_search_contracts() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name1 = Symbol::new(&env, "match_v1");
    let name2 = Symbol::new(&env, "match_v2");
    let name3 = Symbol::new(&env, "token_v1");

    env.mock_all_auths();
    client.register_contract(&name1, &contract1);
    client.register_contract(&name2, &contract2);
    client.register_contract(&name3, &contract1);

    let prefix = Symbol::new(&env, "match");
    let results = client.search_contracts(&prefix);
    assert_eq!(results.len(), 2);
    assert!(results.contains(&name1));
    assert!(results.contains(&name2));
    assert!(!results.contains(&name3));
}

#[test]
fn test_search_contracts_no_match() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);

    let prefix = Symbol::new(&env, "zzz");
    let results = client.search_contracts(&prefix);
    assert_eq!(results.len(), 0);
}

// ========================================
// Contract Status Tests
// ========================================

#[test]
fn test_set_and_get_contract_status() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");
    let active = Symbol::new(&env, "active");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);

    let status = client.get_contract_status(&name);
    assert_eq!(status, active);

    let deprecated = Symbol::new(&env, "deprecated");
    client.set_contract_status(&admin, &name, &deprecated);

    let status = client.get_contract_status(&name);
    assert_eq!(status, deprecated);
}

#[test]
fn test_contract_status_transitions() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);

    let active = Symbol::new(&env, "active");
    let suspended = Symbol::new(&env, "suspended");
    let deprecated = Symbol::new(&env, "deprecated");

    assert_eq!(client.get_contract_status(&name), active);

    client.set_contract_status(&admin, &name, &suspended);
    assert_eq!(client.get_contract_status(&name), suspended);

    client.set_contract_status(&admin, &name, &deprecated);
    assert_eq!(client.get_contract_status(&name), deprecated);
}

#[test]
#[should_panic(expected = "contract not registered")]
fn test_set_status_for_unregistered_contract_fails() {
    let (env, admin, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "nonexistent");
    let status = Symbol::new(&env, "active");

    env.mock_all_auths();
    client.set_contract_status(&admin, &name, &status);
}

#[test]
#[should_panic(expected = "contract not registered")]
fn test_get_status_for_unregistered_contract_fails() {
    let (env, admin, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "nonexistent");
    client.get_contract_status(&name);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_version_operations_when_paused() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.set_paused(&true);
    client.register_version(&admin, &name, &1, &contract1, &symbol_short!("v1"));
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_category_operations_when_paused() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");
    let category = Symbol::new(&env, "gaming");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.set_paused(&true);
    client.set_contract_category(&admin, &name, &category);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_status_operations_when_paused() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");
    let status = Symbol::new(&env, "deprecated");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.set_paused(&true);
    client.set_contract_status(&admin, &name, &status);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_set_active_version_when_paused() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.register_version(&admin, &name, &1, &contract1, &symbol_short!("v1"));
    client.register_version(&admin, &name, &2, &contract2, &symbol_short!("v2"));
    client.set_paused(&true);
    client.set_active_version(&admin, &name, &2);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_deprecate_version_when_paused() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);
    client.register_version(&admin, &name, &1, &contract1, &symbol_short!("v1"));
    client.set_paused(&true);
    client.deprecate_version(&admin, &name, &1);
}
