#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env, symbol_short};

#[test]
fn test_emergency_pause_workflow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_to_pause = Address::generate(&env);

    let contract_id = env.register(EmergencyPause, ());
    let client = EmergencyPauseClient::new(&env, &contract_id);

    // Initialize
    client.initialize(&admin);
    assert_eq!(client.get_admin(), admin);

    // Initial state: not paused
    assert!(!client.is_paused(&contract_to_pause, &None));

    // Pause contract wide
    let reason = symbol_short!("EXPLOIT");
    client.pause_contract(&admin, &contract_to_pause, &reason);
    assert!(client.is_paused(&contract_to_pause, &None));
    assert!(client.is_paused(&contract_to_pause, &Some(symbol_short!("submit"))));

    // Get metadata
    let metadata = client.get_pause_metadata(&contract_to_pause).unwrap();
    assert_eq!(metadata.paused_by, admin);
    assert_eq!(metadata.reason, reason);

    // Unpause contract
    client.unpause_contract(&admin, &contract_to_pause);
    assert!(!client.is_paused(&contract_to_pause, &None));

    // Function specific pause
    let func_name = symbol_short!("withdraw");
    client.pause_function(&admin, &contract_to_pause, &func_name, &reason);
    
    // Contract-wide should be false, but function should be paused
    assert!(!client.is_paused(&contract_to_pause, &None));
    assert!(client.is_paused(&contract_to_pause, &Some(func_name.clone())));
    assert!(!client.is_paused(&contract_to_pause, &Some(symbol_short!("deposit"))));

    // Unpause function
    client.unpause_function(&admin, &contract_to_pause, &func_name);
    assert!(!client.is_paused(&contract_to_pause, &Some(func_name)));
}

#[test]
fn test_batch_pause_check() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract1 = Address::generate(&env);
    let contract2 = Address::generate(&env);

    let contract_id = env.register(EmergencyPause, ());
    let client = EmergencyPauseClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.pause_contract(&admin, &contract1, &symbol_short!("BUG"));

    let mut contracts = Vec::new(&env);
    contracts.push_back(contract1.clone());
    contracts.push_back(contract2.clone());

    let mut functions = Vec::new(&env);
    functions.push_back(None);
    functions.push_back(None);

    let results = client.batch_is_paused(&contracts, &functions);
    assert_eq!(results.get(0).unwrap(), true);
    assert_eq!(results.get(1).unwrap(), false);
}
