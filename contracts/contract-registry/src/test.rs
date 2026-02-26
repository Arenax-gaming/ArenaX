#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, Symbol, Vec,
};

fn create_test_env() -> (Env, Address, Address, Address) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract1 = Address::generate(&env);
    let contract2 = Address::generate(&env);
    (env, admin, contract1, contract2)
}

fn initialize_contract(env: &Env, admin: &Address) -> Address {
    let contract_id = Address::generate(env);
    env.register_contract(&contract_id, ContractRegistry);
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
    assert_eq!(contract_list.get(0), name);
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
#[should_panic(expected = "already initialized")]
fn test_register_contract_unauthorized() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");
    client.register_contract(&name, &contract1);
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
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "nonexistent");

    env.mock_all_auths();
    client.update_contract(&name, &contract2);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_update_contract_unauthorized() {
    let (env, admin, contract1, contract2) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);

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
#[should_panic(expected = "already initialized")]
fn test_remove_contract_unauthorized() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let name = Symbol::new(&env, "match_contract");

    env.mock_all_auths();
    client.register_contract(&name, &contract1);

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
#[should_panic(expected = "already initialized")]
fn test_pause_contract_unauthorized() {
    let (env, admin, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    client.set_paused(&true);
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
    client.register_contract(&name, &contract1);

    let contract_info = client.get_contract_info(&name);
    assert_eq!(contract_info.address, contract1);
    assert_eq!(contract_info.name, name);
    assert!(contract_info.registered_at > 0);
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

    let names = vec![&env, 
        Symbol::new(&env, "match_contract"),
        Symbol::new(&env, "token_contract"),
        Symbol::new(&env, "registry_contract")
    ];
    let addresses = vec![&env, contract1.clone(), contract2.clone(), contract1.clone()];

    env.mock_all_auths();
    client.batch_register_contracts(names, addresses);

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

    let names = vec![&env, 
        Symbol::new(&env, "match_contract"),
        Symbol::new(&env, "token_contract")
    ];
    let addresses = vec![&env, contract1];

    env.mock_all_auths();
    client.batch_register_contracts(names, addresses);
}

#[test]
#[should_panic(expected = "contract name cannot be empty")]
fn test_batch_register_empty_name_fails() {
    let (env, admin, contract1, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let names = vec![&env, 
        Symbol::new(&env, "match_contract"),
        Symbol::new(&env, "")
    ];
    let addresses = vec![&env, contract1.clone(), contract1];

    env.mock_all_auths();
    client.batch_register_contracts(names, addresses);
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

    let registry_address = env.current_contract_address();
    let contracts_by_registrar = client.get_contracts_by_registrar(registry_address);
    
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

    let updated_contracts = client.get_contracts_updated_in_range(1500, 2500);
    assert_eq!(updated_contracts.len(), 1);
    assert!(updated_contracts.contains(&name1));

    let updated_contracts = client.get_contracts_updated_in_range(500, 1500);
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
#[should_panic(expected = "already initialized")]
fn test_transfer_admin_unauthorized() {
    let (env, admin, _, _) = create_test_env();
    let contract_id = initialize_contract(&env, &admin);
    let client = ContractRegistryClient::new(&env, &contract_id);

    let new_admin = Address::generate(&env);
    client.transfer_admin(&new_admin);
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
    assert_eq!(contract_info.registered_by, env.current_contract_address());

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
    let (env, admin, contract1, _) = create_test_env();
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
    let (env, admin, contract1, contract2) = create_test_env();
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
