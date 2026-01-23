#![cfg(test)]
extern crate std;

use crate::{ArenaXRegistry, ArenaXRegistryClient, RegistryError};
use soroban_sdk::{testutils::Address as _, testutils::BytesN as _, Address, BytesN, Env};

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXRegistry, ());
    let client = ArenaXRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&admin);

    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_initialize_twice_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXRegistry, ());
    let client = ArenaXRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&admin);
    let result = client.try_initialize(&admin);

    assert_eq!(result, Err(Ok(RegistryError::AlreadyInitialized)));
}

#[test]
fn test_register_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXRegistry, ());
    let client = ArenaXRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let contract_addr = Address::generate(&env);

    client.initialize(&admin);

    let name = BytesN::random(&env);
    client.register_contract(&name, &contract_addr);

    let retrieved = client.get_contract(&name);
    assert_eq!(retrieved, Some(contract_addr));
}

#[test]
fn test_register_duplicate_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXRegistry, ());
    let client = ArenaXRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let addr1 = Address::generate(&env);
    let addr2 = Address::generate(&env);

    client.initialize(&admin);

    let name = BytesN::random(&env);
    client.register_contract(&name, &addr1);

    // Attempting to register the same name should fail
    let result = client.try_register_contract(&name, &addr2);
    assert_eq!(result, Err(Ok(RegistryError::ContractAlreadyExists)));

    // Original address should remain unchanged
    assert_eq!(client.get_contract(&name), Some(addr1));
}

#[test]
fn test_register_multiple_contracts() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXRegistry, ());
    let client = ArenaXRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token_addr = Address::generate(&env);
    let vault_addr = Address::generate(&env);
    let oracle_addr = Address::generate(&env);

    client.initialize(&admin);

    let token_name = BytesN::random(&env);
    let vault_name = BytesN::random(&env);
    let oracle_name = BytesN::random(&env);

    client.register_contract(&token_name, &token_addr);
    client.register_contract(&vault_name, &vault_addr);
    client.register_contract(&oracle_name, &oracle_addr);

    assert_eq!(client.get_contract(&token_name), Some(token_addr));
    assert_eq!(client.get_contract(&vault_name), Some(vault_addr));
    assert_eq!(client.get_contract(&oracle_name), Some(oracle_addr));
}

#[test]
fn test_get_contract_not_found() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXRegistry, ());
    let client = ArenaXRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&admin);

    let name = BytesN::random(&env);
    let result = client.get_contract(&name);
    assert_eq!(result, None);
}

#[test]
fn test_list_contracts_empty() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXRegistry, ());
    let client = ArenaXRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&admin);

    let contracts = client.list_contracts();
    assert_eq!(contracts.len(), 0);
}

#[test]
fn test_list_contracts() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXRegistry, ());
    let client = ArenaXRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token_addr = Address::generate(&env);
    let vault_addr = Address::generate(&env);

    client.initialize(&admin);

    let token_name = BytesN::random(&env);
    let vault_name = BytesN::random(&env);

    client.register_contract(&token_name, &token_addr);
    client.register_contract(&vault_name, &vault_addr);

    let contracts = client.list_contracts();
    assert_eq!(contracts.len(), 2);

    // Verify entries exist with correct addresses
    let has_token = contracts
        .iter()
        .any(|e| e.name == token_name && e.address == token_addr);
    let has_vault = contracts
        .iter()
        .any(|e| e.name == vault_name && e.address == vault_addr);

    assert!(has_token, "token entry should exist");
    assert!(has_vault, "vault entry should exist");
}

#[test]
fn test_update_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXRegistry, ());
    let client = ArenaXRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let old_addr = Address::generate(&env);
    let new_addr = Address::generate(&env);

    client.initialize(&admin);

    let name = BytesN::random(&env);
    client.register_contract(&name, &old_addr);
    assert_eq!(client.get_contract(&name), Some(old_addr));

    // Use update_contract to change the address
    client.update_contract(&name, &new_addr);
    assert_eq!(client.get_contract(&name), Some(new_addr.clone()));

    let contracts = client.list_contracts();
    assert_eq!(contracts.len(), 1);
    assert_eq!(contracts.get(0).unwrap().address, new_addr);
}

#[test]
fn test_update_nonexistent_contract_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXRegistry, ());
    let client = ArenaXRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let addr = Address::generate(&env);

    client.initialize(&admin);

    let name = BytesN::random(&env);
    let result = client.try_update_contract(&name, &addr);
    assert_eq!(result, Err(Ok(RegistryError::ContractNotFound)));
}

#[test]
fn test_timestamps() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXRegistry, ());
    let client = ArenaXRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let addr1 = Address::generate(&env);
    let addr2 = Address::generate(&env);

    client.initialize(&admin);

    let name = BytesN::random(&env);
    client.register_contract(&name, &addr1);

    let contracts = client.list_contracts();
    let entry = contracts.get(0).unwrap();
    let registered_at = entry.registered_at;
    let updated_at = entry.updated_at;

    // Initially registered_at and updated_at should be equal
    assert_eq!(registered_at, updated_at);

    // Update the contract
    client.update_contract(&name, &addr2);

    let contracts = client.list_contracts();
    let updated_entry = contracts.get(0).unwrap();

    // registered_at should remain the same
    assert_eq!(updated_entry.registered_at, registered_at);
    // updated_at should be >= the original (in tests it may be same since ledger time doesn't advance)
    assert!(updated_entry.updated_at >= registered_at);
}

#[test]
fn test_register_without_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXRegistry, ());
    let client = ArenaXRegistryClient::new(&env, &contract_id);
    let contract_addr = Address::generate(&env);
    let name = BytesN::random(&env);

    let result = client.try_register_contract(&name, &contract_addr);
    assert_eq!(result, Err(Ok(RegistryError::NotInitialized)));
}

#[test]
fn test_update_without_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXRegistry, ());
    let client = ArenaXRegistryClient::new(&env, &contract_id);
    let contract_addr = Address::generate(&env);
    let name = BytesN::random(&env);

    let result = client.try_update_contract(&name, &contract_addr);
    assert_eq!(result, Err(Ok(RegistryError::NotInitialized)));
}

#[test]
fn test_list_contracts_without_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXRegistry, ());
    let client = ArenaXRegistryClient::new(&env, &contract_id);

    let result = client.try_list_contracts();
    assert_eq!(result, Err(Ok(RegistryError::NotInitialized)));
}

#[test]
fn test_get_admin_without_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ArenaXRegistry, ());
    let client = ArenaXRegistryClient::new(&env, &contract_id);

    let result = client.try_get_admin();
    assert_eq!(result, Err(Ok(RegistryError::NotInitialized)));
}

#[test]
fn test_admin_auth_required() {
    let env = Env::default();
    let contract_id = env.register(ArenaXRegistry, ());
    let client = ArenaXRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let contract_addr = Address::generate(&env);

    client.initialize(&admin);

    env.mock_all_auths();

    let name = BytesN::random(&env);
    client.register_contract(&name, &contract_addr);

    let auths = env.auths();
    assert!(!auths.is_empty(), "should have auth entries");

    let (auth_addr, _) = &auths[0];
    assert_eq!(*auth_addr, admin);
    assert_ne!(*auth_addr, non_admin);
}

#[test]
fn test_update_admin_auth_required() {
    let env = Env::default();
    let contract_id = env.register(ArenaXRegistry, ());
    let client = ArenaXRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let contract_addr = Address::generate(&env);
    let new_addr = Address::generate(&env);

    client.initialize(&admin);

    env.mock_all_auths();

    let name = BytesN::random(&env);
    client.register_contract(&name, &contract_addr);

    // Clear auths and test update
    env.mock_all_auths();
    client.update_contract(&name, &new_addr);

    let auths = env.auths();
    assert!(!auths.is_empty(), "should have auth entries");

    let (auth_addr, _) = &auths[0];
    assert_eq!(*auth_addr, admin);
    assert_ne!(*auth_addr, non_admin);
}
