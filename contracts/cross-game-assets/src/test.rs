#![cfg(test)]

use super::lock::LOCK_DURATION_SECS;
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    Symbol, TryFromVal, Val,
};

fn make_id(env: &Env, seed: u8) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[0] = seed;
    BytesN::from_array(env, &bytes)
}

struct Setup<'a> {
    client: CrossGameAssetsClient<'a>,
    admin: Address,
    game: Address,
    other_game: Address,
    player: Address,
    asset_id: BytesN<32>,
}

fn setup<'a>(env: &'a Env) -> Setup<'a> {
    env.mock_all_auths();
    let contract_id = env.register(CrossGameAssets, ());
    let client = CrossGameAssetsClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let game = Address::generate(env);
    let other_game = Address::generate(env);
    let player = Address::generate(env);
    let asset_id = make_id(env, 1);

    client.initialize(&admin);
    client.register_game(&0, &game);
    client.register_game(&1, &other_game);
    client.register_asset(
        &asset_id,
        &1,
        &0,
        &String::from_str(env, "sword"),
        &3,
        &0,
        &true,
        &true,
    );
    client.mint(&game, &player, &asset_id, &10, &0);
    client.register_chain(
        &String::from_str(env, "ethereum"),
        &String::from_str(env, "Ethereum"),
        &Address::generate(env),
        &1000,
        &10,
        &0,
    );

    Setup {
        client,
        admin,
        game,
        other_game,
        player,
        asset_id,
    }
}

fn has_event(env: &Env, name: &str, locker: &Address, timestamp: u64) -> bool {
    let expected = Symbol::new(env, name);
    let events = env.events().all();
    for i in 0..events.len() {
        let (_, topics, event_data) = events.get(i).unwrap();
        if topics.is_empty() {
            continue;
        }
        let first: Val = topics.get(0).unwrap();
        if let Ok(sym) = Symbol::try_from_val(env, &first) {
            if sym == expected {
                if let Ok((event_locker, event_timestamp)) =
                    <(Address, u64)>::try_from_val(env, &event_data)
                {
                    if &event_locker == locker && event_timestamp == timestamp {
                        return true;
                    }
                }
            }
        }
    }
    false
}

#[test]
fn test_lock_unlock_events_carry_locker_and_timestamp() {
    let env = Env::default();
    let s = setup(&env);
    env.ledger().set_timestamp(1000);

    s.client.lock_asset(&s.game, &s.player, &s.asset_id, &0);
    assert!(has_event(&env, "asset_locked", &s.game, 1000));

    let lock = s.client.get_asset_lock(&s.player, &s.asset_id).unwrap();
    assert_eq!(lock.owner, s.player);
    assert_eq!(lock.asset_id, s.asset_id);
    assert_eq!(lock.locker, s.game);
    assert_eq!(lock.game_id, 0);
    assert_eq!(lock.locked_at, 1000);
    assert_eq!(lock.expires_at, 1000 + LOCK_DURATION_SECS);
    assert!(s.client.is_asset_locked(&s.player, &s.asset_id));

    env.ledger().set_timestamp(2000);
    s.client.unlock_asset(&s.game, &s.player, &s.asset_id);
    assert!(has_event(&env, "asset_unlocked", &s.game, 2000));

    assert!(!s.client.is_asset_locked(&s.player, &s.asset_id));
    assert!(s.client.get_asset_lock(&s.player, &s.asset_id).is_none());
}

#[test]
#[should_panic(expected = "asset_locked")]
fn test_cross_chain_transfer_of_locked_asset_is_rejected() {
    let env = Env::default();
    let s = setup(&env);
    s.client.lock_asset(&s.game, &s.player, &s.asset_id, &0);

    s.client.initiate_bridge(
        &s.player,
        &s.asset_id,
        &5,
        &String::from_str(&env, "ethereum"),
        &0,
        &1,
    );
}

#[test]
#[should_panic(expected = "asset_locked")]
fn test_regular_transfer_of_locked_asset_is_rejected() {
    let env = Env::default();
    let s = setup(&env);
    s.client.lock_asset(&s.game, &s.player, &s.asset_id, &0);

    s.client
        .transfer(&s.player, &Address::generate(&env), &s.asset_id, &1, &0, &1);
}

#[test]
fn test_transfer_allowed_after_game_releases_lock() {
    let env = Env::default();
    let s = setup(&env);
    let recipient = Address::generate(&env);
    s.client.lock_asset(&s.game, &s.player, &s.asset_id, &0);
    s.client.unlock_asset(&s.game, &s.player, &s.asset_id);

    s.client
        .transfer(&s.player, &recipient, &s.asset_id, &4, &0, &1);

    assert_eq!(s.client.get_balance(&s.player, &s.asset_id), 6);
    assert_eq!(s.client.get_balance(&recipient, &s.asset_id), 4);
}

#[test]
#[should_panic(expected = "caller is not the locker")]
fn test_unlock_by_wrong_contract_is_rejected() {
    let env = Env::default();
    let s = setup(&env);
    s.client.lock_asset(&s.game, &s.player, &s.asset_id, &0);

    s.client.unlock_asset(&s.other_game, &s.player, &s.asset_id);
}

#[test]
#[should_panic(expected = "caller not authorised")]
fn test_unregistered_contract_cannot_lock_asset() {
    let env = Env::default();
    let s = setup(&env);
    let stranger = Address::generate(&env);

    s.client.lock_asset(&stranger, &s.player, &s.asset_id, &0);
}

#[test]
fn test_lock_expires_after_24_hours() {
    let env = Env::default();
    let s = setup(&env);
    env.ledger().set_timestamp(1000);
    s.client.lock_asset(&s.game, &s.player, &s.asset_id, &0);

    env.ledger().set_timestamp(1000 + LOCK_DURATION_SECS - 1);
    assert!(s.client.is_asset_locked(&s.player, &s.asset_id));

    env.ledger().set_timestamp(1000 + LOCK_DURATION_SECS);
    assert!(!s.client.is_asset_locked(&s.player, &s.asset_id));
    assert!(s.client.get_asset_lock(&s.player, &s.asset_id).is_none());

    let request_id = s.client.initiate_bridge(
        &s.player,
        &s.asset_id,
        &5,
        &String::from_str(&env, "ethereum"),
        &0,
        &1,
    );
    let request = s.client.get_bridge_request(&request_id).unwrap();
    assert_eq!(request.status, BRIDGE_STATUS_PENDING);
    assert_eq!(request.amount, 5);
}

#[test]
fn test_relock_after_unlock_uses_new_locker() {
    let env = Env::default();
    let s = setup(&env);
    s.client.lock_asset(&s.game, &s.player, &s.asset_id, &0);
    s.client.unlock_asset(&s.game, &s.player, &s.asset_id);

    s.client
        .lock_asset(&s.other_game, &s.player, &s.asset_id, &1);
    assert!(has_event(&env, "asset_locked", &s.other_game, 0));

    let lock = s.client.get_asset_lock(&s.player, &s.asset_id).unwrap();
    assert_eq!(lock.locker, s.other_game);
    assert_eq!(lock.game_id, 1);
}

#[test]
fn test_admin_can_lock_and_unlock() {
    let env = Env::default();
    let s = setup(&env);

    s.client.lock_asset(&s.admin, &s.player, &s.asset_id, &0);
    assert_eq!(
        s.client
            .get_asset_lock(&s.player, &s.asset_id)
            .unwrap()
            .locker,
        s.admin
    );
    s.client.unlock_asset(&s.admin, &s.player, &s.asset_id);
    assert!(!s.client.is_asset_locked(&s.player, &s.asset_id));
}
