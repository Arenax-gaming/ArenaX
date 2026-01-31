use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, Vec};

// Data Structures

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    MatchContract,
    Tournament(BytesN<32>),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RankingEntry {
    pub player: Address,
    pub position: u32,
    pub score: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardAllocation {
    pub player: Address,
    pub amount: i128,
    pub asset: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TournamentSnapshot {
    pub tournament_id: BytesN<32>,
    pub match_ids: Vec<BytesN<32>>,
    pub rankings: Vec<RankingEntry>,
    pub rewards: Vec<RewardAllocation>,
    pub finalized_at: u64,
}

mod match_contract {
    soroban_sdk::contractimport!(
        file = "../target/wasm32-unknown-unknown/release/match_contract.wasm"
    );
}

use match_contract::MatchData;

#[contract]
pub struct TournamentFinalizer;

#[contractimpl]
impl TournamentFinalizer {
    /// Initialize the contract with admin and match contract address
    pub fn initialize(env: Env, admin: Address, match_contract: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::MatchContract, &match_contract);
    }

    /// Finalize a tournament and publish an immutable snapshot
    pub fn finalize_tournament(
        env: Env,
        tournament_id: BytesN<32>,
        match_ids: Vec<BytesN<32>>,
        rankings: Vec<RankingEntry>,
        rewards: Vec<RewardAllocation>,
    ) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        if env
            .storage()
            .persistent()
            .has(&DataKey::Tournament(tournament_id.clone()))
        {
            panic!("tournament already finalized");
        }

        let match_contract_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::MatchContract)
            .expect("match contract not set");

        // Validate all matches are completed
        let match_client = match_contract::Client::new(&env, &match_contract_addr);
        for match_id in match_ids.iter() {
            let match_data: MatchData = match_client.get_match(&match_id);
            // MatchState is an enum in match_contract, but we can check the u32 value
            // MatchState::Completed is 2
            if match_data.state != 2 {
                panic!("all matches must be completed");
            }
        }

        let snapshot = TournamentSnapshot {
            tournament_id: tournament_id.clone(),
            match_ids,
            rankings,
            rewards,
            finalized_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Tournament(tournament_id.clone()), &snapshot);

        // Emit finalization event
        env.events().publish(
            (symbol_short!("finalized"), tournament_id),
            env.ledger().timestamp(),
        );
    }

    /// Retrieve a tournament snapshot
    pub fn get_tournament_snapshot(env: Env, tournament_id: BytesN<32>) -> TournamentSnapshot {
        env.storage()
            .persistent()
            .get(&DataKey::Tournament(tournament_id))
            .expect("tournament not found")
    }

    /// Check if a tournament is finalized
    pub fn is_finalized(env: Env, tournament_id: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Tournament(tournament_id))
    }
}
