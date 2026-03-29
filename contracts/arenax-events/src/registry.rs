use soroban_sdk::{contractevent, Address, BytesN, Env};

pub const NAMESPACE: &str = "ArenaXRegistry";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXReg_v1", "INIT"])]
pub struct InitEvent {
    pub admin: Address,
    pub timestamp: u64,
}

#[contractevent(topics = ["ArenaXReg_v1", "REGISTER"])]
pub struct RegisterEvent {
    pub name: BytesN<32>,
    pub address: Address,
    pub timestamp: u64,
}

#[contractevent(topics = ["ArenaXReg_v1", "UPDATE"])]
pub struct UpdateEvent {
    pub name: BytesN<32>,
    pub old_address: Address,
    pub new_address: Address,
    pub timestamp: u64,
}

pub fn emit_initialized(env: &Env, admin: &Address, timestamp: u64) {
    InitEvent { admin: admin.clone(), timestamp }.publish(env);
}

pub fn emit_registered(env: &Env, name: &BytesN<32>, address: &Address, timestamp: u64) {
    RegisterEvent { name: name.clone(), address: address.clone(), timestamp }.publish(env);
}

pub fn emit_updated(env: &Env, name: &BytesN<32>, old_address: &Address, new_address: &Address, timestamp: u64) {
    UpdateEvent { name: name.clone(), old_address: old_address.clone(), new_address: new_address.clone(), timestamp }.publish(env);
}
