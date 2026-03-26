use soroban_sdk::{contracttype, Address};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    AuthorizedOracle(Address),
    Confirmation(Address, u64), // (player, match_id) -> AntiCheatConfirmation
    ReputationContract,
}

/// Stored confirmation for an anti-cheat flag (queryable and auditable).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AntiCheatConfirmation {
    pub player: Address,
    pub match_id: u64,
    pub severity: u32,
    pub penalty_applied: i128,
    pub timestamp: u64,
    pub oracle: Address,
}
