#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, IntoVal,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Match(BytesN<32>),
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MatchState {
    Created = 0,
    Started = 1,
    Completed = 2,
    Disputed = 3,
    Cancelled = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MatchData {
    pub player_a: Address,
    pub player_b: Address,
    pub state: u32,
    pub winner: Option<Address>,
    pub started_at: u64,
    pub ended_at: Option<u64>,
}

#[contract]
pub struct MatchContract;

#[contractimpl]
impl MatchContract {
    pub fn create_match(env: Env, match_id: BytesN<32>, player_a: Address, player_b: Address) {
        if env
            .storage()
            .persistent()
            .has(&DataKey::Match(match_id.clone()))
        {
            panic!("match already exists");
        }

        let match_data = MatchData {
            player_a,
            player_b,
            state: MatchState::Created as u32,
            winner: None,
            started_at: 0,
            ended_at: None,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Match(match_id.clone()), &match_data);

        // Emit event
        env.events().publish(
            (symbol_short!("created"), match_id),
            (match_data.player_a, match_data.player_b),
        );
    }

    pub fn start_match(env: Env, match_id: BytesN<32>) {
        let mut match_data: MatchData = env
            .storage()
            .persistent()
            .get(&DataKey::Match(match_id.clone()))
            .expect("match not found");

        if match_data.state != MatchState::Created as u32 {
            panic!("invalid state transition");
        }

        match_data.state = MatchState::Started as u32;
        match_data.started_at = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Match(match_id.clone()), &match_data);

        env.events()
            .publish((symbol_short!("started"), match_id), match_data.started_at);
    }

    pub fn complete_match(env: Env, match_id: BytesN<32>, winner: Address) {
        let mut match_data: MatchData = env
            .storage()
            .persistent()
            .get(&DataKey::Match(match_id.clone()))
            .expect("match not found");

        if match_data.state != MatchState::Started as u32 {
            panic!("invalid state transition");
        }

        if winner != match_data.player_a && winner != match_data.player_b {
            panic!("winner must be one of the players");
        }

        match_data.state = MatchState::Completed as u32;
        match_data.winner = Some(winner.clone());
        match_data.ended_at = Some(env.ledger().timestamp());

        env.storage()
            .persistent()
            .set(&DataKey::Match(match_id.clone()), &match_data);

        env.events()
            .publish((symbol_short!("completd"), match_id), winner);
    }

    pub fn raise_dispute(env: Env, match_id: BytesN<32>) {
        let mut match_data: MatchData = env
            .storage()
            .persistent()
            .get(&DataKey::Match(match_id.clone()))
            .expect("match not found");

        if match_data.state != MatchState::Started as u32 {
            panic!("invalid state transition");
        }

        match_data.state = MatchState::Disputed as u32;

        env.storage()
            .persistent()
            .set(&DataKey::Match(match_id.clone()), &match_data);

        env.events()
            .publish((symbol_short!("disputed"), match_id), ());
    }

    pub fn cancel_match(env: Env, match_id: BytesN<32>) {
        let mut match_data: MatchData = env
            .storage()
            .persistent()
            .get(&DataKey::Match(match_id.clone()))
            .expect("match not found");

        if match_data.state != MatchState::Created as u32 {
            panic!("invalid state transition");
        }

        match_data.state = MatchState::Cancelled as u32;

        env.storage()
            .persistent()
            .set(&DataKey::Match(match_id.clone()), &match_data);

        env.events()
            .publish((symbol_short!("canceled"), match_id), ());
    }

    pub fn resolve_dispute(
        env: Env,
        match_id: BytesN<32>,
        winner: Address,
        identity_contract: Address,
        resolver: Address,
    ) {
        resolver.require_auth();

        // Check if resolver is Referee (1) or Admin (2) via identity contract
        // We'll use get_role(Address) -> u32
        let role: u32 = env.invoke_contract(
            &identity_contract,
            &symbol_short!("get_role"),
            (resolver,).into_val(&env),
        );

        if role != 1 && role != 2 {
            panic!("only referee or admin can resolve disputes");
        }

        let mut match_data: MatchData = env
            .storage()
            .persistent()
            .get(&DataKey::Match(match_id.clone()))
            .expect("match not found");

        if match_data.state != MatchState::Disputed as u32 {
            panic!("invalid state transition");
        }

        if winner != match_data.player_a && winner != match_data.player_b {
            panic!("winner must be one of the players");
        }

        match_data.state = MatchState::Completed as u32;
        match_data.winner = Some(winner.clone());
        match_data.ended_at = Some(env.ledger().timestamp());

        env.storage()
            .persistent()
            .set(&DataKey::Match(match_id.clone()), &match_data);

        env.events()
            .publish((symbol_short!("resolved"), match_id), winner);
    }

    pub fn get_match(env: Env, match_id: BytesN<32>) -> MatchData {
        env.storage()
            .persistent()
            .get(&DataKey::Match(match_id))
            .expect("match not found")
    }
}

mod test;
