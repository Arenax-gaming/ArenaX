#![cfg(test)]

extern crate std;

use super::*;
use composable_example::tournament_hooks::{
    ComposableTournamentHooks, ComposableTournamentHooksClient, STAGE_COMPLETE, STAGE_REGISTER,
    STAGE_START,
};
use soroban_sdk::{testutils::Address as _, vec, Bytes, Env};
use tournament_hooks_noop::NoopTournamentHooks;

struct Setup<'a> {
    env: Env,
    tournament: SponsoredTournamentContractClient<'a>,
    tournament_id: u64,
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(SponsoredTournamentContract, ());
    let tournament = SponsoredTournamentContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    tournament.initialize(&admin);
    let tournament_id = tournament.create_community_tournament(
        &organizer,
        &Address::generate(&env),
        &0i128,
        &Address::generate(&env),
        &false,
        &Bytes::from_slice(&env, b"telemetry"),
    );
    tournament.approve_tournament(&admin, &tournament_id);

    Setup {
        env,
        tournament,
        tournament_id,
    }
}

fn deploy_hooks<'a>(s: &Setup<'a>) -> ComposableTournamentHooksClient<'a> {
    let hook_id = s.env.register(ComposableTournamentHooks, ());
    let hooks = ComposableTournamentHooksClient::new(&s.env, &hook_id);
    hooks.hook_initialize(&Address::generate(&s.env), &s.tournament.address);
    s.tournament.set_tournament_hook(&s.tournament_id, &hook_id);
    hooks
}

#[test]
fn test_hooks_fire_in_lifecycle_order() {
    let s = setup();
    let hooks = deploy_hooks(&s);
    let id = s.tournament_id;
    let p1 = Address::generate(&s.env);
    let p2 = Address::generate(&s.env);

    s.tournament.register_player(&id, &p1);
    s.tournament.register_player(&id, &p2);
    s.tournament.start_tournament(&id);
    s.tournament.complete_tournament(&id, &p1);

    assert_eq!(
        hooks.hook_log(&id),
        vec![
            &s.env,
            STAGE_REGISTER,
            STAGE_REGISTER,
            STAGE_START,
            STAGE_COMPLETE,
        ]
    );
    assert_eq!(hooks.hook_registered(&id), 2);
    assert_eq!(s.tournament.get_phase(&id), TournamentPhase::Completed);
    assert_eq!(s.tournament.get_winner(&id), Some(p1));
}

#[test]
fn test_reverting_hook_rolls_back_registration() {
    let s = setup();
    let hooks = deploy_hooks(&s);
    hooks.hook_set_max_participants(&1);
    let id = s.tournament_id;
    let p1 = Address::generate(&s.env);
    let p2 = Address::generate(&s.env);

    s.tournament.register_player(&id, &p1);
    assert!(s.tournament.try_register_player(&id, &p2).is_err());

    // Neither the tournament nor the hook kept any state from the failed call.
    assert_eq!(s.tournament.get_participants(&id), vec![&s.env, p1]);
    assert_eq!(hooks.hook_registered(&id), 1);
    assert_eq!(hooks.hook_log(&id), vec![&s.env, STAGE_REGISTER]);
}

#[test]
fn test_lifecycle_without_hook_is_noop() {
    let s = setup();
    let id = s.tournament_id;
    let p1 = Address::generate(&s.env);
    let p2 = Address::generate(&s.env);

    assert_eq!(s.tournament.get_tournament_hook(&id), None);
    s.tournament.register_player(&id, &p1);
    s.tournament.register_player(&id, &p2);
    s.tournament.start_tournament(&id);
    s.tournament.complete_tournament(&id, &p2);

    assert_eq!(s.tournament.get_winner(&id), Some(p2));
}

#[test]
fn test_lifecycle_with_noop_hook_contract() {
    let s = setup();
    let id = s.tournament_id;
    let noop = s.env.register(NoopTournamentHooks, ());
    s.tournament.set_tournament_hook(&id, &noop);
    let p1 = Address::generate(&s.env);
    let p2 = Address::generate(&s.env);

    s.tournament.register_player(&id, &p1);
    s.tournament.register_player(&id, &p2);
    s.tournament.start_tournament(&id);
    s.tournament.complete_tournament(&id, &p1);

    assert_eq!(s.tournament.get_phase(&id), TournamentPhase::Completed);
}

#[test]
#[should_panic(expected = "invalid tournament phase")]
fn test_cannot_change_hook_after_start() {
    let s = setup();
    let id = s.tournament_id;
    s.tournament
        .register_player(&id, &Address::generate(&s.env));
    s.tournament
        .register_player(&id, &Address::generate(&s.env));
    s.tournament.start_tournament(&id);

    let noop = s.env.register(NoopTournamentHooks, ());
    s.tournament.set_tournament_hook(&id, &noop);
}
