use crate::{errors::TokenError, storage_types::DataKey};
use soroban_sdk::{Address, Env};

pub fn read_balance(env: &Env, addr: &Address) -> i128 {
    let key = DataKey::Balance(addr.clone());
    env.storage().persistent().get(&key).unwrap_or(0)
}

pub fn write_balance(env: &Env, addr: &Address, amount: i128) {
    let key = DataKey::Balance(addr.clone());

    // Optimize storage: remove zero balances
    if amount > 0 {
        env.storage().persistent().set(&key, &amount);
        // Extend storage lifetime for balance entries
        env.storage().persistent().extend_ttl(&key, 100, 100);
    } else {
        env.storage().persistent().remove(&key);
    }
}

pub fn receive_balance(env: &Env, addr: &Address, amount: i128) -> Result<(), TokenError> {
    let balance = read_balance(env, addr);
    let new_balance = balance
        .checked_add(amount)
        .ok_or(TokenError::Overflow)?;
    write_balance(env, addr, new_balance);
    Ok(())
}

pub fn spend_balance(env: &Env, addr: &Address, amount: i128) -> Result<(), TokenError> {
    let balance = read_balance(env, addr);
    if balance < amount {
        return Err(TokenError::InsufficientBalance);
    }
    let new_balance = balance
        .checked_sub(amount)
        .ok_or(TokenError::Overflow)?;
    write_balance(env, addr, new_balance);
    Ok(())
}
