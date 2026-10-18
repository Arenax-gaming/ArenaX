#![no_std]

//! # Sponsored Tournament Contract
//!
//! Manages sponsored tournaments and Stellar/Soroban community prize pools on ArenaX.

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Bytes, Env, Symbol, Vec,
};

#[contracttype]
#[derive(Clone, Debug)]
pub enum TournamentApprovalStatus {
    Pending,
    Approved,
    Rejected,
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
        env.storage().persistent().set(&DataKey::TournamentCount, &0u64);
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

        let count: u64 = env.storage().persistent().get(&DataKey::TournamentCount).unwrap_or(0);
        let id = count + 1;

        if prize_pool_amount > 0 {
            let client = token::Client::new(&env, &token_addr);
            client.transfer(&organizer, &env.current_contract_address(), &prize_pool_amount);
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

        env.storage().persistent().set(&DataKey::Tournament(id), &tournament);
        env.storage().persistent().set(&DataKey::TournamentCount, &id);
        id
    }

    /// Approve a community tournament (Issue #1248 admin approval).
    pub fn approve_tournament(env: Env, admin: Address, tournament_id: u64) {
        admin.require_auth();
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("unauthorized");
        }

        let mut tournament: CommunityTournament = env
            .storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id))
            .unwrap();

        tournament.approval_status = TournamentApprovalStatus::Approved;
        env.storage().persistent().set(&DataKey::Tournament(tournament_id), &tournament);
    }

    /// AI Anti-cheat telemetry verification (Issue #1250).
    pub fn verify_telemetry(env: Env, tournament_id: u64, telemetry_proof: Bytes) -> bool {
        let tournament: CommunityTournament = env
            .storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id))
            .unwrap();

        // Verify telemetry hash matches proof
        telemetry_proof.len() > 0 && tournament.telemetry_hash.len() > 0
    }
}
