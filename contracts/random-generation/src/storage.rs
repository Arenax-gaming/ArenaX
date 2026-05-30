#![no_std]
use crate::types::{AuditEntry, DataKey, GameRandomness, RNGRequest, TournamentSeeding};
use soroban_sdk::{Address, Env, Vec};

pub fn has_admin(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_next_request_id(env: &Env) -> u64 {
    let id: u64 = env.storage().persistent().get(&DataKey::NextRequestId).unwrap_or(0);
    env.storage().persistent().set(&DataKey::NextRequestId, &(id + 1));
    id
}

pub fn get_request(env: &Env, request_id: u64) -> Option<RNGRequest> {
    env.storage().persistent().get(&DataKey::Request(request_id))
}

pub fn set_request(env: &Env, request_id: u64, request: &RNGRequest) {
    env.storage().persistent().set(&DataKey::Request(request_id), request);
}

pub fn get_game_randomness(env: &Env, game_id: u64, round: u64) -> Option<GameRandomness> {
    env.storage().persistent().get(&DataKey::Game(game_id, round))
}

pub fn set_game_randomness(env: &Env, game_randomness: &GameRandomness) {
    env.storage().persistent().set(
        &DataKey::Game(game_randomness.game_id, game_randomness.round),
        game_randomness,
    );
}

pub fn get_tournament_seeding(env: &Env, tournament_id: u64) -> Option<TournamentSeeding> {
    env.storage().persistent().get(&DataKey::Tournament(tournament_id))
}

pub fn set_tournament_seeding(env: &Env, seeding: &TournamentSeeding) {
    env.storage().persistent().set(&DataKey::Tournament(seeding.tournament_id), seeding);
}

pub fn get_next_audit_id(env: &Env) -> u64 {
    let id: u64 = env.storage().persistent().get(&DataKey::NextAuditId).unwrap_or(0);
    env.storage().persistent().set(&DataKey::NextAuditId, &(id + 1));
    id
}

pub fn get_audit_entry(env: &Env, audit_id: u64) -> Option<AuditEntry> {
    env.storage().persistent().get(&DataKey::Audit(audit_id))
}

pub fn set_audit_entry(env: &Env, audit_id: u64, entry: &AuditEntry) {
    env.storage().persistent().set(&DataKey::Audit(audit_id), entry);
}

pub fn add_audit_entry(env: &Env, entry: &AuditEntry) {
    let audit_id = get_next_audit_id(env);
    set_audit_entry(env, audit_id, entry);
}

pub fn get_audit_entries(env: &Env, start: u64, end: u64) -> Vec<AuditEntry> {
    let mut entries = Vec::new(env);
    let mut audit_id = 0;
    loop {
        let entry: Option<AuditEntry> = get_audit_entry(env, audit_id);
        match entry {
            Some(e) if e.timestamp >= start && e.timestamp <= end => {
                entries.push_back(e);
                audit_id += 1;
            }
            Some(_) => {
                audit_id += 1;
            }
            None => {
                break;
            }
        }
    }
    entries
}
