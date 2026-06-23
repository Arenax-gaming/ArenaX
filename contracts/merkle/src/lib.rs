//! ArenaX Merkle-tree library (#493).
//!
//! Provides on-chain Merkle proof verification + a thin
//! `MerkleAirdropRegistry` contract that stores per-campaign roots and
//! tracks which leaves have been claimed.
//!
//! ## Hashing convention
//!
//! - Leaves are `BytesN<32>` values produced *off-chain* — the caller
//!   decides how to encode user identity + amount before hashing
//!   (typically `sha256(account_id_xdr || amount.to_be_bytes())`).
//! - Internal nodes use **sorted-pair hashing**:
//!   `hash(min(a, b) || max(a, b))` — this is the OpenZeppelin /
//!   uniswap-merkle-distributor convention, which makes proof paths
//!   order-independent and lets clients hand back proofs without
//!   per-position bits.
//!
//! ## Storage layout
//!
//! - `DataKey::Admin` — campaign admin (instance)
//! - `DataKey::Root(campaign_id)` — root for a campaign (persistent)
//! - `DataKey::Claimed(campaign_id, leaf)` — claim marker (persistent)

#![no_std]

use soroban_sdk::{
    contract, contractevent, contractimpl, contracterror, contracttype, panic_with_error,
    Address, Bytes, BytesN, Env,
};

const PERSISTENT_LIFETIME_THRESHOLD: u32 = 100_000;
const PERSISTENT_BUMP_AMOUNT: u32 = 500_000;

#[contracttype]
pub enum DataKey {
    Admin,
    Root(Bytes),                // campaign_id → root
    Claimed(Bytes, BytesN<32>), // (campaign_id, leaf) → bool
}

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    RootNotSet = 4,
    InvalidProof = 5,
    AlreadyClaimed = 6,
    RootAlreadySet = 7,
}

#[contractevent(topics = ["ArenaXMerkle_v1", "ROOT_SET"])]
pub struct RootSet {
    pub campaign_id: Bytes,
    pub root: BytesN<32>,
}

#[contractevent(topics = ["ArenaXMerkle_v1", "CLAIMED"])]
pub struct LeafClaimed {
    pub campaign_id: Bytes,
    pub leaf: BytesN<32>,
    pub claimant: Address,
}

// ─── Verification primitive ────────────────────────────────────────────────

/// Verify that `leaf` is a member of the tree rooted at `root`, given
/// `proof` as the ordered list of sibling hashes from the leaf up to the
/// root. Uses sorted-pair hashing — proof order is irrelevant.
pub fn verify_proof(
    env: &Env,
    root: &BytesN<32>,
    leaf: &BytesN<32>,
    proof: &soroban_sdk::Vec<BytesN<32>>,
) -> bool {
    let mut computed: BytesN<32> = leaf.clone();
    for i in 0..proof.len() {
        let sibling = proof.get(i).unwrap();
        computed = hash_pair_sorted(env, &computed, &sibling);
    }
    computed == *root
}

/// `hash(min(a, b) || max(a, b))` using `env.crypto().sha256(...)`.
pub fn hash_pair_sorted(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
    let mut buf = soroban_sdk::Bytes::new(env);
    let (lo, hi) = if compare_bytes32(a, b) == core::cmp::Ordering::Less {
        (a, b)
    } else {
        (b, a)
    };
    buf.append(&Bytes::from_array(env, &lo.to_array()));
    buf.append(&Bytes::from_array(env, &hi.to_array()));
    env.crypto().sha256(&buf).into()
}

fn compare_bytes32(a: &BytesN<32>, b: &BytesN<32>) -> core::cmp::Ordering {
    let ax = a.to_array();
    let bx = b.to_array();
    for i in 0..32 {
        match ax[i].cmp(&bx[i]) {
            core::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    core::cmp::Ordering::Equal
}

// ─── Contract — MerkleAirdropRegistry ──────────────────────────────────────

#[contract]
pub struct MerkleAirdropRegistry;

#[contractimpl]
impl MerkleAirdropRegistry {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    /// Publish (or rotate, if admin) the root for a campaign.
    pub fn set_root(env: Env, campaign_id: Bytes, root: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        admin.require_auth();

        let key = DataKey::Root(campaign_id.clone());
        if env.storage().persistent().has(&key) {
            // Rotation requires re-setting under the same id; emit the
            // event so off-chain indexers can pick up the change.
            env.storage().persistent().set(&key, &root);
        } else {
            env.storage().persistent().set(&key, &root);
        }
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );

        RootSet { campaign_id, root }.publish(&env);
    }

    pub fn get_root(env: Env, campaign_id: Bytes) -> BytesN<32> {
        env.storage()
            .persistent()
            .get(&DataKey::Root(campaign_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::RootNotSet))
    }

    /// Verify a proof against the stored root. Read-only.
    pub fn verify(
        env: Env,
        campaign_id: Bytes,
        leaf: BytesN<32>,
        proof: soroban_sdk::Vec<BytesN<32>>,
    ) -> bool {
        let root: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::Root(campaign_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::RootNotSet));
        verify_proof(&env, &root, &leaf, &proof)
    }

    /// Claim a leaf: caller must auth, the leaf must verify, and the
    /// leaf must not have been claimed before.
    pub fn claim(
        env: Env,
        campaign_id: Bytes,
        claimant: Address,
        leaf: BytesN<32>,
        proof: soroban_sdk::Vec<BytesN<32>>,
    ) {
        claimant.require_auth();

        let root: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::Root(campaign_id.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, Error::RootNotSet));

        if !verify_proof(&env, &root, &leaf, &proof) {
            panic_with_error!(&env, Error::InvalidProof);
        }

        let claim_key = DataKey::Claimed(campaign_id.clone(), leaf.clone());
        if env.storage().persistent().has(&claim_key) {
            panic_with_error!(&env, Error::AlreadyClaimed);
        }
        env.storage().persistent().set(&claim_key, &true);
        env.storage().persistent().extend_ttl(
            &claim_key,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );

        LeafClaimed {
            campaign_id,
            leaf,
            claimant,
        }
        .publish(&env);
    }

    pub fn is_claimed(env: Env, campaign_id: Bytes, leaf: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Claimed(campaign_id, leaf))
    }
}

#[cfg(test)]
mod tests;
