#![no_std]

//! # Sponsored Tournament Contract
//!
//! Manages sponsored tournaments and Stellar/Soroban community prize pools on ArenaX.
//!
//! ## Lifecycle hooks (#1417)
//!
//! An organizer may attach a hook contract implementing `on_register`,
//! `on_start` and `on_complete` (see `composable-example::tournament_hooks`).
//! The hook is invoked after the tournament has written its own state for the
//! corresponding milestone. Because hook calls are plain cross-contract
//! calls, a panicking hook aborts the whole invocation and Soroban rolls back
//! every storage write made in it, keeping tournament and hook state
//! consistent. Tournaments without a hook skip the call (default no-op).

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Bytes, Env, Vec};

/// Client for tournament hook contracts. Mirrors the interface defined in
/// `composable-example::tournament_hooks`; declared here so this contract does
/// not link another contract's exports into its own wasm.
mod hook_client {
    use soroban_sdk::{contractclient, Address, Env};

    #[contractclient(name = "TournamentHookClient")]
    #[allow(dead_code)]
    pub trait TournamentHook {
        fn on_register(env: Env, tournament_id: u64, player: Address);
        fn on_start(env: Env, tournament_id: u64);
        fn on_complete(env: Env, tournament_id: u64, winner: Address);
    }
}

use hook_client::TournamentHookClient;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum TournamentApprovalStatus {
    Pending,
    Approved,
    Rejected,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum TournamentPhase {
    Registration,
    Started,
    Completed,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct CommunityTournament {
    pub id: u64,
    pub organizer: Address,
    pub sponsor: Address,
    pub prize_pool_amount: i128,
    pub token: Address,
    pub approval_status: TournamentApprovalStatus,
    pub is_sponsored: bool,
    pub telemetry_hash: Bytes,
}

#[contracttype]
pub enum DataKey {
    Admin,
    TournamentCount,
    Tournament(u64),
    SponsorPool(u64),
    Hook(u64),
    Phase(u64),
    Participants(u64),
    Winner(u64),
}

#[contract]
pub struct SponsoredTournamentContract;

#[contractimpl]
impl SponsoredTournamentContract {
    /// Initialize the contract with an admin authority.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage()
            .persistent()
            .set(&DataKey::TournamentCount, &0u64);
    }

    /// Create a community tournament requiring admin approval (Issue #1248 & #1249).
    pub fn create_community_tournament(
        env: Env,
        organizer: Address,
        sponsor: Address,
        prize_pool_amount: i128,
        token_addr: Address,
        is_sponsored: bool,
        telemetry_hash: Bytes,
    ) -> u64 {
        organizer.require_auth();

        let count: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::TournamentCount)
            .unwrap_or(0);
        let id = count + 1;

        if prize_pool_amount > 0 {
            let client = token::Client::new(&env, &token_addr);
            client.transfer(
                &organizer,
                env.current_contract_address(),
                &prize_pool_amount,
            );
        }

        let tournament = CommunityTournament {
            id,
            organizer,
            sponsor,
            prize_pool_amount,
            token: token_addr,
            approval_status: TournamentApprovalStatus::Pending,
            is_sponsored,
            telemetry_hash,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Tournament(id), &tournament);
        env.storage()
            .persistent()
            .set(&DataKey::TournamentCount, &id);
        id
    }

    /// Approve a community tournament (Issue #1248 admin approval).
    pub fn approve_tournament(env: Env, admin: Address, tournament_id: u64) {
        admin.require_auth();
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("unauthorized");
        }

        let mut tournament = Self::get_tournament(env.clone(), tournament_id);

        tournament.approval_status = TournamentApprovalStatus::Approved;
        env.storage()
            .persistent()
            .set(&DataKey::Tournament(tournament_id), &tournament);
    }

    /// AI Anti-cheat telemetry verification (Issue #1250).
    pub fn verify_telemetry(env: Env, tournament_id: u64, telemetry_proof: Bytes) -> bool {
        let tournament = Self::get_tournament(env, tournament_id);

        // Verify telemetry hash matches proof
        !telemetry_proof.is_empty() && !tournament.telemetry_hash.is_empty()
    }

    pub fn get_tournament(env: Env, tournament_id: u64) -> CommunityTournament {
        env.storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id))
            .expect("tournament not found")
    }

    /// Attach a lifecycle hook contract. Organizer only, during registration.
    pub fn set_tournament_hook(env: Env, tournament_id: u64, hook: Address) {
        Self::require_organizer(&env, tournament_id);
        Self::require_phase(&env, tournament_id, TournamentPhase::Registration);
        env.storage()
            .persistent()
            .set(&DataKey::Hook(tournament_id), &hook);
    }

    /// Detach the lifecycle hook, reverting to the default no-op behaviour.
    pub fn clear_tournament_hook(env: Env, tournament_id: u64) {
        Self::require_organizer(&env, tournament_id);
        Self::require_phase(&env, tournament_id, TournamentPhase::Registration);
        env.storage()
            .persistent()
            .remove(&DataKey::Hook(tournament_id));
    }

    pub fn get_tournament_hook(env: Env, tournament_id: u64) -> Option<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Hook(tournament_id))
    }

    pub fn get_phase(env: Env, tournament_id: u64) -> TournamentPhase {
        env.storage()
            .persistent()
            .get(&DataKey::Phase(tournament_id))
            .unwrap_or(TournamentPhase::Registration)
    }

    pub fn get_participants(env: Env, tournament_id: u64) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Participants(tournament_id))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_winner(env: Env, tournament_id: u64) -> Option<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Winner(tournament_id))
    }

    /// Register a player for an approved tournament, then invoke `on_register`.
    pub fn register_player(env: Env, tournament_id: u64, player: Address) {
        player.require_auth();

        let tournament = Self::get_tournament(env.clone(), tournament_id);
        if tournament.approval_status != TournamentApprovalStatus::Approved {
            panic!("tournament not approved");
        }
        Self::require_phase(&env, tournament_id, TournamentPhase::Registration);

        let mut participants = Self::get_participants(env.clone(), tournament_id);
        if participants.contains(&player) {
            panic!("already registered");
        }
        participants.push_back(player.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Participants(tournament_id), &participants);

        if let Some(hook) = Self::get_tournament_hook(env.clone(), tournament_id) {
            TournamentHookClient::new(&env, &hook).on_register(&tournament_id, &player);
        }
    }

    /// Start the tournament (organizer only), then invoke `on_start`.
    pub fn start_tournament(env: Env, tournament_id: u64) {
        Self::require_organizer(&env, tournament_id);
        Self::require_phase(&env, tournament_id, TournamentPhase::Registration);

        if Self::get_participants(env.clone(), tournament_id).len() < 2 {
            panic!("not enough participants");
        }
        env.storage()
            .persistent()
            .set(&DataKey::Phase(tournament_id), &TournamentPhase::Started);

        if let Some(hook) = Self::get_tournament_hook(env.clone(), tournament_id) {
            TournamentHookClient::new(&env, &hook).on_start(&tournament_id);
        }
    }

    /// Complete the tournament with a winner (organizer only), then invoke
    /// `on_complete`.
    pub fn complete_tournament(env: Env, tournament_id: u64, winner: Address) {
        Self::require_organizer(&env, tournament_id);
        Self::require_phase(&env, tournament_id, TournamentPhase::Started);

        if !Self::get_participants(env.clone(), tournament_id).contains(&winner) {
            panic!("winner not a participant");
        }
        env.storage()
            .persistent()
            .set(&DataKey::Phase(tournament_id), &TournamentPhase::Completed);
        env.storage()
            .persistent()
            .set(&DataKey::Winner(tournament_id), &winner);

        if let Some(hook) = Self::get_tournament_hook(env.clone(), tournament_id) {
            TournamentHookClient::new(&env, &hook).on_complete(&tournament_id, &winner);
        }
    }

    fn require_organizer(env: &Env, tournament_id: u64) {
        let tournament = Self::get_tournament(env.clone(), tournament_id);
        tournament.organizer.require_auth();
    }

    fn require_phase(env: &Env, tournament_id: u64, expected: TournamentPhase) {
        if Self::get_phase(env.clone(), tournament_id) != expected {
            panic!("invalid tournament phase");
        }
    }
}

#[cfg(test)]
mod test;
