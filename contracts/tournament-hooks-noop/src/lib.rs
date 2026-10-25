#![no_std]

//! Default no-op tournament hook contract (#1417).
//!
//! Implements the `on_register` / `on_start` / `on_complete` interface from
//! `composable-example::tournament_hooks` without doing anything, for
//! tournaments that want an explicit hook address but no custom behaviour.
//! Tournaments with no hook configured skip the cross-contract call entirely.

use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
pub struct NoopTournamentHooks;

#[contractimpl]
impl NoopTournamentHooks {
    pub fn on_register(_env: Env, _tournament_id: u64, _player: Address) {}

    pub fn on_start(_env: Env, _tournament_id: u64) {}

    pub fn on_complete(_env: Env, _tournament_id: u64, _winner: Address) {}
}
