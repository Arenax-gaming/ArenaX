use soroban_sdk::{contractevent, Address, BytesN, Env};

pub const NAMESPACE: &str = "ArenaXSlashing";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXSlash_v1", "INIT"])]
pub struct Initialized {
    pub admin: Address,
}

#[contractevent(topics = ["ArenaXSlash_v1", "ID_SET"])]
pub struct IdentityContractSet {
    pub identity_contract: Address,
}

#[contractevent(topics = ["ArenaXSlash_v1", "ESC_SET"])]
pub struct EscrowContractSet {
    pub escrow_contract: Address,
}

#[contractevent(topics = ["ArenaXSlash_v1", "CASE_OPEN"])]
pub struct CaseOpened {
    pub case_id: BytesN<32>,
    pub subject: Address,
    pub initiator: Address,
    pub reason_code: u32,
    pub evidence_hash: BytesN<32>,
}

#[contractevent(topics = ["ArenaXSlash_v1", "APPROVED"])]
pub struct CaseApproved {
    pub case_id: BytesN<32>,
    pub approver: Address,
}

#[contractevent(topics = ["ArenaXSlash_v1", "EXECUTED"])]
pub struct PenaltyExecuted {
    pub case_id: BytesN<32>,
    pub penalty_type: u32,
    pub subject: Address,
}

#[contractevent(topics = ["ArenaXSlash_v1", "CANCELED"])]
pub struct CaseCancelled {
    pub case_id: BytesN<32>,
    pub subject: Address,
}

#[contractevent(topics = ["ArenaXSlash_v1", "SLASHED"])]
pub struct StakeSlashed {
    pub subject: Address,
    pub amount: i128,
    pub asset: Address,
}

#[contractevent(topics = ["ArenaXSlash_v1", "CONFISCT"])]
pub struct RewardConfiscated {
    pub subject: Address,
    pub amount: i128,
    pub asset: Address,
}

#[contractevent(topics = ["ArenaXSlash_v1", "SUSPEND"])]
pub struct TemporarySuspension {
    pub subject: Address,
    pub duration: u64,
    pub expires_at: u64,
}

#[contractevent(topics = ["ArenaXSlash_v1", "PERMA_BN"])]
pub struct PermanentBan {
    pub subject: Address,
}

pub fn emit_initialized(env: &Env, admin: &Address) {
    Initialized {
        admin: admin.clone(),
    }
    .publish(env);
}

pub fn emit_identity_contract_set(env: &Env, identity_contract: &Address) {
    IdentityContractSet {
        identity_contract: identity_contract.clone(),
    }
    .publish(env);
}

pub fn emit_escrow_contract_set(env: &Env, escrow_contract: &Address) {
    EscrowContractSet {
        escrow_contract: escrow_contract.clone(),
    }
    .publish(env);
}

pub fn emit_case_opened(
    env: &Env,
    case_id: &BytesN<32>,
    subject: &Address,
    initiator: &Address,
    reason_code: u32,
    evidence_hash: &BytesN<32>,
) {
    CaseOpened {
        case_id: case_id.clone(),
        subject: subject.clone(),
        initiator: initiator.clone(),
        reason_code,
        evidence_hash: evidence_hash.clone(),
    }
    .publish(env);
}

pub fn emit_case_approved(env: &Env, case_id: &BytesN<32>, approver: &Address) {
    CaseApproved {
        case_id: case_id.clone(),
        approver: approver.clone(),
    }
    .publish(env);
}

pub fn emit_penalty_executed(
    env: &Env,
    case_id: &BytesN<32>,
    penalty_type: u32,
    subject: &Address,
) {
    PenaltyExecuted {
        case_id: case_id.clone(),
        penalty_type,
        subject: subject.clone(),
    }
    .publish(env);
}

pub fn emit_case_cancelled(env: &Env, case_id: &BytesN<32>, subject: &Address) {
    CaseCancelled {
        case_id: case_id.clone(),
        subject: subject.clone(),
    }
    .publish(env);
}

pub fn emit_stake_slashed(env: &Env, subject: &Address, amount: i128, asset: &Address) {
    StakeSlashed {
        subject: subject.clone(),
        amount,
        asset: asset.clone(),
    }
    .publish(env);
}

pub fn emit_reward_confiscated(env: &Env, subject: &Address, amount: i128, asset: &Address) {
    RewardConfiscated {
        subject: subject.clone(),
        amount,
        asset: asset.clone(),
    }
    .publish(env);
}

pub fn emit_temporary_suspension(env: &Env, subject: &Address, duration: u64, expires_at: u64) {
    TemporarySuspension {
        subject: subject.clone(),
        duration,
        expires_at,
    }
    .publish(env);
}

pub fn emit_permanent_ban(env: &Env, subject: &Address) {
    PermanentBan {
        subject: subject.clone(),
    }
    .publish(env);
}
