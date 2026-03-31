use soroban_sdk::{contractevent, Address, BytesN, Env};

pub const NAMESPACE: &str = "ArenaXEscrow";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXEscrow_v1", "INIT"])]
pub struct Initialized {
    pub admin: Address,
}

#[contractevent(topics = ["ArenaXEscrow_v1", "MATCH_SET"])]
pub struct MatchContractSet {
    pub match_contract: Address,
}

#[contractevent(topics = ["ArenaXEscrow_v1", "ID_SET"])]
pub struct IdentityContractSet {
    pub identity_contract: Address,
}

#[contractevent(topics = ["ArenaXEscrow_v1", "TREASURY"])]
pub struct TreasurySet {
    pub treasury: Address,
}

#[contractevent(topics = ["ArenaXEscrow_v1", "DEPOSIT"])]
pub struct Deposited {
    pub match_id: BytesN<32>,
    pub player: Address,
    pub amount: i128,
    pub asset: Address,
}

#[contractevent(topics = ["ArenaXEscrow_v1", "LOCKED"])]
pub struct MatchLocked {
    pub match_id: BytesN<32>,
}

#[contractevent(topics = ["ArenaXEscrow_v1", "RELEASED"])]
pub struct FundsReleased {
    pub match_id: BytesN<32>,
    pub winner: Address,
    pub amount: i128,
    pub asset: Address,
}

#[contractevent(topics = ["ArenaXEscrow_v1", "REFUNDED"])]
pub struct FundsRefunded {
    pub match_id: BytesN<32>,
    pub player_a: Address,
    pub player_b: Address,
    pub amount: i128,
    pub asset: Address,
}

#[contractevent(topics = ["ArenaXEscrow_v1", "SLASHED"])]
pub struct StakeSlashed {
    pub match_id: BytesN<32>,
    pub subject: Address,
    pub amount: i128,
    pub asset: Address,
}

#[contractevent(topics = ["ArenaXEscrow_v1", "EMERGENCY"])]
pub struct EmergencyWithdraw {
    pub match_id: BytesN<32>,
    pub admin: Address,
    pub amount: i128,
    pub asset: Address,
}

pub fn emit_initialized(env: &Env, admin: &Address) {
    Initialized {
        admin: admin.clone(),
    }
    .publish(env);
}

pub fn emit_match_contract_set(env: &Env, match_contract: &Address) {
    MatchContractSet {
        match_contract: match_contract.clone(),
    }
    .publish(env);
}

pub fn emit_identity_contract_set(env: &Env, identity_contract: &Address) {
    IdentityContractSet {
        identity_contract: identity_contract.clone(),
    }
    .publish(env);
}

pub fn emit_treasury_set(env: &Env, treasury: &Address) {
    TreasurySet {
        treasury: treasury.clone(),
    }
    .publish(env);
}

pub fn emit_deposited(
    env: &Env,
    match_id: &BytesN<32>,
    player: &Address,
    amount: i128,
    asset: &Address,
) {
    Deposited {
        match_id: match_id.clone(),
        player: player.clone(),
        amount,
        asset: asset.clone(),
    }
    .publish(env);
}

pub fn emit_match_locked(env: &Env, match_id: &BytesN<32>) {
    MatchLocked {
        match_id: match_id.clone(),
    }
    .publish(env);
}

pub fn emit_funds_released(
    env: &Env,
    match_id: &BytesN<32>,
    winner: &Address,
    amount: i128,
    asset: &Address,
) {
    FundsReleased {
        match_id: match_id.clone(),
        winner: winner.clone(),
        amount,
        asset: asset.clone(),
    }
    .publish(env);
}

pub fn emit_funds_refunded(
    env: &Env,
    match_id: &BytesN<32>,
    player_a: &Address,
    player_b: &Address,
    amount: i128,
    asset: &Address,
) {
    FundsRefunded {
        match_id: match_id.clone(),
        player_a: player_a.clone(),
        player_b: player_b.clone(),
        amount,
        asset: asset.clone(),
    }
    .publish(env);
}

pub fn emit_stake_slashed(
    env: &Env,
    match_id: &BytesN<32>,
    subject: &Address,
    amount: i128,
    asset: &Address,
) {
    StakeSlashed {
        match_id: match_id.clone(),
        subject: subject.clone(),
        amount,
        asset: asset.clone(),
    }
    .publish(env);
}

pub fn emit_emergency_withdraw(
    env: &Env,
    match_id: &BytesN<32>,
    admin: &Address,
    amount: i128,
    asset: &Address,
) {
    EmergencyWithdraw {
        match_id: match_id.clone(),
        admin: admin.clone(),
        amount,
        asset: asset.clone(),
    }
    .publish(env);
}
