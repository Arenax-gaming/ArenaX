use crate::storage_types::ZERO_ADDRESS;
use soroban_sdk::{contracttype, Address, Env, Symbol};

/// Event data structures
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferEvent {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MintEvent {
    pub to: Address,
    pub from: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BurnEvent {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ApproveEvent {
    pub from: Address,
    pub spender: Address,
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetAdminEvent {
    pub old_admin: Address,
    pub new_admin: Address,
}

pub fn transfer(env: &Env, from: Address, to: Address, amount: i128) {
    let topics = (Symbol::new(env, "transfer"),);
    let transfer_data = TransferEvent {
        from: from.clone(),
        to: to.clone(),
        amount,
    };
    env.events().publish(topics, transfer_data);
}

pub fn mint(env: &Env, to: Address, amount: i128) {
    let topics = (Symbol::new(env, "mint"),);
    let zero_addr = Address::from_str(env, ZERO_ADDRESS);
    let mint_data = MintEvent {
        to: to.clone(),
        from: zero_addr,
        amount,
    };
    env.events().publish(topics, mint_data);
}

pub fn burn(env: &Env, from: Address, amount: i128) {
    let topics = (Symbol::new(env, "burn"),);
    let zero_addr = Address::from_str(env, ZERO_ADDRESS);
    let burn_data = BurnEvent {
        from: from.clone(),
        to: zero_addr,
        amount,
    };
    env.events().publish(topics, burn_data);
}

pub fn approve(env: &Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
    let topics = (Symbol::new(env, "approve"),);
    let approval_data = ApproveEvent {
        from: from.clone(),
        spender: spender.clone(),
        amount,
        expiration_ledger,
    };
    env.events().publish(topics, approval_data);
}

pub fn set_admin(env: &Env, old_admin: Address, new_admin: Address) {
    let topics = (Symbol::new(env, "set_admin"),);
    let admin_data = SetAdminEvent {
        old_admin: old_admin.clone(),
        new_admin: new_admin.clone(),
    };
    env.events().publish(topics, admin_data);
}
