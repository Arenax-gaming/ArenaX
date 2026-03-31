use soroban_sdk::{contractevent, Address, BytesN, Env, String};

pub const NAMESPACE: &str = "ArenaXDispute";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXDisp_v1", "OPENED"])]
pub struct DisputeOpened {
    pub match_id: BytesN<32>,
    pub reason: String,
    pub evidence_ref: String,
    pub deadline: u64,
}

#[contractevent(topics = ["ArenaXDisp_v1", "RESOLVED"])]
pub struct DisputeResolved {
    pub match_id: BytesN<32>,
    pub decision: String,
    pub resolved_at: u64,
    pub operator: Address,
}

pub fn emit_dispute_opened(
    env: &Env,
    match_id: &BytesN<32>,
    reason: &String,
    evidence_ref: &String,
    deadline: u64,
) {
    DisputeOpened {
        match_id: match_id.clone(),
        reason: reason.clone(),
        evidence_ref: evidence_ref.clone(),
        deadline,
    }
    .publish(env);
}

pub fn emit_dispute_resolved(
    env: &Env,
    match_id: &BytesN<32>,
    decision: &String,
    resolved_at: u64,
    operator: &Address,
) {
    DisputeResolved {
        match_id: match_id.clone(),
        decision: decision.clone(),
        resolved_at,
        operator: operator.clone(),
    }
    .publish(env);
}
