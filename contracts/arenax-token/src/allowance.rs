use crate::{errors::TokenError, storage_types::{AllowanceDataKey, AllowanceValue, DataKey}};
use soroban_sdk::{Address, Env};

pub fn read_allowance(env: &Env, from: &Address, spender: &Address) -> AllowanceValue {
    let key = DataKey::Allowance(AllowanceDataKey {
        from: from.clone(),
        spender: spender.clone(),
    });
    env.storage()
        .temporary()
        .get(&key)
        .unwrap_or(AllowanceValue {
            amount: 0,
            expiration_ledger: 0,
        })
}

pub fn write_allowance(
    env: &Env,
    from: &Address,
    spender: &Address,
    amount: i128,
    expiration_ledger: u32,
) {
    let key = DataKey::Allowance(AllowanceDataKey {
        from: from.clone(),
        spender: spender.clone(),
    });

    let current_ledger = env.ledger().sequence();

    // Optimize storage: remove zero or expired allowances
    if amount > 0 && expiration_ledger > current_ledger {
        let allowance = AllowanceValue {
            amount,
            expiration_ledger,
        };

        env.storage().temporary().set(&key, &allowance);

        let lifetime = expiration_ledger - current_ledger;
        env.storage()
            .temporary()
            .extend_ttl(&key, lifetime, lifetime);
    } else {
        env.storage().temporary().remove(&key);
    }
}

pub fn spend_allowance(env: &Env, from: &Address, spender: &Address, amount: i128) -> Result<(), TokenError> {
    let allowance = read_allowance(env, from, spender);

    // Check if allowance has expired
    let current_ledger = env.ledger().sequence();
    if current_ledger >= allowance.expiration_ledger {
        return Err(TokenError::AllowanceExpired);
    }

    if allowance.amount < amount {
        return Err(TokenError::InsufficientAllowance);
    }

    let new_amount = allowance
        .amount
        .checked_sub(amount)
        .ok_or(TokenError::Overflow)?;

    write_allowance(
        env,
        from,
        spender,
        new_amount,
        allowance.expiration_ledger,
    );

    Ok(())
}
