use soroban_sdk::{contracttype, symbol_short, Address, Env, Symbol};

pub const TREASURY_EVENT_DOMAIN: Symbol = symbol_short!("treasury");

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreasuryDepositEvent {
    pub actor: Address,
    pub amount: i128,
    pub reference_id: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreasuryWithdrawalEvent {
    pub actor: Address,
    pub recipient: Address,
    pub amount: i128,
    pub reference_id: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreasuryProposalCreatedEvent {
    pub proposer: Address,
    pub recipient: Address,
    pub amount: i128,
    pub proposal_id: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreasuryProposalApprovedEvent {
    pub approver: Address,
    pub proposal_id: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreasuryProposalExecutedEvent {
    pub executor: Address,
    pub recipient: Address,
    pub amount: i128,
    pub proposal_id: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreasuryProposalCancelledEvent {
    pub actor: Address,
    pub proposal_id: u64,
    pub timestamp: u64,
}

pub fn emit_deposit(env: &Env, actor: Address, amount: i128, reference_id: u64) {
    let payload = TreasuryDepositEvent {
        actor: actor.clone(),
        amount,
        reference_id,
        timestamp: env.ledger().timestamp(),
    };
    env.events().publish(
        (TREASURY_EVENT_DOMAIN, symbol_short!("deposit"), actor, reference_id),
        payload,
    );
}

pub fn emit_withdrawal(
    env: &Env,
    actor: Address,
    recipient: Address,
    amount: i128,
    reference_id: u64,
) {
    let payload = TreasuryWithdrawalEvent {
        actor: actor.clone(),
        recipient,
        amount,
        reference_id,
        timestamp: env.ledger().timestamp(),
    };
    env.events().publish(
        (TREASURY_EVENT_DOMAIN, symbol_short!("withdraw"), actor, reference_id),
        payload,
    );
}

pub fn emit_proposal_created(
    env: &Env,
    proposer: Address,
    recipient: Address,
    amount: i128,
    proposal_id: u64,
) {
    let payload = TreasuryProposalCreatedEvent {
        proposer: proposer.clone(),
        recipient,
        amount,
        proposal_id,
        timestamp: env.ledger().timestamp(),
    };
    env.events().publish(
        (TREASURY_EVENT_DOMAIN, symbol_short!("prop_new"), proposer, proposal_id),
        payload,
    );
}

pub fn emit_proposal_approved(env: &Env, approver: Address, proposal_id: u64) {
    let payload = TreasuryProposalApprovedEvent {
        approver: approver.clone(),
        proposal_id,
        timestamp: env.ledger().timestamp(),
    };
    env.events().publish(
        (TREASURY_EVENT_DOMAIN, symbol_short!("prop_app"), approver, proposal_id),
        payload,
    );
}

pub fn emit_proposal_executed(
    env: &Env,
    executor: Address,
    recipient: Address,
    amount: i128,
    proposal_id: u64,
) {
    let payload = TreasuryProposalExecutedEvent {
        executor: executor.clone(),
        recipient,
        amount,
        proposal_id,
        timestamp: env.ledger().timestamp(),
    };
    env.events().publish(
        (TREASURY_EVENT_DOMAIN, symbol_short!("prop_exec"), executor, proposal_id),
        payload,
    );
}

pub fn emit_proposal_cancelled(env: &Env, actor: Address, proposal_id: u64) {
    let payload = TreasuryProposalCancelledEvent {
        actor: actor.clone(),
        proposal_id,
        timestamp: env.ledger().timestamp(),
    };
    env.events().publish(
        (TREASURY_EVENT_DOMAIN, symbol_short!("prop_cncl"), actor, proposal_id),
        payload,
    );
}