use crate::types::{DataKey, ParamKey, ParamValue, Version};
use soroban_sdk::{Address, Env};

pub fn has_admin(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_latest_version(env: &Env, key: ParamKey) -> Version {
    env.storage()
        .persistent()
        .get(&DataKey::LatestVersion(key))
        .unwrap_or(0)
}

pub fn set_latest_version(env: &Env, key: ParamKey, version: Version) {
    env.storage()
        .persistent()
        .set(&DataKey::LatestVersion(key), &version);
}

pub fn get_param(env: &Env, key: ParamKey, version: Version) -> Option<ParamValue> {
    env.storage()
        .persistent()
        .get(&DataKey::Param(key, version))
}

pub fn set_param(env: &Env, key: ParamKey, version: Version, value: &ParamValue) {
    env.storage()
        .persistent()
        .set(&DataKey::Param(key, version), value);
}
