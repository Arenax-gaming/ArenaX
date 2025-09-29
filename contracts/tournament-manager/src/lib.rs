use soroban_sdk::{contract, contractimpl, Address, Env, String, Vec, Symbol};

/// Tournament state enumeration
#[derive(Clone, Debug, PartialEq)]
pub enum TournamentState {
    Created,
    RegistrationOpen,
    RegistrationClosed,
    InProgress,
    Completed,
    Cancelled,
}

/// Storage keys for the contract
const ADMIN_KEY: &str = "admin";
const TOURNAMENT_COUNTER_KEY: &str = "tournament_counter";

#[contract]
pub struct TournamentManager;

#[contractimpl]
impl TournamentManager {
    /// Initialize the contract with an admin address
    pub fn initialize(env: Env, admin: Address) {
        env.storage()
            .instance()
            .set(&Symbol::new(&env, ADMIN_KEY), &admin);
        
        // Initialize tournament counter
        env.storage()
            .instance()
            .set(&Symbol::new(&env, TOURNAMENT_COUNTER_KEY), &0u64);
    }

    /// Get the admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, ADMIN_KEY))
            .unwrap()
    }

    /// Create a new tournament
    pub fn create_tournament(
        env: Env, 
        admin: Address, 
        name: String,
        description: String,
        entry_fee: i128,
        max_participants: u32,
        registration_deadline: u64,
        start_time: u64,
        prize_pool: i128
    ) -> u64 {
        // Verify admin authorization
        let contract_admin = Self::get_admin(env.clone());
        admin.require_auth();
        if admin != contract_admin {
            panic!("Only admin can create tournaments");
        }

        // Get next tournament ID
        let tournament_id = env.storage()
            .instance()
            .get(&Symbol::new(&env, TOURNAMENT_COUNTER_KEY))
            .unwrap_or(0u64) + 1;

        // Store tournament data using individual keys
        let tournament_prefix = format!("tournament_{}", tournament_id);
        
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_name", tournament_prefix)), &name);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_desc", tournament_prefix)), &description);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_admin", tournament_prefix)), &admin);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_entry_fee", tournament_prefix)), &entry_fee);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_max_participants", tournament_prefix)), &max_participants);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_reg_deadline", tournament_prefix)), &registration_deadline);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_start_time", tournament_prefix)), &start_time);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_prize_pool", tournament_prefix)), &prize_pool);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_state", tournament_prefix)), &0u32); // Created
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_created_at", tournament_prefix)), &env.ledger().timestamp());
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_participants", tournament_prefix)), &Vec::<Address>::new(&env));

        // Update tournament counter
        env.storage()
            .instance()
            .set(&Symbol::new(&env, TOURNAMENT_COUNTER_KEY), &tournament_id);

        tournament_id
    }

    /// Register participant in tournament
    pub fn register_participant(env: Env, tournament_id: u64, participant: Address, entry_fee: i128) {
        participant.require_auth();

        let tournament_prefix = format!("tournament_{}", tournament_id);
        
        // Check if tournament exists
        if env.storage()
            .instance()
            .get::<Symbol, String>(&Symbol::new(&env, &format!("{}_name", tournament_prefix))).is_none() {
            panic!("Tournament not found");
        }

        // Get tournament state
        let state: u32 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_state", tournament_prefix)))
            .unwrap_or(0u32);

        // Check if tournament is in correct state
        if state != 0 && state != 1 { // Created or RegistrationOpen
            panic!("Tournament is not accepting registrations");
        }

        // Check if registration deadline has passed
        let registration_deadline: u64 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_reg_deadline", tournament_prefix)))
            .unwrap();
        
        if env.ledger().timestamp() > registration_deadline {
            panic!("Registration deadline has passed");
        }

        // Check if tournament is full
        let max_participants: u32 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_max_participants", tournament_prefix)))
            .unwrap();
        
        let mut participants: Vec<Address> = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_participants", tournament_prefix)))
            .unwrap_or(Vec::new(&env));

        if participants.len() >= max_participants {
            panic!("Tournament is full");
        }

        // Check if participant is already registered
        if Self::is_participant(env.clone(), tournament_id, participant.clone()) {
            panic!("Participant already registered");
        }

        // Verify entry fee
        let expected_entry_fee: i128 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_entry_fee", tournament_prefix)))
            .unwrap();
        
        if entry_fee != expected_entry_fee {
            panic!("Incorrect entry fee amount");
        }

        // Add participant
        participants.push_back(participant.clone());
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_participants", tournament_prefix)), &participants);

        // Update tournament state if this is the first participant
        if state == 0 { // Created
            env.storage()
                .instance()
                .set(&Symbol::new(&env, &format!("{}_state", tournament_prefix)), &1u32); // RegistrationOpen
        }

        // Store participant mapping for quick lookup
        let participant_key = format!("participants_{}_{:?}", tournament_id, participant);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &participant_key), &true);
    }

    /// Update tournament state
    pub fn update_tournament_state(env: Env, tournament_id: u64, new_state: u32) {
        let tournament_prefix = format!("tournament_{}", tournament_id);
        
        // Check if tournament exists
        if env.storage()
            .instance()
            .get::<Symbol, String>(&Symbol::new(&env, &format!("{}_name", tournament_prefix))).is_none() {
            panic!("Tournament not found");
        }

        // Get tournament admin
        let admin: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_admin", tournament_prefix)))
            .unwrap();

        // Verify admin authorization
        admin.require_auth();
        if admin != Self::get_admin(env.clone()) {
            panic!("Only admin can update tournament state");
        }

        // Get current state
        let current_state: u32 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_state", tournament_prefix)))
            .unwrap_or(0u32);

        // Validate state transition
        match (current_state, new_state) {
            (0, 1) => {}, // Created -> RegistrationOpen
            (1, 2) => {}, // RegistrationOpen -> RegistrationClosed
            (2, 3) => {}, // RegistrationClosed -> InProgress
            (3, 4) => {}, // InProgress -> Completed
            (0 | 1 | 2 | 3, 5) => {}, // Any state -> Cancelled
            _ => panic!("Invalid state transition"),
        }

        // Update state
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_state", tournament_prefix)), &new_state);
    }

    /// Get tournament details
    pub fn get_tournament_name(env: Env, tournament_id: u64) -> String {
        let tournament_prefix = format!("tournament_{}", tournament_id);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_name", tournament_prefix)))
            .unwrap_or_else(|| panic!("Tournament not found"))
    }

    /// Get tournament state
    pub fn get_tournament_state(env: Env, tournament_id: u64) -> u32 {
        let tournament_prefix = format!("tournament_{}", tournament_id);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_state", tournament_prefix)))
            .unwrap_or_else(|| panic!("Tournament not found"))
    }

    /// Get tournament admin
    pub fn get_tournament_admin(env: Env, tournament_id: u64) -> Address {
        let tournament_prefix = format!("tournament_{}", tournament_id);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_admin", tournament_prefix)))
            .unwrap_or_else(|| panic!("Tournament not found"))
    }

    /// Get tournament entry fee
    pub fn get_tournament_entry_fee(env: Env, tournament_id: u64) -> i128 {
        let tournament_prefix = format!("tournament_{}", tournament_id);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_entry_fee", tournament_prefix)))
            .unwrap_or_else(|| panic!("Tournament not found"))
    }

    /// Get tournament max participants
    pub fn get_tournament_max_participants(env: Env, tournament_id: u64) -> u32 {
        let tournament_prefix = format!("tournament_{}", tournament_id);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_max_participants", tournament_prefix)))
            .unwrap_or_else(|| panic!("Tournament not found"))
    }

    /// Validate tournament completion
    pub fn complete_tournament(env: Env, tournament_id: u64, winners: Vec<Address>) {
        let tournament_prefix = format!("tournament_{}", tournament_id);
        
        // Check if tournament exists
        if env.storage()
            .instance()
            .get::<Symbol, String>(&Symbol::new(&env, &format!("{}_name", tournament_prefix))).is_none() {
            panic!("Tournament not found");
        }

        // Get tournament admin
        let admin: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_admin", tournament_prefix)))
            .unwrap();

        // Verify admin authorization
        admin.require_auth();
        if admin != Self::get_admin(env.clone()) {
            panic!("Only admin can complete tournaments");
        }

        // Check if tournament is in progress
        let state: u32 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_state", tournament_prefix)))
            .unwrap_or(0u32);
        
        if state != 3 { // InProgress
            panic!("Tournament is not in progress");
        }

        // Validate winners are participants
        for winner in winners.iter() {
            if !Self::is_participant(env.clone(), tournament_id, winner.clone()) {
                panic!("Winner is not a registered participant");
            }
        }

        // Update tournament state to completed
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_state", tournament_prefix)), &4u32); // Completed
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_completed_at", tournament_prefix)), &env.ledger().timestamp());
    }

    /// Cancel tournament
    pub fn cancel_tournament(env: Env, tournament_id: u64, reason: String) {
        let tournament_prefix = format!("tournament_{}", tournament_id);
        
        // Check if tournament exists
        if env.storage()
            .instance()
            .get::<Symbol, String>(&Symbol::new(&env, &format!("{}_name", tournament_prefix))).is_none() {
            panic!("Tournament not found");
        }

        // Get tournament admin
        let admin: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_admin", tournament_prefix)))
            .unwrap();

        // Verify admin authorization
        admin.require_auth();
        if admin != Self::get_admin(env.clone()) {
            panic!("Only admin can cancel tournaments");
        }

        // Check if tournament can be cancelled
        let state: u32 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_state", tournament_prefix)))
            .unwrap_or(0u32);
        
        if state == 4 { // Completed
            panic!("Cannot cancel completed tournament");
        }

        // Update tournament state to cancelled
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_state", tournament_prefix)), &5u32); // Cancelled
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_cancelled_reason", tournament_prefix)), &reason);
    }

    /// Get tournament participants
    pub fn get_participants(env: Env, tournament_id: u64) -> Vec<Address> {
        let tournament_prefix = format!("tournament_{}", tournament_id);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_participants", tournament_prefix)))
            .unwrap_or_else(|| panic!("Tournament not found"))
    }

    /// Check if participant is registered
    pub fn is_participant(env: Env, tournament_id: u64, participant: Address) -> bool {
        let participant_key = format!("participants_{}_{:?}", tournament_id, participant);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, &participant_key))
            .unwrap_or(false)
    }

    /// Get total number of tournaments created
    pub fn get_tournament_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, TOURNAMENT_COUNTER_KEY))
            .unwrap_or(0u64)
    }

    /// Get tournaments by state
    pub fn get_tournaments_by_state(env: Env, state: u32) -> Vec<u64> {
        let count = Self::get_tournament_count(env.clone());
        let mut result = Vec::new(&env);

        for i in 1..=count {
            let tournament_prefix = format!("tournament_{}", i);
            if let Some(tournament_state) = env.storage()
                .instance()
                .get::<Symbol, u32>(&Symbol::new(&env, &format!("{}_state", tournament_prefix))) {
                if tournament_state == state {
                    result.push_back(i);
                }
            }
        }

        result
    }
}

#[cfg(test)]
mod test;