use soroban_sdk::{contractevent, Address, Env};

pub const NAMESPACE: &str = "ArenaXReputation";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXReputation_v1", "INIT"])]
pub struct ReputationInitialized {
    pub admin: Address,
    pub timestamp: u64,
}

#[contractevent(topics = ["ArenaXReputation_v1", "AUTHORIZER_ADDED"])]
pub struct AuthorizerAdded {
    pub resolver: Address,
    pub timestamp: u64,
}

#[contractevent(topics = ["ArenaXReputation_v1", "AUTHORIZER_REMOVED"])]
pub struct AuthorizerRemoved {
    pub resolver: Address,
    pub timestamp: u64,
}

#[contractevent(topics = ["ArenaXReputation_v1", "REPUTATION_UPDATED"])]
pub struct ReputationUpdated {
    pub player: Address,
    pub previous_score: i128,
    pub new_score: i128,
    pub match_id: u64,
    pub timestamp: u64,
    pub source: u32, // 0=match, 1=penalty, 2=decay (NEW in v1)
}

#[contractevent(topics = ["ArenaXReputation_v1", "MATCH_RECORDED"])]
pub struct MatchRecorded {
    pub player: Address,
    pub outcome: u32,
    pub match_id: u64,
    pub timestamp: u64,
}

pub fn emit_initialized(env: &Env, admin: &Address, timestamp: u64) {
    ReputationInitialized {
        admin: admin.clone(),
        timestamp,
    }
    .publish(env);
}

pub fn emit_authorizer_added(env: &Env, resolver: &Address, timestamp: u64) {
    AuthorizerAdded {
        resolver: resolver.clone(),
        timestamp,
    }
    .publish(env);
}

pub fn emit_authorizer_removed(env: &Env, resolver: &Address, timestamp: u64) {
    AuthorizerRemoved {
        resolver: resolver.clone(),
        timestamp,
    }
    .publish(env);
}

pub fn emit_reputation_updated(
    env: &Env,
    player: &Address,
    previous_score: i128,
    new_score: i128,
    match_id: u64,
    timestamp: u64,
    source: u32,
) {
    ReputationUpdated {
        player: player.clone(),
        previous_score,
        new_score,
        match_id,
        timestamp,
        source,
    }
    .publish(env);
}

pub fn emit_match_recorded(env: &Env, player: &Address, outcome: u32, match_id: u64, timestamp: u64) {
    MatchRecorded {
        player: player.clone(),
        outcome,
        match_id,
        timestamp,
    }
    .publish(env);
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_emit_reputation_updated() {
        let env = Env::default();
        let player = Address::generate(&env);
        emit_reputation_updated(&env, &player, 1000, 1025, 42, 1700000000, 0);
    }

    #[test]
    fn test_emit_initialized() {
        let env = Env::default();
        let admin = Address::generate(&env);
        emit_initialized(&env, &admin, 1700000000);
    }

    #[test]
    fn test_emit_all_event_types() {
        let env = Env::default();
        let addr = Address::generate(&env);
        emit_authorizer_added(&env, &addr, 100);
        emit_authorizer_removed(&env, &addr, 200);
        emit_match_recorded(&env, &addr, 0, 42, 300);
    }
}
