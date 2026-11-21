use soroban_sdk::{contracterror, contracttype, symbol_short, Address, Env};

/// 24 hours in seconds (used for automatic lock expiration).
pub const LOCK_TTL_SECONDS: u64 = 86_400;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum LockError {
    /// Asset is currently locked (`in_use`) and cannot be transferred cross-chain.
    AssetLocked = 1,
    /// Caller contract is not the originating locker that locked the asset.
    UnauthorizedLocker = 2,
    /// No active lock exists for the specified asset.
    NotLocked = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetLock {
    pub locker: Address,
    pub locked_at: u64,
    pub expires_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum LockDataKey {
    AssetLock(u64),
}

/// Locks an asset for an active game session so cross-chain transfers are blocked.
pub fn lock_asset(env: &Env, asset_id: u64, game_contract: &Address) -> Result<(), LockError> {
    game_contract.require_auth();

    let now = env.ledger().timestamp();
    if is_asset_locked(env, asset_id) {
        return Err(LockError::AssetLocked);
    }

    let lock = AssetLock {
        locker: game_contract.clone(),
        locked_at: now,
        expires_at: now.saturating_add(LOCK_TTL_SECONDS),
    };

    env.storage()
        .persistent()
        .set(&LockDataKey::AssetLock(asset_id), &lock);

    env.events().publish(
        (symbol_short!("asset_lck"), asset_id),
        (game_contract.clone(), now),
    );

    Ok(())
}

/// Releases an active asset lock; only the originating game contract may unlock it.
pub fn unlock_asset(env: &Env, asset_id: u64, game_contract: &Address) -> Result<(), LockError> {
    game_contract.require_auth();

    let key = LockDataKey::AssetLock(asset_id);
    let existing: AssetLock = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(LockError::NotLocked)?;

    if existing.locker != *game_contract {
        return Err(LockError::UnauthorizedLocker);
    }

    env.storage().persistent().remove(&key);

    let now = env.ledger().timestamp();
    env.events().publish(
        (symbol_short!("asset_unl"), asset_id),
        (game_contract.clone(), now),
    );

    Ok(())
}

/// Returns `true` if the asset has an active, non-expired lock (`in_use`).
pub fn is_asset_locked(env: &Env, asset_id: u64) -> bool {
    let key = LockDataKey::AssetLock(asset_id);
    if let Some(lock) = env.storage().persistent().get::<_, AssetLock>(&key) {
        let now = env.ledger().timestamp();
        if now < lock.expires_at {
            return true;
        }
        // Clean up expired lock after 24 hours
        env.storage().persistent().remove(&key);
    }
    false
}

/// Guard called before initiating a cross-chain transfer.
pub fn ensure_unlocked_for_transfer(env: &Env, asset_id: u64) -> Result<(), LockError> {
    if is_asset_locked(env, asset_id) {
        return Err(LockError::AssetLocked);
    }
    Ok(())
}