#![no_std]
use soroban_sdk::{contracttype, Address, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    NextRequestId,
    NextAuditId,
    Request(u64),
    Game(u64, u64),
    Tournament(u64),
    Audit(u64),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RNGRequest {
    pub requester: Address,
    pub seed: u64,
    pub commit: [u8; 32],
    pub callback: Option<Address>,
    pub timestamp: u64,
    pub fulfilled: bool,
    pub random_value: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameRandomness {
    pub game_id: u64,
    pub round: u64,
    pub random_value: u64,
    pub request_id: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TournamentSeeding {
    pub tournament_id: u64,
    pub seeds: Vec<(Address, u64)>,
    pub request_id: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuditEntry {
    pub request_id: u64,
    pub requester: Address,
    pub seed: u64,
    pub random_value: u64,
    pub timestamp: u64,
}
