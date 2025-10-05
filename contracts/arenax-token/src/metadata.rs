use crate::{errors::TokenError, storage_types::{DataKey, Metadata}};
use soroban_sdk::{Env, String};

pub fn read_metadata(env: &Env) -> Result<Metadata, TokenError> {
    env.storage()
        .instance()
        .get(&DataKey::Metadata)
        .ok_or(TokenError::NotInitialized)
}

pub fn write_metadata(env: &Env, decimals: u32, name: String, symbol: String) {
    let metadata = Metadata {
        decimals,
        name,
        symbol,
    };
    env.storage().instance().set(&DataKey::Metadata, &metadata);
}

pub fn read_name(env: &Env) -> Result<String, TokenError> {
    let metadata = read_metadata(env)?;
    Ok(metadata.name)
}

pub fn read_symbol(env: &Env) -> Result<String, TokenError> {
    let metadata = read_metadata(env)?;
    Ok(metadata.symbol)
}

pub fn read_decimals(env: &Env) -> Result<u32, TokenError> {
    let metadata = read_metadata(env)?;
    Ok(metadata.decimals)
}
