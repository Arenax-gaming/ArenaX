use soroban_sdk::{contractevent, Address, BytesN, Env, Vec};

pub const NAMESPACE: &str = "ArenaXPrizeDistribution";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXPrize_v1", "CREATED"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolCreated {
    pub pool_id: u64,
    pub match_id: BytesN<32>,
    pub asset: Address,
    pub amount_locked: i128,
}

#[contractevent(topics = ["ArenaXPrize_v1", "LOCKED"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolLocked {
    pub pool_id: u64,
    pub amount_locked: i128,
}

#[contractevent(topics = ["ArenaXPrize_v1", "EXECUTED"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutExecuted {
    pub pool_id: u64,
    pub winners: Vec<Address>,
    pub weights: Vec<u32>,
}

#[contractevent(topics = ["ArenaXPrize_v1", "HELD"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutHeld {
    pub pool_id: u64,
    pub match_id: BytesN<32>,
}

#[contractevent(topics = ["ArenaXPrize_v1", "RELEASED"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutReleased {
    pub pool_id: u64,
    pub match_id: BytesN<32>,
}

pub fn emit_pool_created(
    env: &Env,
    pool_id: u64,
    match_id: &BytesN<32>,
    asset: &Address,
    amount_locked: i128,
) {
    PoolCreated {
        pool_id,
        match_id: match_id.clone(),
        asset: asset.clone(),
        amount_locked,
    }
    .publish(env);
}

pub fn emit_pool_locked(env: &Env, pool_id: u64, amount_locked: i128) {
    PoolLocked {
        pool_id,
        amount_locked,
    }
    .publish(env);
}

pub fn emit_payout_executed(
    env: &Env,
    pool_id: u64,
    winners: &Vec<Address>,
    weights: &Vec<u32>,
) {
    PayoutExecuted {
        pool_id,
        winners: winners.clone(),
        weights: weights.clone(),
    }
    .publish(env);
}

pub fn emit_payout_held(env: &Env, pool_id: u64, match_id: &BytesN<32>) {
    PayoutHeld {
        pool_id,
        match_id: match_id.clone(),
    }
    .publish(env);
}

pub fn emit_payout_released(env: &Env, pool_id: u64, match_id: &BytesN<32>) {
    PayoutReleased {
        pool_id,
        match_id: match_id.clone(),
    }
    .publish(env);
}
