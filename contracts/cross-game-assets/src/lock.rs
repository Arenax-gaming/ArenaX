use super::DataKey;
use soroban_sdk::{contracttype, Address, BytesN, Env, Symbol};

pub const LOCK_DURATION_SECS: u64 = 24 * 60 * 60;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetLock {
    pub owner: Address,
    pub asset_id: BytesN<32>,
    pub locker: Address,
    pub game_id: u32,
    pub locked_at: u64,
    pub expires_at: u64,
}

pub fn locked_event(env: &Env) -> Symbol {
    Symbol::new(env, "asset_locked")
}

pub fn unlocked_event(env: &Env) -> Symbol {
    Symbol::new(env, "asset_unlocked")
}

pub fn get_lock(env: &Env, owner: &Address, asset_id: &BytesN<32>) -> Option<AssetLock> {
    env.storage()
        .persistent()
        .get(&DataKey::AssetLock(owner.clone(), asset_id.clone()))
}

pub fn set_lock(env: &Env, lock: &AssetLock) {
    env.storage().persistent().set(
        &DataKey::AssetLock(lock.owner.clone(), lock.asset_id.clone()),
        lock,
    );
}

pub fn clear_lock(env: &Env, owner: &Address, asset_id: &BytesN<32>) {
    env.storage()
        .persistent()
        .remove(&DataKey::AssetLock(owner.clone(), asset_id.clone()));
}

pub fn is_active(lock: &AssetLock, now: u64) -> bool {
    now < lock.expires_at
}
