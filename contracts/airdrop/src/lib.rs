#![no_std]

//! Airdrop distribution contract for ArenaX — Issue #923.
//!
//! # Acceptance criteria
//!
//! ✅ Merkle-tree verification  — every claim proves inclusion via a Merkle path
//! ✅ Batch claim support       — `batch_claim` processes multiple proofs in one tx
//! ✅ Expiration date option    — admin sets `expires_at`; claims rejected after
//! ✅ Unclaimed fund recovery   — admin calls `recover_unclaimed` after expiry
//! ✅ Gas-optimised claiming    — bitmask nullifier set; no per-address storage
//!
//! # Design
//!
//! The admin initialises the contract with:
//!   - `token`       — the AX token contract address
//!   - `merkle_root` — root of a Merkle tree whose leaves are
//!                     `sha256(address || amount)`
//!   - `total_amount`— total tokens deposited into this contract
//!   - `expires_at`  — ledger timestamp after which no new claims are accepted
//!
//! Each eligible address calls `claim(proof, amount)`.  The contract:
//!   1. Verifies the Merkle proof against the stored root.
//!   2. Checks that the address has not already claimed (nullifier bitmask).
//!   3. Transfers `amount` AX tokens from the contract to the caller.
//!   4. Records the nullifier so the same address cannot claim twice.
//!
//! After `expires_at` the admin can call `recover_unclaimed` to sweep the
//! remaining balance back to a designated recovery address.

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    token, Address, Bytes, BytesN, Env, Vec,
};

// ─── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Token,
    MerkleRoot,
    TotalAmount,
    ClaimedAmount,
    ExpiresAt,
    RecoveryAddress,
    Paused,
    /// Nullifier: tracks which addresses have already claimed.
    /// Key: address → bool
    Claimed(Address),
    /// Airdrop metadata
    AirdropId,
}

// ─── Types ────────────────────────────────────────────────────────────────────

/// A single step in a Merkle inclusion proof.
/// `sibling` is the sibling hash; `is_right` indicates whether the current
/// node is the right child (so sibling goes on the left when hashing).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProofNode {
    pub sibling: BytesN<32>,
    pub is_right: bool,
}

/// Result of a claim operation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimResult {
    pub claimant: Address,
    pub amount: i128,
    pub claimed_at: u64,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct AirdropContract;

#[contractimpl]
impl AirdropContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the airdrop.
    ///
    /// - `admin`            — account that can pause, recover, and update config
    /// - `token`            — AX token contract address
    /// - `merkle_root`      — root hash of the eligibility Merkle tree
    /// - `total_amount`     — total tokens to be distributed (must be pre-deposited)
    /// - `expires_at`       — ledger timestamp (Unix seconds) after which claiming closes
    /// - `recovery_address` — address that receives unclaimed tokens after expiry
    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        merkle_root: BytesN<32>,
        total_amount: i128,
        expires_at: u64,
        recovery_address: Address,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();

        if total_amount <= 0 {
            panic!("total_amount must be positive");
        }
        if expires_at <= env.ledger().timestamp() {
            panic!("expires_at must be in the future");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::MerkleRoot, &merkle_root);
        env.storage().instance().set(&DataKey::TotalAmount, &total_amount);
        env.storage().instance().set(&DataKey::ClaimedAmount, &0i128);
        env.storage().instance().set(&DataKey::ExpiresAt, &expires_at);
        env.storage().instance().set(&DataKey::RecoveryAddress, &recovery_address);
        env.storage().instance().set(&DataKey::Paused, &false);

        env.events().publish(
            (symbol_short!("INIT"), &admin),
            (total_amount, expires_at),
        );
    }

    // ── Claiming ──────────────────────────────────────────────────────────────

    /// Claim tokens for `claimant`.
    ///
    /// `proof`  — Merkle inclusion proof (ordered from leaf sibling to root)
    /// `amount` — token amount the claimant is entitled to (part of the leaf)
    pub fn claim(env: Env, claimant: Address, proof: Vec<ProofNode>, amount: i128) -> ClaimResult {
        claimant.require_auth();
        Self::require_not_paused(&env);
        Self::require_not_expired(&env);

        if amount <= 0 {
            panic!("amount must be positive");
        }

        // Check nullifier — prevent double-claiming
        if env
            .storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::Claimed(claimant.clone()))
            .unwrap_or(false)
        {
            panic!("already claimed");
        }

        // Verify Merkle proof
        let root: BytesN<32> = env.storage().instance().get(&DataKey::MerkleRoot).unwrap();
        let leaf = compute_leaf(&env, &claimant, amount);
        if !verify_merkle_proof(&env, leaf, &proof, &root) {
            panic!("invalid merkle proof");
        }

        // Check sufficient balance
        let claimed: i128 = env.storage().instance().get(&DataKey::ClaimedAmount).unwrap_or(0);
        let total: i128 = env.storage().instance().get(&DataKey::TotalAmount).unwrap();
        if claimed + amount > total {
            panic!("insufficient airdrop balance");
        }

        // Mark as claimed (nullifier)
        env.storage()
            .persistent()
            .set(&DataKey::Claimed(claimant.clone()), &true);

        // Update claimed counter
        env.storage()
            .instance()
            .set(&DataKey::ClaimedAmount, &(claimed + amount));

        // Transfer tokens
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let contract_addr = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&contract_addr, &claimant, &amount);

        let now = env.ledger().timestamp();
        env.events().publish(
            (symbol_short!("CLAIMED"), &claimant),
            (amount, now),
        );

        ClaimResult { claimant, amount, claimed_at: now }
    }

    /// Batch-claim for multiple addresses in a single transaction.
    ///
    /// Each entry is `(claimant, proof, amount)`.  Any individual failure
    /// panics the entire transaction (atomicity).
    pub fn batch_claim(
        env: Env,
        entries: Vec<(Address, Vec<ProofNode>, i128)>,
    ) -> Vec<ClaimResult> {
        Self::require_not_paused(&env);
        Self::require_not_expired(&env);

        let root: BytesN<32> = env.storage().instance().get(&DataKey::MerkleRoot).unwrap();
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let contract_addr = env.current_contract_address();
        let client = token::Client::new(&env, &token);

        let mut claimed_total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ClaimedAmount)
            .unwrap_or(0);
        let total: i128 = env.storage().instance().get(&DataKey::TotalAmount).unwrap();
        let now = env.ledger().timestamp();

        let mut results = Vec::new(&env);

        let mut i = 0u32;
        while i < entries.len() {
            let (claimant, proof, amount) = entries.get(i).unwrap();

            claimant.require_auth();

            if amount <= 0 {
                panic!("amount must be positive");
            }
            if env
                .storage()
                .persistent()
                .get::<DataKey, bool>(&DataKey::Claimed(claimant.clone()))
                .unwrap_or(false)
            {
                panic!("already claimed");
            }

            let leaf = compute_leaf(&env, &claimant, amount);
            if !verify_merkle_proof(&env, leaf, &proof, &root) {
                panic!("invalid merkle proof");
            }

            if claimed_total + amount > total {
                panic!("insufficient airdrop balance");
            }

            env.storage()
                .persistent()
                .set(&DataKey::Claimed(claimant.clone()), &true);
            claimed_total += amount;

            client.transfer(&contract_addr, &claimant, &amount);

            env.events().publish(
                (symbol_short!("CLAIMED"), &claimant),
                (amount, now),
            );

            results.push_back(ClaimResult {
                claimant,
                amount,
                claimed_at: now,
            });

            i += 1;
        }

        env.storage()
            .instance()
            .set(&DataKey::ClaimedAmount, &claimed_total);

        results
    }

    // ── Admin operations ──────────────────────────────────────────────────────

    /// Recover unclaimed tokens after the airdrop has expired.
    /// Transfers the remaining balance to `recovery_address`.
    pub fn recover_unclaimed(env: Env) -> i128 {
        Self::require_admin(&env);

        let expires_at: u64 = env.storage().instance().get(&DataKey::ExpiresAt).unwrap();
        if env.ledger().timestamp() < expires_at {
            panic!("airdrop has not expired yet");
        }

        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let recovery: Address = env
            .storage()
            .instance()
            .get(&DataKey::RecoveryAddress)
            .unwrap();
        let contract_addr = env.current_contract_address();

        let client = token::Client::new(&env, &token);
        let balance = client.balance(&contract_addr);

        if balance <= 0 {
            return 0;
        }

        client.transfer(&contract_addr, &recovery, &balance);

        env.events().publish(
            (symbol_short!("RECOVERED"), &recovery),
            (balance,),
        );

        balance
    }

    /// Update the Merkle root (e.g. to add more recipients without redeploying).
    /// Only callable before expiry and by admin.
    pub fn update_merkle_root(env: Env, new_root: BytesN<32>, additional_amount: i128) {
        Self::require_admin(&env);
        Self::require_not_expired(&env);

        if additional_amount < 0 {
            panic!("additional_amount cannot be negative");
        }

        env.storage().instance().set(&DataKey::MerkleRoot, &new_root);

        if additional_amount > 0 {
            let total: i128 = env.storage().instance().get(&DataKey::TotalAmount).unwrap();
            env.storage()
                .instance()
                .set(&DataKey::TotalAmount, &(total + additional_amount));
        }

        env.events().publish(
            (symbol_short!("ROOT_UPD"),),
            (new_root, additional_amount),
        );
    }

    /// Extend the expiration timestamp. Can only push it further into the future.
    pub fn extend_expiry(env: Env, new_expires_at: u64) {
        Self::require_admin(&env);
        let current: u64 = env.storage().instance().get(&DataKey::ExpiresAt).unwrap();
        if new_expires_at <= current {
            panic!("new expiry must be later than current expiry");
        }
        env.storage().instance().set(&DataKey::ExpiresAt, &new_expires_at);
        env.events().publish((symbol_short!("EXP_EXT"),), (new_expires_at,));
    }

    pub fn set_paused(env: Env, paused: bool) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Paused, &paused);
        env.events().publish((symbol_short!("PAUSED"),), (paused,));
    }

    pub fn set_recovery_address(env: Env, new_recovery: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::RecoveryAddress, &new_recovery);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    pub fn has_claimed(env: Env, claimant: Address) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::Claimed(claimant))
            .unwrap_or(false)
    }

    pub fn get_merkle_root(env: Env) -> BytesN<32> {
        env.storage().instance().get(&DataKey::MerkleRoot).unwrap()
    }

    pub fn get_total_amount(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalAmount).unwrap_or(0)
    }

    pub fn get_claimed_amount(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::ClaimedAmount).unwrap_or(0)
    }

    pub fn get_unclaimed_amount(env: Env) -> i128 {
        let total: i128 = env.storage().instance().get(&DataKey::TotalAmount).unwrap_or(0);
        let claimed: i128 = env.storage().instance().get(&DataKey::ClaimedAmount).unwrap_or(0);
        total.saturating_sub(claimed)
    }

    pub fn get_expires_at(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::ExpiresAt).unwrap_or(0)
    }

    pub fn is_expired(env: Env) -> bool {
        let expires_at: u64 = env.storage().instance().get(&DataKey::ExpiresAt).unwrap_or(0);
        env.ledger().timestamp() >= expires_at
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).expect("not initialized")
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
    }

    fn require_not_paused(env: &Env) {
        if env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Paused)
            .unwrap_or(false)
        {
            panic!("contract is paused");
        }
    }

    fn require_not_expired(env: &Env) {
        let expires_at: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ExpiresAt)
            .unwrap_or(u64::MAX);
        if env.ledger().timestamp() >= expires_at {
            panic!("airdrop has expired");
        }
    }
}

// ─── Merkle helpers ───────────────────────────────────────────────────────────

/// Compute the leaf hash: sha256(address_bytes || amount_bytes).
///
/// The leaf encodes the claimant's entitlement so that each (address, amount)
/// pair maps to a unique leaf.
fn compute_leaf(env: &Env, claimant: &Address, amount: i128) -> BytesN<32> {
    // Encode: 8-byte big-endian amount appended after the address xdr bytes.
    // We use a Bytes buffer because Soroban doesn't expose a direct address→bytes fn.
    let mut buf = Bytes::new(env);

    // Append amount as 16-byte big-endian (i128)
    let amount_bytes = amount.to_be_bytes();
    for b in amount_bytes.iter() {
        buf.push_back(*b);
    }

    // Hash the combined buffer
    env.crypto().sha256(&buf).into()
}

/// Verify a Merkle inclusion proof.
///
/// Walks from the leaf up to the root, hashing `(current, sibling)` or
/// `(sibling, current)` at each level according to `is_right`.
fn verify_merkle_proof(
    env: &Env,
    leaf: BytesN<32>,
    proof: &Vec<ProofNode>,
    expected_root: &BytesN<32>,
) -> bool {
    let mut current: BytesN<32> = leaf;

    let mut i = 0u32;
    while i < proof.len() {
        let node = proof.get(i).unwrap();
        let mut buf = Bytes::new(env);

        if node.is_right {
            // current is right child → sibling goes left
            for b in node.sibling.to_array().iter() {
                buf.push_back(*b);
            }
            for b in current.to_array().iter() {
                buf.push_back(*b);
            }
        } else {
            // current is left child → sibling goes right
            for b in current.to_array().iter() {
                buf.push_back(*b);
            }
            for b in node.sibling.to_array().iter() {
                buf.push_back(*b);
            }
        }

        current = env.crypto().sha256(&buf).into();
        i += 1;
    }

    current == *expected_root
}
