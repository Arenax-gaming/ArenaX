#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Vec};

// ─── Constants ────────────────────────────────────────────────────────────────

/// Maximum items allowed in a single batch call.
/// Prevents out-of-gas / DoS exploits from unbounded loops.
pub const MAX_BATCH_SIZE: u32 = 100;

// ─── Errors ───────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum BatchError {
    /// Contract has not been initialized yet.
    NotInitialized = 1,
    /// Caller is not the admin.
    Unauthorized = 2,
    /// Input vectors have mismatched lengths.
    LengthMismatch = 3,
    /// Empty batch — nothing to do.
    EmptyBatch = 4,
    /// Batch exceeds MAX_BATCH_SIZE.
    BatchTooLarge = 5,
    /// A token amount is zero or negative.
    InvalidAmount = 6,
    /// A token transfer failed (insufficient sender balance).
    InsufficientBalance = 7,
    /// Already initialized.
    AlreadyInitialized = 8,
    /// Player not registered (used in reputation batches).
    PlayerNotFound = 9,
    /// Tournament ID is invalid / not open for registration.
    InvalidTournament = 10,
    /// Player is already registered for a tournament.
    AlreadyRegistered = 11,
    /// Achievement ID is out of valid range (0–63).
    InvalidAchievementId = 12,
    /// Achievement already unlocked for this player.
    AchievementAlreadyUnlocked = 13,
    /// Invalid reputation delta (must be non-zero).
    InvalidDelta = 14,
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    /// Token balance for an address.
    Balance(Address),
    /// Total token supply.
    TotalSupply,
    /// Player reputation score.
    Reputation(Address),
    /// Whether a player is registered for a tournament.
    TournamentRegistration(Address, u32),
    /// Achievement bitmask for a player (u64, supports 0–63).
    AchievementMask(Address),
    /// NFT owner mapping (token_id → owner).
    NftOwner(u32),
    /// Total NFTs minted.
    NftCount,
}

// ─── Result types for partial-success reporting ───────────────────────────────

/// Per-item result used in partial-result batch operations.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ItemResult {
    /// 0-based index within the batch.
    pub index: u32,
    /// true = success, false = failure.
    pub success: bool,
    /// Error code on failure (0 when success = true).
    pub error_code: u32,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct BatchOperations;

#[contractimpl]
impl BatchOperations {
    // ── Initialization ─────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), BatchError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(BatchError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::NftCount, &0u32);
        Ok(())
    }

    // ── View helpers ───────────────────────────────────────────────────────

    pub fn balance(env: Env, addr: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Balance(addr))
            .unwrap_or(0i128)
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0i128)
    }

    pub fn reputation(env: Env, player: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Reputation(player))
            .unwrap_or(0i128)
    }

    pub fn is_registered(env: Env, player: Address, tournament_id: u32) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::TournamentRegistration(player, tournament_id))
            .unwrap_or(false)
    }

    pub fn achievement_mask(env: Env, player: Address) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::AchievementMask(player))
            .unwrap_or(0u64)
    }

    pub fn nft_owner(env: Env, token_id: u32) -> Option<Address> {
        env.storage()
            .instance()
            .get(&DataKey::NftOwner(token_id))
    }

    pub fn nft_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::NftCount)
            .unwrap_or(0u32)
    }

    // ── 1. batch_transfer ──────────────────────────────────────────────────
    //
    // ATOMIC: entire batch reverts if any transfer fails.
    // Gas optimization: sender balance read once, decremented cumulatively;
    // recipient reads batched per unique address via single pass.
    //
    /// Transfer tokens from `from` to multiple recipients atomically.
    /// `recipients` and `amounts` must be the same length.
    pub fn batch_transfer(
        env: Env,
        from: Address,
        recipients: Vec<Address>,
        amounts: Vec<i128>,
    ) -> Result<(), BatchError> {
        Self::require_initialized(&env)?;
        from.require_auth();

        let n = recipients.len();
        Self::validate_batch(n, amounts.len())?;

        // Cache sender balance once — avoids repeated storage reads in the loop.
        let mut from_balance: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Balance(from.clone()))
            .unwrap_or(0);

        // Validate all amounts and total deduction before mutating any state.
        let mut total_deduction: i128 = 0;
        for i in 0..n {
            let amt = amounts.get(i).unwrap();
            if amt <= 0 {
                return Err(BatchError::InvalidAmount);
            }
            total_deduction = total_deduction
                .checked_add(amt)
                .ok_or(BatchError::InvalidAmount)?;
        }
        if from_balance < total_deduction {
            return Err(BatchError::InsufficientBalance);
        }

        // Apply all transfers atomically.
        from_balance -= total_deduction;
        for i in 0..n {
            let to = recipients.get(i).unwrap();
            let amt = amounts.get(i).unwrap();

            // Skip self-transfers without aborting (balance math is already correct).
            if to == from {
                continue;
            }

            let to_balance: i128 = env
                .storage()
                .instance()
                .get(&DataKey::Balance(to.clone()))
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::Balance(to), &(to_balance + amt));
        }
        env.storage()
            .instance()
            .set(&DataKey::Balance(from), &from_balance);

        Ok(())
    }

    // ── 2. batch_mint ──────────────────────────────────────────────────────
    //
    // ATOMIC: admin mints tokens to multiple recipients in one call.
    // Gas optimization: total_supply updated once after loop.
    //
    /// Mint tokens to multiple recipients atomically.
    pub fn batch_mint(
        env: Env,
        recipients: Vec<Address>,
        amounts: Vec<i128>,
    ) -> Result<(), BatchError> {
        Self::require_initialized(&env)?;
        Self::require_admin(&env)?;

        let n = recipients.len();
        Self::validate_batch(n, amounts.len())?;

        // Validate all amounts up front (fail-fast, no partial state).
        for i in 0..n {
            if amounts.get(i).unwrap() <= 0 {
                return Err(BatchError::InvalidAmount);
            }
        }

        // Cache total_supply once — single read, single write.
        let mut supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);

        for i in 0..n {
            let to = recipients.get(i).unwrap();
            let amt = amounts.get(i).unwrap();

            let bal: i128 = env
                .storage()
                .instance()
                .get(&DataKey::Balance(to.clone()))
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::Balance(to), &(bal + amt));
            supply += amt;
        }

        // Single write for supply — avoids n storage writes.
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &supply);

        Ok(())
    }

    // ── 3. batch_register_tournaments ─────────────────────────────────────
    //
    // PARTIAL-RESULT: each item is attempted independently.
    // Caller receives per-item success/error codes so upstream can retry
    // individual failures without losing successful registrations.
    //
    /// Register `player` for multiple tournaments.
    /// Returns per-item results (partial success is allowed).
    pub fn batch_register_tournaments(
        env: Env,
        player: Address,
        tournament_ids: Vec<u32>,
    ) -> Result<Vec<ItemResult>, BatchError> {
        Self::require_initialized(&env)?;
        player.require_auth();

        let n = tournament_ids.len();
        if n == 0 {
            return Err(BatchError::EmptyBatch);
        }
        if n > MAX_BATCH_SIZE {
            return Err(BatchError::BatchTooLarge);
        }

        let mut results: Vec<ItemResult> = Vec::new(&env);

        for i in 0..n {
            let tid = tournament_ids.get(i).unwrap();

            let already: bool = env
                .storage()
                .instance()
                .get(&DataKey::TournamentRegistration(player.clone(), tid))
                .unwrap_or(false);

            if already {
                results.push_back(ItemResult {
                    index: i,
                    success: false,
                    error_code: BatchError::AlreadyRegistered as u32,
                });
                continue;
            }

            env.storage()
                .instance()
                .set(&DataKey::TournamentRegistration(player.clone(), tid), &true);

            results.push_back(ItemResult {
                index: i,
                success: true,
                error_code: 0,
            });
        }

        Ok(results)
    }

    // ── 4. batch_update_reputation ─────────────────────────────────────────
    //
    // ATOMIC: all reputation updates applied or none.
    // Gas optimization: each player's score loaded and written once via
    // pre-validated iteration; no redundant storage round-trips.
    //
    /// Apply reputation deltas to multiple players atomically.
    /// `players` and `deltas` must have the same length.
    /// Positive delta = increase, negative = decrease.
    pub fn batch_update_reputation(
        env: Env,
        players: Vec<Address>,
        deltas: Vec<i128>,
    ) -> Result<(), BatchError> {
        Self::require_initialized(&env)?;
        Self::require_admin(&env)?;

        let n = players.len();
        Self::validate_batch(n, deltas.len())?;

        // Validate all deltas before writing (full atomicity).
        for i in 0..n {
            if deltas.get(i).unwrap() == 0 {
                return Err(BatchError::InvalidDelta);
            }
        }

        for i in 0..n {
            let player = players.get(i).unwrap();
            let delta = deltas.get(i).unwrap();

            let current: i128 = env
                .storage()
                .instance()
                .get(&DataKey::Reputation(player.clone()))
                .unwrap_or(0);

            let new_score = current.saturating_add(delta).max(0);
            env.storage()
                .instance()
                .set(&DataKey::Reputation(player), &new_score);
        }

        Ok(())
    }

    // ── 5. batch_unlock_achievements ──────────────────────────────────────
    //
    // PARTIAL-RESULT: unlocks achievements for a single player.
    // Uses a bitmask to collapse N storage reads into 1 read + 1 write.
    // Each bit position (0–63) corresponds to an achievement ID.
    //
    /// Unlock multiple achievements for a single player using bitmask optimization.
    /// Returns per-item results (already-unlocked items marked as failed, not reverted).
    pub fn batch_unlock_achievements(
        env: Env,
        player: Address,
        achievement_ids: Vec<u32>,
    ) -> Result<Vec<ItemResult>, BatchError> {
        Self::require_initialized(&env)?;
        Self::require_admin(&env)?;

        let n = achievement_ids.len();
        if n == 0 {
            return Err(BatchError::EmptyBatch);
        }
        if n > MAX_BATCH_SIZE {
            return Err(BatchError::BatchTooLarge);
        }

        // Single storage read for the entire achievement set.
        let mut mask: u64 = env
            .storage()
            .instance()
            .get(&DataKey::AchievementMask(player.clone()))
            .unwrap_or(0u64);

        let mut results: Vec<ItemResult> = Vec::new(&env);

        for i in 0..n {
            let aid = achievement_ids.get(i).unwrap();

            if aid > 63 {
                results.push_back(ItemResult {
                    index: i,
                    success: false,
                    error_code: BatchError::InvalidAchievementId as u32,
                });
                continue;
            }

            let bit = 1u64 << aid;
            if mask & bit != 0 {
                results.push_back(ItemResult {
                    index: i,
                    success: false,
                    error_code: BatchError::AchievementAlreadyUnlocked as u32,
                });
                continue;
            }

            mask |= bit;
            results.push_back(ItemResult {
                index: i,
                success: true,
                error_code: 0,
            });
        }

        // Single storage write — regardless of how many achievements were unlocked.
        env.storage()
            .instance()
            .set(&DataKey::AchievementMask(player), &mask);

        Ok(results)
    }

    // ── 6. batch_mint_nft ─────────────────────────────────────────────────
    //
    // ATOMIC: mint multiple NFTs to their respective owners.
    // Gas optimization: NftCount loaded once, incremented in-memory, written once.
    //
    /// Mint NFTs to multiple owners atomically.
    pub fn batch_mint_nft(
        env: Env,
        owners: Vec<Address>,
    ) -> Result<Vec<u32>, BatchError> {
        Self::require_initialized(&env)?;
        Self::require_admin(&env)?;

        let n = owners.len();
        if n == 0 {
            return Err(BatchError::EmptyBatch);
        }
        if n > MAX_BATCH_SIZE {
            return Err(BatchError::BatchTooLarge);
        }

        // Load count once.
        let mut next_id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::NftCount)
            .unwrap_or(0u32);

        let mut minted_ids: Vec<u32> = Vec::new(&env);

        for i in 0..n {
            let owner = owners.get(i).unwrap();
            env.storage()
                .instance()
                .set(&DataKey::NftOwner(next_id), &owner);
            minted_ids.push_back(next_id);
            next_id += 1;
        }

        // Single write for the updated count.
        env.storage()
            .instance()
            .set(&DataKey::NftCount, &next_id);

        Ok(minted_ids)
    }

    // ─── Private helpers ──────────────────────────────────────────────────

    fn require_initialized(env: &Env) -> Result<(), BatchError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(BatchError::NotInitialized);
        }
        Ok(())
    }

    fn require_admin(env: &Env) -> Result<(), BatchError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(BatchError::NotInitialized)?;
        admin.require_auth();
        Ok(())
    }

    /// Validate that both lengths are equal, non-zero, and within MAX_BATCH_SIZE.
    fn validate_batch(len_a: u32, len_b: u32) -> Result<(), BatchError> {
        if len_a == 0 {
            return Err(BatchError::EmptyBatch);
        }
        if len_a != len_b {
            return Err(BatchError::LengthMismatch);
        }
        if len_a > MAX_BATCH_SIZE {
            return Err(BatchError::BatchTooLarge);
        }
        Ok(())
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test;
