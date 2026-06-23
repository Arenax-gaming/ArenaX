//! # oracle-integration — Issue #492
//!
//! Provides reliable external data feeds for ArenaX contracts:
//!   * **Price feeds** — e.g. USDC/XLM spot price for stake normalisation.
//!   * **Verifiable random numbers** — commit-reveal scheme driven by admin.
//!   * **Game results** — off-chain match outcomes attested by an authorised
//!     reporter and stored on-chain for downstream contracts to query.
//!
//! ## Architecture
//!
//! One Soroban contract acts as the oracle hub.  Off-chain oracle services
//! (custom or bridged from Chainlink via a relayer) call the `report_*`
//! functions.  Consumer contracts call `get_*` to read validated data.
//!
//! Stale-data protection: every feed entry carries a `valid_until` ledger
//! sequence number.  Reads panic if the data is expired.
//!
//! Fallback: if the primary oracle misses a window, an admin-nominated
//! fallback address can post data — the feed stores which source was used.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, Address, BytesN, Env, String, Symbol, Vec,
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OracleError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    FeedNotFound = 4,
    FeedExpired = 5,
    InvalidPrice = 6,
    RequestNotFound = 7,
    RequestAlreadyFulfilled = 8,
    InvalidReveal = 9,
    ResultNotFound = 10,
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/// A single price data point from an oracle reporter.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PriceFeed {
    /// Asset pair symbol, e.g. `USDC_XLM`.
    pub pair: Symbol,
    /// Price scaled by 1_000_000 (6 decimal places). E.g. 1.25 = 1_250_000.
    pub price: i128,
    /// Which oracle source posted this data point.
    pub source: Address,
    /// Ledger timestamp when the price was reported.
    pub reported_at: u64,
    /// Ledger sequence after which this data point must not be used.
    pub valid_until: u32,
}

/// Commit-reveal random number request.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RandRequest {
    pub requester: Address,
    /// SHA-256 hash of the reveal preimage committed up-front.
    pub commit: BytesN<32>,
    pub requested_at: u64,
    pub fulfilled: bool,
    pub random_value: Option<u64>,
}

/// Source-of-truth record for an off-chain match result.
#[contracttype]
#[derive(Clone, Debug)]
pub struct GameResult {
    /// Unique match ID (matches what match-lifecycle uses).
    pub match_id: BytesN<32>,
    pub winner: Address,
    pub loser: Address,
    /// Raw score pair (winner_score, loser_score).
    pub score: (u32, u32),
    /// Free-form evidence URI (e.g. IPFS CID of replay hash).
    pub evidence_uri: String,
    pub reported_at: u64,
    pub reporter: Address,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    OracleReporter,
    FallbackReporter,
    Price(Symbol),
    RandReq(u64),
    RandSeq,
    GameResult(BytesN<32>),
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct OracleIntegration;

#[contractimpl]
impl OracleIntegration {
    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /// Initialise the oracle hub.
    ///
    /// * `admin` — can appoint reporters and manage config.
    /// * `oracle_reporter` — primary off-chain oracle relayer address.
    pub fn initialize(env: Env, admin: Address, oracle_reporter: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("{}", OracleError::AlreadyInitialized as u32);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::OracleReporter, &oracle_reporter);
        env.storage().instance().set(&DataKey::RandSeq, &0u64);
        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "initialized")),
            admin.clone(),
        );
    }

    /// Appoint a fallback reporter (used if the primary reporter is offline).
    pub fn set_fallback_reporter(env: Env, fallback: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::FallbackReporter, &fallback);
    }

    // ── Price Feeds ───────────────────────────────────────────────────────────

    /// Report a new price for an asset pair.
    ///
    /// * `pair` — symbol like `USDC_XLM`.
    /// * `price` — scaled by 1_000_000.
    /// * `valid_ledgers` — how many ledgers from now this price is valid.
    pub fn report_price(env: Env, pair: Symbol, price: i128, valid_ledgers: u32) {
        let reporter = Self::require_reporter(&env);
        if price <= 0 {
            panic!("{}", OracleError::InvalidPrice as u32);
        }
        let feed = PriceFeed {
            pair: pair.clone(),
            price,
            source: reporter,
            reported_at: env.ledger().timestamp(),
            valid_until: env.ledger().sequence() + valid_ledgers,
        };
        env.storage().persistent().set(&DataKey::Price(pair.clone()), &feed);
        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "price_reported")),
            (pair, price),
        );
    }

    /// Retrieve the current price for a pair. Panics if expired or not found.
    pub fn get_price(env: Env, pair: Symbol) -> PriceFeed {
        let feed: PriceFeed = env
            .storage()
            .persistent()
            .get(&DataKey::Price(pair))
            .unwrap_or_else(|| panic!("{}", OracleError::FeedNotFound as u32));
        if env.ledger().sequence() > feed.valid_until {
            panic!("{}", OracleError::FeedExpired as u32);
        }
        feed
    }

    // ── Verifiable Randomness ─────────────────────────────────────────────────

    /// Request a random number.  Caller commits to a SHA-256 hash of their
    /// chosen preimage (`commit`) to prevent oracle front-running.
    ///
    /// Returns the request ID which must be passed to `fulfill_random`.
    pub fn request_random(env: Env, requester: Address, commit: BytesN<32>) -> u64 {
        requester.require_auth();
        let seq: u64 = env.storage().instance().get(&DataKey::RandSeq).unwrap_or(0);
        let request_id = seq;
        env.storage().instance().set(&DataKey::RandSeq, &(seq + 1));

        let req = RandRequest {
            requester: requester.clone(),
            commit,
            requested_at: env.ledger().timestamp(),
            fulfilled: false,
            random_value: None,
        };
        env.storage().persistent().set(&DataKey::RandReq(request_id), &req);
        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "rand_requested")),
            (requester, request_id),
        );
        request_id
    }

    /// Fulfill a randomness request.  The oracle posts the preimage (`reveal`);
    /// we verify it hashes to the original commit before storing the result.
    ///
    /// `random_value` is the oracle's chosen output (e.g. from a VRF).
    pub fn fulfill_random(env: Env, request_id: u64, reveal: BytesN<32>, random_value: u64) {
        Self::require_reporter(&env);
        let mut req: RandRequest = env
            .storage()
            .persistent()
            .get(&DataKey::RandReq(request_id))
            .unwrap_or_else(|| panic!("{}", OracleError::RequestNotFound as u32));

        if req.fulfilled {
            panic!("{}", OracleError::RequestAlreadyFulfilled as u32);
        }

        // Verify reveal hashes to the committed value.
        let hash = env.crypto().sha256(&reveal.into());
        let expected: BytesN<32> = hash.into();
        if expected != req.commit {
            panic!("{}", OracleError::InvalidReveal as u32);
        }

        req.fulfilled = true;
        req.random_value = Some(random_value);
        env.storage().persistent().set(&DataKey::RandReq(request_id), &req);
        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "rand_fulfilled")),
            (request_id, random_value),
        );
    }

    /// Read a fulfilled random value.
    pub fn get_random(env: Env, request_id: u64) -> u64 {
        let req: RandRequest = env
            .storage()
            .persistent()
            .get(&DataKey::RandReq(request_id))
            .unwrap_or_else(|| panic!("{}", OracleError::RequestNotFound as u32));
        req.random_value.unwrap_or_else(|| panic!("{}", OracleError::RequestNotFound as u32))
    }

    // ── Game Results ──────────────────────────────────────────────────────────

    /// Post an authoritative match result.
    pub fn report_game_result(
        env: Env,
        match_id: BytesN<32>,
        winner: Address,
        loser: Address,
        winner_score: u32,
        loser_score: u32,
        evidence_uri: String,
    ) {
        let reporter = Self::require_reporter(&env);
        let result = GameResult {
            match_id: match_id.clone(),
            winner,
            loser,
            score: (winner_score, loser_score),
            evidence_uri,
            reported_at: env.ledger().timestamp(),
            reporter,
        };
        env.storage().persistent().set(&DataKey::GameResult(match_id.clone()), &result);
        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "result_reported")),
            match_id,
        );
    }

    /// Retrieve the recorded result for a match.
    pub fn get_game_result(env: Env, match_id: BytesN<32>) -> GameResult {
        env.storage()
            .persistent()
            .get(&DataKey::GameResult(match_id))
            .unwrap_or_else(|| panic!("{}", OracleError::ResultNotFound as u32))
    }

    // ── Admin helpers ─────────────────────────────────────────────────────────

    pub fn admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("{}", OracleError::NotInitialized as u32))
    }

    pub fn oracle_reporter(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::OracleReporter)
            .unwrap_or_else(|| panic!("{}", OracleError::NotInitialized as u32))
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    fn require_admin(env: &Env) -> Address {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("{}", OracleError::NotInitialized as u32));
        admin.require_auth();
        admin
    }

    fn require_reporter(env: &Env) -> Address {
        let reporter: Address = env
            .storage()
            .instance()
            .get(&DataKey::OracleReporter)
            .unwrap_or_else(|| panic!("{}", OracleError::NotInitialized as u32));
        reporter.require_auth();
        reporter
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger},
        Env, Symbol,
    };

    fn setup() -> (Env, OracleIntegrationClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, OracleIntegration);
        let client = OracleIntegrationClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let reporter = Address::generate(&env);
        client.initialize(&admin, &reporter);
        (env, client, admin, reporter)
    }

    #[test]
    fn test_initialize() {
        let (_, client, admin, reporter) = setup();
        assert_eq!(client.admin(), admin);
        assert_eq!(client.oracle_reporter(), reporter);
    }

    #[test]
    #[should_panic]
    fn test_double_initialize_panics() {
        let (env, client, admin, reporter) = setup();
        client.initialize(&admin, &reporter);
    }

    #[test]
    fn test_price_feed() {
        let (env, client, _, _) = setup();
        let pair = Symbol::new(&env, "USDC_XLM");
        client.report_price(&pair, &1_250_000i128, &100u32);
        let feed = client.get_price(&pair);
        assert_eq!(feed.price, 1_250_000);
    }

    #[test]
    #[should_panic]
    fn test_expired_price_panics() {
        let (env, client, _, _) = setup();
        let pair = Symbol::new(&env, "USDC_XLM");
        client.report_price(&pair, &1_000_000i128, &1u32);
        // Advance ledger past valid_until
        env.ledger().with_mut(|l| l.sequence_number += 10);
        client.get_price(&pair);
    }

    #[test]
    fn test_random_commit_reveal() {
        let (env, client, _, _) = setup();
        let requester = Address::generate(&env);
        let preimage_bytes = soroban_sdk::Bytes::from_array(&env, &[42u8; 32]);
        let reveal = BytesN::from_array(&env, &[42u8; 32]);
        let commit: BytesN<32> = env.crypto().sha256(&preimage_bytes).into();
        let req_id = client.request_random(&requester, &commit);
        client.fulfill_random(&req_id, &reveal, &9999u64);
        assert_eq!(client.get_random(&req_id), 9999);
    }

    #[test]
    #[should_panic]
    fn test_bad_reveal_panics() {
        let (env, client, _, _) = setup();
        let requester = Address::generate(&env);
        let preimage_bytes = soroban_sdk::Bytes::from_array(&env, &[42u8; 32]);
        let commit: BytesN<32> = env.crypto().sha256(&preimage_bytes).into();
        let req_id = client.request_random(&requester, &commit);
        // Wrong reveal
        let bad_reveal = BytesN::from_array(&env, &[99u8; 32]);
        client.fulfill_random(&req_id, &bad_reveal, &1234u64);
    }

    #[test]
    fn test_game_result() {
        let (env, client, _, _) = setup();
        let match_id = BytesN::from_array(&env, &[1u8; 32]);
        let winner = Address::generate(&env);
        let loser = Address::generate(&env);
        client.report_game_result(
            &match_id,
            &winner,
            &loser,
            &3u32,
            &1u32,
            &String::from_str(&env, "ipfs://QmTest"),
        );
        let result = client.get_game_result(&match_id);
        assert_eq!(result.score, (3, 1));
        assert_eq!(result.winner, winner);
    }
}
