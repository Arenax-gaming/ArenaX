use soroban_sdk::{contractevent, Address};

#[contractevent(topics = ["ArenaXReputation", "INIT"])]
struct ReputationInitialized {
    admin: Address,
    timestamp: u64,
}

#[contractevent(topics = ["ArenaXReputation", "AUTHORIZER_ADDED"])]
struct AuthorizerAdded {
    resolver: Address,
    timestamp: u64,
}

#[contractevent(topics = ["ArenaXReputation", "AUTHORIZER_REMOVED"])]
struct AuthorizerRemoved {
    resolver: Address,
    timestamp: u64,
}

#[contractevent(topics = ["ArenaXReputation", "REPUTATION_UPDATED"])]
struct ReputationUpdated {
    player: Address,
    previous_score: i128,
    new_score: i128,
    match_id: u64,
    timestamp: u64,
}

#[contractevent(topics = ["ArenaXReputation", "MATCH_RECORDED"])]
struct MatchRecorded {
    player: Address,
    outcome: u32, // 0=Win, 1=Loss, 2=Draw
    match_id: u64,
    timestamp: u64,
}

pub fn emit_initialized(env: &soroban_sdk::Env, admin: &Address, timestamp: u64) {
    ReputationInitialized {
        admin: admin.clone(),
        timestamp,
    }
    .publish(env);
}

pub fn emit_authorizer_added(env: &soroban_sdk::Env, resolver: &Address, timestamp: u64) {
    AuthorizerAdded {
        resolver: resolver.clone(),
        timestamp,
    }
    .publish(env);
}

pub fn emit_authorizer_removed(env: &soroban_sdk::Env, resolver: &Address, timestamp: u64) {
    AuthorizerRemoved {
        resolver: resolver.clone(),
        timestamp,
    }
    .publish(env);
}

pub fn emit_reputation_updated(
    env: &soroban_sdk::Env,
    player: &Address,
    previous_score: i128,
    new_score: i128,
    match_id: u64,
    timestamp: u64,
) {
    ReputationUpdated {
        player: player.clone(),
        previous_score,
        new_score,
        match_id,
        timestamp,
    }
    .publish(env);
}

pub fn emit_match_recorded(
    env: &soroban_sdk::Env,
    player: &Address,
    outcome: u32,
    match_id: u64,
    timestamp: u64,
) {
    MatchRecorded {
        player: player.clone(),
        outcome,
        match_id,
        timestamp,
    }
    .publish(env);
}
