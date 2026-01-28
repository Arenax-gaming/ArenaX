#![no_std]
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};

mod storage;
mod types;

use storage::*;
use types::*;

#[contract]
pub struct ProtocolParamsContract;

#[contractimpl]
impl ProtocolParamsContract {
    pub fn init(env: Env, admin: Address) {
        if has_admin(&env) {
            panic!("Already initialized");
        }
        set_admin(&env, &admin);
    }

    pub fn set_param(env: Env, key: ParamKey, value: ParamValue) {
        let admin = get_admin(&env);
        admin.require_auth();

        let current_version = get_latest_version(&env, key.clone());
        let new_version = current_version + 1;

        set_param(&env, key.clone(), new_version, &value);
        set_latest_version(&env, key, new_version);
    }

    pub fn get_param(env: Env, key: ParamKey, version: Option<Version>) -> Option<ParamValue> {
        let ver = match version {
            Some(v) => v,
            None => get_latest_version(&env, key.clone()),
        };
        get_param(&env, key, ver)
    }

    pub fn get_latest_version(env: Env, key: ParamKey) -> Version {
        get_latest_version(&env, key)
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin = get_admin(&env);
        admin.require_auth();

        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

#[cfg(test)]
mod test;
