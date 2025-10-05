use crate::{errors::TokenError, storage_types::DataKey};
use soroban_sdk::{Address, Env};

pub fn read_admin(env: &Env) -> Result<Address, TokenError> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(TokenError::AdminNotSet)
}

pub fn write_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn read_total_supply(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalSupply)
        .unwrap_or(0)
}

pub fn write_total_supply(env: &Env, amount: i128) {
    env.storage().instance().set(&DataKey::TotalSupply, &amount);
}
