use soroban_sdk::{contractevent, Address, BytesN, Env};

#[contractevent(topics = ["ArenaXRegistry", "INIT"])]
struct InitEvent {
    admin: Address,
    timestamp: u64,
}

#[contractevent(topics = ["ArenaXRegistry", "REGISTER"])]
struct RegisterEvent {
    name: BytesN<32>,
    address: Address,
    timestamp: u64,
}

#[contractevent(topics = ["ArenaXRegistry", "UPDATE"])]
struct UpdateEvent {
    name: BytesN<32>,
    old_address: Address,
    new_address: Address,
    timestamp: u64,
}

pub fn emit_initialized(env: &Env, admin: &Address, timestamp: u64) {
    InitEvent {
        admin: admin.clone(),
        timestamp,
    }
    .publish(env);
}

pub fn emit_registered(env: &Env, name: &BytesN<32>, address: &Address, timestamp: u64) {
    RegisterEvent {
        name: name.clone(),
        address: address.clone(),
        timestamp,
    }
    .publish(env);
}

pub fn emit_updated(
    env: &Env,
    name: &BytesN<32>,
    old_address: &Address,
    new_address: &Address,
    timestamp: u64,
) {
    UpdateEvent {
        name: name.clone(),
        old_address: old_address.clone(),
        new_address: new_address.clone(),
        timestamp,
    }
    .publish(env);
}
