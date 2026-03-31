use soroban_sdk::{contractevent, Address, BytesN, Env};

pub const NAMESPACE: &str = "ArenaXStaking";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXStake_v1", "INIT"])]
pub struct Initialized {
    pub admin: Address,
    pub ax_token: Address,
}

#[contractevent(topics = ["ArenaXStake_v1", "TOKEN_SET"])]
pub struct TokenSet {
    pub token: Address,
}

#[contractevent(topics = ["ArenaXStake_v1", "TOURN_SET"])]
pub struct TournamentContractSet {
    pub contract: Address,
}

#[contractevent(topics = ["ArenaXStake_v1", "DISP_SET"])]
pub struct DisputeContractSet {
    pub contract: Address,
}

#[contractevent(topics = ["ArenaXStake_v1", "STAKED"])]
pub struct Staked {
    pub user: Address,
    pub tournament_id: BytesN<32>,
    pub amount: i128,
}

#[contractevent(topics = ["ArenaXStake_v1", "WITHDRAWN"])]
pub struct Withdrawn {
    pub user: Address,
    pub tournament_id: BytesN<32>,
    pub amount: i128,
}

#[contractevent(topics = ["ArenaXStake_v1", "SLASHED"])]
pub struct Slashed {
    pub user: Address,
    pub tournament_id: BytesN<32>,
    pub amount: i128,
    pub slashed_by: Address,
}

#[contractevent(topics = ["ArenaXStake_v1", "TOURN_NEW"])]
pub struct TournamentCreated {
    pub tournament_id: BytesN<32>,
    pub stake_requirement: i128,
}

#[contractevent(topics = ["ArenaXStake_v1", "TOURN_UPD"])]
pub struct TournamentUpdated {
    pub tournament_id: BytesN<32>,
    pub state: u32,
}

#[contractevent(topics = ["ArenaXStake_v1", "PAUSED"])]
pub struct ContractPaused {
    pub paused: bool,
    pub paused_by: Address,
}

pub fn emit_initialized(env: &Env, admin: &Address, ax_token: &Address) {
    Initialized {
        admin: admin.clone(),
        ax_token: ax_token.clone(),
    }
    .publish(env);
}

pub fn emit_token_set(env: &Env, token: &Address) {
    TokenSet {
        token: token.clone(),
    }
    .publish(env);
}

pub fn emit_tournament_contract_set(env: &Env, contract: &Address) {
    TournamentContractSet {
        contract: contract.clone(),
    }
    .publish(env);
}

pub fn emit_dispute_contract_set(env: &Env, contract: &Address) {
    DisputeContractSet {
        contract: contract.clone(),
    }
    .publish(env);
}

pub fn emit_staked(env: &Env, user: &Address, tournament_id: &BytesN<32>, amount: i128) {
    Staked {
        user: user.clone(),
        tournament_id: tournament_id.clone(),
        amount,
    }
    .publish(env);
}

pub fn emit_withdrawn(env: &Env, user: &Address, tournament_id: &BytesN<32>, amount: i128) {
    Withdrawn {
        user: user.clone(),
        tournament_id: tournament_id.clone(),
        amount,
    }
    .publish(env);
}

pub fn emit_slashed(
    env: &Env,
    user: &Address,
    tournament_id: &BytesN<32>,
    amount: i128,
    slashed_by: &Address,
) {
    Slashed {
        user: user.clone(),
        tournament_id: tournament_id.clone(),
        amount,
        slashed_by: slashed_by.clone(),
    }
    .publish(env);
}

pub fn emit_tournament_created(env: &Env, tournament_id: &BytesN<32>, stake_requirement: i128) {
    TournamentCreated {
        tournament_id: tournament_id.clone(),
        stake_requirement,
    }
    .publish(env);
}

pub fn emit_tournament_updated(env: &Env, tournament_id: &BytesN<32>, state: u32) {
    TournamentUpdated {
        tournament_id: tournament_id.clone(),
        state,
    }
    .publish(env);
}

pub fn emit_contract_paused(env: &Env, paused: bool, paused_by: &Address) {
    ContractPaused {
        paused,
        paused_by: paused_by.clone(),
    }
    .publish(env);
}
