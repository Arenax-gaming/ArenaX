use soroban_sdk::{contractevent, Address, Env};

pub const NAMESPACE: &str = "ArenaXToken";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXToken_v1", "MINT"])]
pub struct MintEvent {
    pub to: Address,
    pub amount: i128,
}

#[contractevent(topics = ["ArenaXToken_v1", "BURN"])]
pub struct BurnEvent {
    pub from: Address,
    pub amount: i128,
}

#[contractevent(topics = ["ArenaXToken_v1", "TRANSFER"])]
pub struct TransferEvent {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
}

pub fn emit_mint(env: &Env, to: &Address, amount: i128) {
    MintEvent {
        to: to.clone(),
        amount,
    }
    .publish(env);
}

pub fn emit_burn(env: &Env, from: &Address, amount: i128) {
    BurnEvent {
        from: from.clone(),
        amount,
    }
    .publish(env);
}

pub fn emit_transfer(env: &Env, from: &Address, to: &Address, amount: i128) {
    TransferEvent {
        from: from.clone(),
        to: to.clone(),
        amount,
    }
    .publish(env);
}
