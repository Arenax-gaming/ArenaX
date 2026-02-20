#![cfg(test)]
#![allow(deprecated)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Bytes, Env, Symbol};

#[test]
fn test_init() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ProtocolParamsContract);
    let client = ProtocolParamsContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.init(&admin);
}

#[test]
fn test_set_and_get_param() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ProtocolParamsContract);
    let client = ProtocolParamsContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.init(&admin);

    let key = Symbol::new(&env, "max_fee");
    let value = Bytes::from_slice(&env, b"100");

    client.set_param(&key, &value);

    let retrieved = client.get_param(&key, &None);
    assert_eq!(retrieved, Some(value));

    let version = client.get_latest_version(&key);
    assert_eq!(version, 1);
}

#[test]
fn test_versioning() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ProtocolParamsContract);
    let client = ProtocolParamsContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.init(&admin);

    let key = Symbol::new(&env, "limit");
    let val1 = Bytes::from_slice(&env, b"1000");
    let val2 = Bytes::from_slice(&env, b"2000");

    client.set_param(&key, &val1);
    assert_eq!(client.get_latest_version(&key), 1);
    assert_eq!(client.get_param(&key, &Some(1)), Some(val1.clone()));

    client.set_param(&key, &val2);
    assert_eq!(client.get_latest_version(&key), 2);
    assert_eq!(client.get_param(&key, &Some(2)), Some(val2));
    assert_eq!(client.get_param(&key, &Some(1)), Some(val1));
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_double_init() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ProtocolParamsContract);
    let client = ProtocolParamsContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.init(&admin);
    client.init(&admin);
}
