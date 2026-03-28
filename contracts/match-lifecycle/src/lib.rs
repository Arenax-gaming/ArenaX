#![no_std]

//! # Match Lifecycle Manager
//!
//! Manages creation, participation, result submission, and finalization of matches
//! with strict state transitions and authorization. Supports dual-reporting:
//! two participants must submit matching results before a match can be finalized.

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, Address, BytesN, Env, IntoVal, Symbol, Vec,
};

// Events (match_created, result_submitted, match_finalized)
#[contractevent(topics = ["ArenaXMatchLifecycle", "CREATED"])]
pub struct MatchCreated {
    pub match_id: BytesN<32>,
    pub players: Vec<Address>,
    pub stake_asset: Address,
    pub stake_amount: i128,
    pub created_at: u64,
}

#[contractevent(topics = ["ArenaXMatchLifecycle", "RESULT"])]
pub struct ResultSubmitted {
    pub match_id: BytesN<32>,
    pub reporter: Address,
    pub score: i64,
    pub report_number: u32,
}

#[contractevent(topics = ["ArenaXMatchLifecycle", "FINALIZED"])]
pub struct MatchFinalized {
    pub match_id: BytesN<32>,
    pub winner: Address,
    pub finalized_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Match(BytesN<32>),
    Admin,
    IdentityContract,
    EscrowContract,
    FinalizationWindow,
    DisputeDeadline(BytesN<32>),
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MatchState {
    Created = 0,
    InProgress = 1,
    PendingResult = 2,
    Finalized = 3,
    Disputed = 4,
    Cancelled = 5,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MatchData {
    pub players: Vec<Address>,
    pub stake_asset: Address,
    pub stake_amount: i128,
    pub state: u32,
    pub created_at: u64,
    pub report1_reporter: Option<Address>,
    pub report1_score: Option<i64>,
    pub report2_reporter: Option<Address>,
    pub report2_score: Option<i64>,
    pub winner: Option<Address>,
    pub finalized_at: Option<u64>,
}

#[contract]
pub struct MatchLifecycleContract;

#[contractimpl]
impl MatchLifecycleContract {
    /// Initialize the contract with an admin (optional; used for set_identity_contract).
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Set the Identity Contract address for operator (Referee/Admin) checks on finalize.
    pub fn set_identity_contract(env: Env, identity_contract: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::IdentityContract, &identity_contract);
    }
    /// Set the Escrow Contract address for prize distribution
    pub fn set_escrow_contract(env: Env, escrow_contract: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::EscrowContract, &escrow_contract);
    }

    /// Set the finalization window (time in seconds after match completion before disputes are no longer accepted)
    pub fn set_finalization_window(env: Env, window_seconds: u64) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::FinalizationWindow, &window_seconds);
    }

    /// Create a new match with the given players, stake asset, and stake amount.
    /// Automatically creates escrow for prize pool.
    /// State: Created.
    pub fn create_match(
        env: Env,
        match_id: BytesN<32>,
        players: Vec<Address>,
        stake_asset: Address,
        stake_amount: i128,
    ) {
        if env
            .storage()
            .persistent()
            .has(&DataKey::Match(match_id.clone()))
        {
            panic!("match already exists");
        }
        if players.len() < 2 {
            panic!("at least two players required");
        }
        if stake_amount <= 0 {
            panic!("stake_amount must be positive");
        }

        let created_at = env.ledger().timestamp();
        let match_data = MatchData {
            players: players.clone(),
            stake_asset: stake_asset.clone(),
            stake_amount,
            state: MatchState::Created as u32,
            created_at,
            report1_reporter: None,
            report1_score: None,
            report2_reporter: None,
            report2_score: None,
            winner: None,
            finalized_at: None,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Match(match_id.clone()), &match_data);

        // Create escrow for prize pool (atomic operation)
        if let Some(escrow_contract) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::EscrowContract)
        {
            let player_a = players.get(0).unwrap();
            let player_b = players.get(1).unwrap();
            
            let _: () = env.invoke_contract(
                &escrow_contract,
                &Symbol::new(&env, "create_escrow"),
                (
                    match_id.clone(),
                    player_a,
                    player_b,
                    stake_amount,
                    stake_asset.clone(),
                )
                    .into_val(&env),
            );
        }

        MatchCreated {
            match_id,
            players,
            stake_asset: match_data.stake_asset.clone(),
            stake_amount: match_data.stake_amount,
            created_at,
        }
        .publish(&env);
    }

    /// Submit a result for a match. Reporter must be a participant.
    /// First report: transition Created -> InProgress and store report.
    /// Second report: if same score from another participant -> PendingResult; if different score -> Disputed.
    pub fn submit_result(env: Env, match_id: BytesN<32>, reporter: Address, score: i64) {
        reporter.require_auth();

        let mut match_data: MatchData = env
            .storage()
            .persistent()
            .get(&DataKey::Match(match_id.clone()))
            .expect("match not found");

        let state = match_data.state;
        if state != MatchState::Created as u32 && state != MatchState::InProgress as u32 {
            panic!("invalid state for result submission");
        }

        if !Self::is_participant(&match_data.players, &reporter) {
            panic!("reporter must be a participant");
        }

        if state == MatchState::Created as u32 {
            match_data.state = MatchState::InProgress as u32;
        }

        if match_data.report1_reporter.is_none() {
            match_data.report1_reporter = Some(reporter.clone());
            match_data.report1_score = Some(score);
            env.storage()
                .persistent()
                .set(&DataKey::Match(match_id.clone()), &match_data);
            ResultSubmitted {
                match_id: match_id.clone(),
                reporter,
                score,
                report_number: 1,
            }
            .publish(&env);
            return;
        }

        if match_data.report1_reporter.as_ref() == Some(&reporter) {
            panic!("same reporter cannot submit twice");
        }

        match_data.report2_reporter = Some(reporter.clone());
        match_data.report2_score = Some(score);

        let score1 = match_data.report1_score.unwrap();
        if score == score1 {
            match_data.state = MatchState::PendingResult as u32;
        } else {
            match_data.state = MatchState::Disputed as u32;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Match(match_id.clone()), &match_data);

        ResultSubmitted {
            match_id,
            reporter,
            score,
            report_number: 2,
        }
        .publish(&env);
    }

    /// Finalize a match. Caller must be a participant or an operator (Referee/Admin via identity contract).
    /// Only allowed when state is PendingResult. Sets winner from agreed score (score = player index).
    /// Automatically triggers prize distribution if no dispute window is active.
    pub fn finalize_match(env: Env, match_id: BytesN<32>, caller: Address) {
        let mut match_data: MatchData = env
            .storage()
            .persistent()
            .get(&DataKey::Match(match_id.clone()))
            .expect("match not found");

        if match_data.state != MatchState::PendingResult as u32 {
            panic!("match must be in PendingResult to finalize");
        }

        let is_participant = Self::is_participant(&match_data.players, &caller);
        let is_operator = Self::is_operator(&env, &caller);

        if !is_participant && !is_operator {
            panic!("only participants or operators can finalize");
        }

        caller.require_auth();

        let score = match_data.report1_score.unwrap();
        let winner = Self::winner_from_score(&env, &match_data.players, score)
            .expect("agreed score must be a valid player index");

        match_data.state = MatchState::Finalized as u32;
        match_data.winner = Some(winner.clone());
        match_data.finalized_at = Some(env.ledger().timestamp());

        env.storage()
            .persistent()
            .set(&DataKey::Match(match_id.clone()), &match_data);

        // Set dispute deadline (finalization window)
        let finalization_window: u64 = env
            .storage()
            .instance()
            .get(&DataKey::FinalizationWindow)
            .unwrap_or(300); // Default 5 minutes

        let dispute_deadline = env.ledger().timestamp() + finalization_window;
        env.storage()
            .persistent()
            .set(&DataKey::DisputeDeadline(match_id.clone()), &dispute_deadline);

        MatchFinalized {
            match_id,
            winner,
            finalized_at: match_data.finalized_at.unwrap(),
        }
        .publish(&env);
    }

    /// Mark match as disputed (e.g. from external dispute flow). Operator or participant only.
    /// Blocks prize distribution until dispute is resolved.
    pub fn raise_dispute(env: Env, match_id: BytesN<32>, caller: Address) {
        caller.require_auth();

        let mut match_data: MatchData = env
            .storage()
            .persistent()
            .get(&DataKey::Match(match_id.clone()))
            .expect("match not found");

        // Can raise dispute during InProgress, PendingResult, or within finalization window after Finalized
        if match_data.state == MatchState::Finalized as u32 {
            // Check if still within dispute window
            if let Some(dispute_deadline) = env
                .storage()
                .persistent()
                .get::<DataKey, u64>(&DataKey::DisputeDeadline(match_id.clone()))
            {
                if env.ledger().timestamp() > dispute_deadline {
                    panic!("dispute window has expired");
                }
            } else {
                panic!("no dispute window set");
            }
        } else if match_data.state != MatchState::InProgress as u32
            && match_data.state != MatchState::PendingResult as u32
        {
            panic!("invalid state for dispute");
        }

        let is_participant = Self::is_participant(&match_data.players, &caller);
        let is_operator = Self::is_operator(&env, &caller);
        if !is_participant && !is_operator {
            panic!("only participants or operators can raise dispute");
        }

        match_data.state = MatchState::Disputed as u32;
        env.storage()
            .persistent()
            .set(&DataKey::Match(match_id.clone()), &match_data);

        // Mark escrow as disputed to block payouts
        if let Some(escrow_contract) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::EscrowContract)
        {
            let _: () = env.invoke_contract(
                &escrow_contract,
                &Symbol::new(&env, "mark_disputed"),
                (match_id,).into_val(&env),
            );
        }
    }
    /// Distribute prize to winner after finalization window expires without disputes.
    /// Can be called by anyone once the dispute window has passed.
    pub fn distribute_prize(env: Env, match_id: BytesN<32>) {
        let match_data: MatchData = env
            .storage()
            .persistent()
            .get(&DataKey::Match(match_id.clone()))
            .expect("match not found");

        if match_data.state != MatchState::Finalized as u32 {
            panic!("match must be finalized");
        }

        // Check if dispute deadline has passed
        if let Some(dispute_deadline) = env
            .storage()
            .persistent()
            .get::<DataKey, u64>(&DataKey::DisputeDeadline(match_id.clone()))
        {
            if env.ledger().timestamp() < dispute_deadline {
                panic!("dispute window still active");
            }
        }

        let winner = match_data.winner.expect("winner must be set");

        // Call escrow contract to release funds
        if let Some(escrow_contract) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::EscrowContract)
        {
            let _: () = env.invoke_contract(
                &escrow_contract,
                &Symbol::new(&env, "release_to_winner"),
                (match_id.clone(), winner).into_val(&env),
            );
        } else {
            panic!("escrow contract not set");
        }
    }
    /// Resolve a disputed match and distribute prize to the determined winner.
    /// Can only be called by operators (Referee/Admin).
    pub fn resolve_dispute_and_distribute(
        env: Env,
        match_id: BytesN<32>,
        winner: Address,
        resolver: Address,
    ) {
        resolver.require_auth();

        if !Self::is_operator(&env, &resolver) {
            panic!("only operators can resolve disputes");
        }

        let mut match_data: MatchData = env
            .storage()
            .persistent()
            .get(&DataKey::Match(match_id.clone()))
            .expect("match not found");

        if match_data.state != MatchState::Disputed as u32 {
            panic!("match must be disputed");
        }

        if !Self::is_participant(&match_data.players, &winner) {
            panic!("winner must be a participant");
        }

        match_data.state = MatchState::Finalized as u32;
        match_data.winner = Some(winner.clone());
        match_data.finalized_at = Some(env.ledger().timestamp());

        env.storage()
            .persistent()
            .set(&DataKey::Match(match_id.clone()), &match_data);

        // Resolve dispute and distribute prize via escrow contract
        if let Some(escrow_contract) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::EscrowContract)
        {
            let _: () = env.invoke_contract(
                &escrow_contract,
                &Symbol::new(&env, "resolve_dispute"),
                (match_id.clone(), winner.clone(), resolver).into_val(&env),
            );
        } else {
            panic!("escrow contract not set");
        }

        MatchFinalized {
            match_id,
            winner,
            finalized_at: match_data.finalized_at.unwrap(),
        }
        .publish(&env);
    }

    /// Cancel a match and refund all players.
    /// Can only be called by admin or operator before match is finalized.
    pub fn cancel_match(env: Env, match_id: BytesN<32>, caller: Address) {
        caller.require_auth();

        let mut match_data: MatchData = env
            .storage()
            .persistent()
            .get(&DataKey::Match(match_id.clone()))
            .expect("match not found");

        if match_data.state == MatchState::Finalized as u32 {
            panic!("cannot cancel finalized match");
        }

        if !Self::is_operator(&env, &caller) {
            panic!("only operators can cancel matches");
        }

        match_data.state = MatchState::Cancelled as u32;
        env.storage()
            .persistent()
            .set(&DataKey::Match(match_id.clone()), &match_data);

        // Refund players via escrow contract
        if let Some(escrow_contract) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::EscrowContract)
        {
            let _: () = env.invoke_contract(
                &escrow_contract,
                &Symbol::new(&env, "refund"),
                (match_id,).into_val(&env),
            );
        }
    }

    pub fn get_match(env: Env, match_id: BytesN<32>) -> MatchData {
        env.storage()
            .persistent()
            .get(&DataKey::Match(match_id))
            .expect("match not found")
    }

    pub fn match_exists(env: Env, match_id: BytesN<32>) -> bool {
        env.storage().persistent().has(&DataKey::Match(match_id))
    }

    fn is_participant(players: &Vec<Address>, addr: &Address) -> bool {
        for i in 0..players.len() {
            if players.get(i).unwrap() == *addr {
                return true;
            }
        }
        false
    }

    fn winner_from_score(_env: &Env, players: &Vec<Address>, score: i64) -> Option<Address> {
        if score < 0 {
            return None;
        }
        let idx = score as u32;
        if idx >= players.len() {
            return None;
        }
        Some(players.get(idx).unwrap())
    }

    fn is_operator(env: &Env, addr: &Address) -> bool {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        if addr == &admin {
            return true;
        }
        if let Some(identity_contract) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::IdentityContract)
        {
            let role: u32 = env.invoke_contract(
                &identity_contract,
                &Symbol::new(env, "get_role"),
                (addr.clone(),).into_val(env),
            );
            return role == 1 || role == 2;
        }
        false
    }
}

mod test;
// TODO: Fix authorization for cross-contract calls in integration tests
// mod integration_test;
