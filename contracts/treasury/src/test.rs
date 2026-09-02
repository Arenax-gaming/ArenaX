#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env, Vec};

fn setup(env: &Env) -> (TreasuryClient<'_>, Address, Vec<Address>) {
    env.mock_all_auths();
    let contract_id = env.register(Treasury, ());
    let client = TreasuryClient::new(env, &contract_id);
    let admin = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    let signer2 = Address::generate(env);
    signers.push_back(signer2);

    client.initialize(&admin, &signers, &2, &3600);
    (client, admin, signers)
}

#[test]
fn pause_round_trip() {
    let env = Env::default();
    let (client, _admin, _signers) = setup(&env);

    assert!(!client.is_paused());
    client.set_paused(&_admin, &true);
    assert!(client.is_paused());
    client.set_paused(&_admin, &false);
    assert!(!client.is_paused());
}

#[test]
#[should_panic(expected = "caller is not admin")]
fn pause_by_non_admin_fails() {
    let env = Env::default();
    let (client, _admin, _signers) = setup(&env);

    let intruder = Address::generate(&env);
    client.set_paused(&intruder, &true);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn deposit_blocked_while_paused() {
    let env = Env::default();
    let (client, _admin, _signers) = setup(&env);

    client.set_paused(&_admin, &true);
    let depositor = Address::generate(&env);
    client.deposit(&depositor, &100);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn spending_proposal_blocked_while_paused() {
    let env = Env::default();
    let (client, admin, signers) = setup(&env);

    client.set_paused(&admin, &true);
    let recipient = Address::generate(&env);
    client.create_spending_proposal(
        &signers.get(1).unwrap(),
        &recipient,
        &100,
        &Symbol::new(&env, "ops"),
        &String::from_str(&env, "paused treasury"),
    );
}

#[test]
fn reads_work_while_paused() {
    let env = Env::default();
    let (client, admin, signers) = setup(&env);

    let depositor = Address::generate(&env);
    client.deposit(&depositor, &500);

    client.set_paused(&admin, &true);

    // Read entry points must stay available during an emergency stop.
    assert!(client.is_paused());
    assert_eq!(client.get_balance(), 500);
    assert_eq!(client.get_signers().len(), signers.len());
    assert_eq!(client.get_threshold(), 2);
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_dashboard().balance, 500);
}

#[test]
fn unpause_restores_mutations() {
    let env = Env::default();
    let (client, admin, _signers) = setup(&env);

    client.set_paused(&admin, &true);
    let depositor = Address::generate(&env);

    // Unpause restores normal operation.
    client.set_paused(&admin, &false);
    client.deposit(&depositor, &250);
    assert_eq!(client.get_balance(), 250);
}
