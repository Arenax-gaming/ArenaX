#![no_std]

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, token, Address, BytesN, Env, Map, Symbol,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    AxToken,
    TournamentContract,
    DisputeContract,
    Stake(BytesN<32>, Address), // tournament_id, user_address
    TournamentInfo(BytesN<32>),
    UserStakeInfo(Address),
    Paused,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TournamentState {
    NotStarted = 0,
    Active = 1,
    Completed = 2,
    Cancelled = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakeInfo {
    pub user: Address,
    pub tournament_id: BytesN<32>,
    pub amount: i128,
    pub staked_at: u64,
    pub is_locked: bool,
    pub can_withdraw: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TournamentInfo {
    pub tournament_id: BytesN<32>,
    pub state: u32,
    pub stake_requirement: i128,
    pub total_staked: i128,
    pub participant_count: u32,
    pub created_at: u64,
    pub completed_at: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserStakeInfo {
    pub user: Address,
    pub total_staked: i128,
    pub total_slashed: i128,
    pub active_tournaments: u32,
    pub completed_tournaments: u32,
}

#[contractevent]
pub struct Initialized {
    pub admin: Address,
    pub ax_token: Address,
}

#[contractevent]
pub struct TokenSet {
    pub token: Address,
}

#[contractevent]
pub struct TournamentContractSet {
    pub contract: Address,
}

#[contractevent]
pub struct DisputeContractSet {
    pub contract: Address,
}

#[contractevent]
pub struct Staked {
    pub user: Address,
    pub tournament_id: BytesN<32>,
    pub amount: i128,
}

#[contractevent]
pub struct Withdrawn {
    pub user: Address,
    pub tournament_id: BytesN<32>,
    pub amount: i128,
}

#[contractevent]
pub struct Slashed {
    pub user: Address,
    pub tournament_id: BytesN<32>,
    pub amount: i128,
    pub slashed_by: Address,
}

#[contractevent]
pub struct TournamentCreated {
    pub tournament_id: BytesN<32>,
    pub stake_requirement: i128,
}

#[contractevent]
pub struct TournamentUpdated {
    pub tournament_id: BytesN<32>,
    pub state: u32,
}

#[contractevent]
pub struct ContractPaused {
    pub paused: bool,
    pub paused_by: Address,
}

#[contract]
pub struct StakingManager;

#[contractimpl]
impl StakingManager {
    /// Initialize the staking manager with admin and AX token address
    ///
    /// # Arguments
    /// * `admin` - The admin address
    /// * `ax_token` - The AX token contract address
    ///
    /// # Panics
    /// * If contract is already initialized
    pub fn initialize(env: Env, admin: Address, ax_token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::AxToken, &ax_token);
        env.storage().instance().set(&DataKey::Paused, &false);

        Initialized { admin, ax_token }.publish(&env);
    }

    /// Set the AX token address
    ///
    /// # Arguments
    /// * `ax_token` - The AX token contract address
    ///
    /// # Panics
    /// * If caller is not admin
    pub fn set_ax_token(env: Env, ax_token: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::AxToken, &ax_token);

        TokenSet { token: ax_token }.publish(&env);
    }

    /// Set the tournament contract address
    ///
    /// # Arguments
    /// * `tournament_contract` - The tournament contract address
    ///
    /// # Panics
    /// * If caller is not admin
    pub fn set_tournament_contract(env: Env, tournament_contract: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::TournamentContract, &tournament_contract);

        TournamentContractSet {
            contract: tournament_contract,
        }
        .publish(&env);
    }

    /// Set the dispute contract address
    ///
    /// # Arguments
    /// * `dispute_contract` - The dispute contract address
    ///
    /// # Panics
    /// * If caller is not admin
    pub fn set_dispute_contract(env: Env, dispute_contract: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::DisputeContract, &dispute_contract);

        DisputeContractSet {
            contract: dispute_contract,
        }
        .publish(&env);
    }

    /// Create a new tournament
    ///
    /// # Arguments
    /// * `tournament_id` - Unique tournament identifier
    /// * `stake_requirement` - Required stake amount for participation
    ///
    /// # Panics
    /// * If contract is paused
    /// * If caller is not admin or tournament contract
    /// * If tournament already exists
    /// * If stake requirement is not positive
    pub fn create_tournament(env: Env, tournament_id: BytesN<32>, stake_requirement: i128) {
        Self::require_not_paused(&env);
        Self::require_admin_or_tournament_contract(&env);

        if stake_requirement <= 0 {
            panic!("stake requirement must be positive");
        }

        if env
            .storage()
            .persistent()
            .has(&DataKey::TournamentInfo(tournament_id.clone()))
        {
            panic!("tournament already exists");
        }

        let tournament_info = TournamentInfo {
            tournament_id: tournament_id.clone(),
            state: TournamentState::NotStarted as u32,
            stake_requirement,
            total_staked: 0,
            participant_count: 0,
            created_at: env.ledger().timestamp(),
            completed_at: None,
        };

        env.storage()
            .persistent()
            .set(&DataKey::TournamentInfo(tournament_id.clone()), &tournament_info);

        TournamentCreated {
            tournament_id,
            stake_requirement,
        }
        .publish(&env);
    }

    /// Update tournament state
    ///
    /// # Arguments
    /// * `tournament_id` - Tournament identifier
    /// * `state` - New tournament state
    ///
    /// # Panics
    /// * If contract is paused
    /// * If caller is not admin or tournament contract
    /// * If tournament doesn't exist
    pub fn update_tournament_state(env: Env, tournament_id: BytesN<32>, state: u32) {
        Self::require_not_paused(&env);
        Self::require_admin_or_tournament_contract(&env);

        let mut tournament_info: TournamentInfo = env
            .storage()
            .persistent()
            .get(&DataKey::TournamentInfo(tournament_id.clone()))
            .expect("tournament not found");

        let old_state = tournament_info.state;
        tournament_info.state = state;

        if state == TournamentState::Completed as u32 || state == TournamentState::Cancelled as u32 {
            tournament_info.completed_at = Some(env.ledger().timestamp());
            
            // Unlock all stakes for this tournament
            Self::unlock_tournament_stakes(&env, &tournament_id);
        }

        env.storage()
            .persistent()
            .set(&DataKey::TournamentInfo(tournament_id.clone()), &tournament_info);

        TournamentUpdated {
            tournament_id,
            state,
        }
        .publish(&env);
    }

    /// Stake AX tokens for tournament participation
    ///
    /// # Arguments
    /// * `user` - The user staking tokens
    /// * `tournament_id` - Tournament identifier
    /// * `amount` - Amount to stake
    ///
    /// # Panics
    /// * If contract is paused
    /// * If tournament doesn't exist or is not active
    /// * If amount doesn't meet stake requirement
    /// * If user has already staked for this tournament
    pub fn stake(env: Env, user: Address, tournament_id: BytesN<32>, amount: i128) {
        Self::require_not_paused(&env);
        user.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        let tournament_info: TournamentInfo = env
            .storage()
            .persistent()
            .get(&DataKey::TournamentInfo(tournament_id.clone()))
            .expect("tournament not found");

        if tournament_info.state != TournamentState::Active as u32 {
            panic!("tournament is not active");
        }

        if amount < tournament_info.stake_requirement {
            panic!("amount below stake requirement");
        }

        let stake_key = DataKey::Stake(tournament_id.clone(), user.clone());
        if env.storage().persistent().has(&stake_key) {
            panic!("user already staked for this tournament");
        }

        // Transfer AX tokens to contract
        let ax_token = Self::get_ax_token(&env);
        let contract_address = env.current_contract_address();
        let token_client = token::Client::new(&env, &ax_token);
        token_client.transfer(&user, &contract_address, &amount);

        // Create stake record
        let stake_info = StakeInfo {
            user: user.clone(),
            tournament_id: tournament_id.clone(),
            amount,
            staked_at: env.ledger().timestamp(),
            is_locked: true,
            can_withdraw: false,
        };

        env.storage()
            .persistent()
            .set(&stake_key, &stake_info);

        // Update tournament info
        let mut updated_tournament_info = tournament_info;
        updated_tournament_info.total_staked += amount;
        updated_tournament_info.participant_count += 1;
        env.storage()
            .persistent()
            .set(&DataKey::TournamentInfo(tournament_id.clone()), &updated_tournament_info);

        // Update user stake info
        Self::update_user_stake_info(&env, &user, amount, 0, 1, 0);

        Staked {
            user,
            tournament_id,
            amount,
        }
        .publish(&env);
    }

    /// Withdraw staked tokens after tournament completion
    ///
    /// # Arguments
    /// * `user` - The user withdrawing tokens
    /// * `tournament_id` - Tournament identifier
    ///
    /// # Panics
    /// * If contract is paused
    /// * If user has no stake for this tournament
    /// * If stake is still locked
    pub fn withdraw(env: Env, user: Address, tournament_id: BytesN<32>) {
        Self::require_not_paused(&env);
        user.require_auth();

        let stake_key = DataKey::Stake(tournament_id.clone(), user.clone());
        let mut stake_info: StakeInfo = env
            .storage()
            .persistent()
            .get(&stake_key)
            .expect("no stake found");

        if !stake_info.can_withdraw {
            panic!("stake is not withdrawable");
        }

        // Transfer tokens back to user
        let ax_token = Self::get_ax_token(&env);
        let contract_address = env.current_contract_address();
        let token_client = token::Client::new(&env, &ax_token);
        token_client.transfer(&contract_address, &user, &stake_info.amount);

        // Remove stake record
        env.storage().persistent().remove(&stake_key);

        // Update user stake info
        Self::update_user_stake_info(&env, &user, -stake_info.amount, 0, -1, 1);

        Withdrawn {
            user,
            tournament_id,
            amount: stake_info.amount,
        }
        .publish(&env);
    }

    /// Slash user's stake based on dispute resolution
    ///
    /// # Arguments
    /// * `user` - The user being slashed
    /// * `tournament_id` - Tournament identifier
    /// * `amount` - Amount to slash
    /// * `slashed_by` - Address authorizing the slash
    ///
    /// # Panics
    /// * If contract is paused
    /// * If caller is not authorized (dispute contract or admin)
    /// * If user has no stake for this tournament
    /// * If amount exceeds staked amount
    pub fn slash(env: Env, user: Address, tournament_id: BytesN<32>, amount: i128, slashed_by: Address) {
        Self::require_not_paused(&env);
        Self::require_dispute_contract_or_admin(&env, &slashed_by);

        if amount <= 0 {
            panic!("amount must be positive");
        }

        let stake_key = DataKey::Stake(tournament_id.clone(), user.clone());
        let mut stake_info: StakeInfo = env
            .storage()
            .persistent()
            .get(&stake_key)
            .expect("no stake found");

        if amount > stake_info.amount {
            panic!("slash amount exceeds staked amount");
        }

        // Transfer slashed amount to treasury (or burn)
        let ax_token = Self::get_ax_token(&env);
        let contract_address = env.current_contract_address();
        let token_client = token::Client::new(&env, &ax_token);
        
        // For now, we'll burn the slashed tokens by sending to a dead address
        // In production, this might go to a treasury address
        let dead_address = Address::from_contract_id(&BytesN::from_array(&env, &[0u8; 32]));
        token_client.transfer(&contract_address, &dead_address, &amount);

        // Update stake info
        stake_info.amount -= amount;
        if stake_info.amount == 0 {
            // Remove stake record if fully slashed
            env.storage().persistent().remove(&stake_key);
        } else {
            env.storage()
                .persistent()
                .set(&stake_key, &stake_info);
        }

        // Update tournament info
        let mut tournament_info: TournamentInfo = env
            .storage()
            .persistent()
            .get(&DataKey::TournamentInfo(tournament_id.clone()))
            .expect("tournament not found");
        tournament_info.total_staked -= amount;
        if stake_info.amount == 0 {
            tournament_info.participant_count -= 1;
        }
        env.storage()
            .persistent()
            .set(&DataKey::TournamentInfo(tournament_id.clone()), &tournament_info);

        // Update user stake info
        Self::update_user_stake_info(&env, &user, 0, amount, 0, 0);

        Slashed {
            user,
            tournament_id,
            amount,
            slashed_by,
        }
        .publish(&env);
    }

    /// Get user's stake information for a tournament
    ///
    /// # Arguments
    /// * `user` - User address
    /// * `tournament_id` - Tournament identifier
    ///
    /// # Returns
    /// Stake information or panics if not found
    pub fn get_stake(env: Env, user: Address, tournament_id: BytesN<32>) -> StakeInfo {
        env.storage()
            .persistent()
            .get(&DataKey::Stake(tournament_id, user))
            .expect("stake not found")
    }

    /// Get tournament information
    ///
    /// # Arguments
    /// * `tournament_id` - Tournament identifier
    ///
    /// # Returns
    /// Tournament information or panics if not found
    pub fn get_tournament_info(env: Env, tournament_id: BytesN<32>) -> TournamentInfo {
        env.storage()
            .persistent()
            .get(&DataKey::TournamentInfo(tournament_id))
            .expect("tournament not found")
    }

    /// Get user's overall stake information
    ///
    /// # Arguments
    /// * `user` - User address
    ///
    /// # Returns
    /// User's stake information
    pub fn get_user_stake_info(env: Env, user: Address) -> UserStakeInfo {
        env.storage()
            .instance()
            .get(&DataKey::UserStakeInfo(user))
            .unwrap_or(UserStakeInfo {
                user,
                total_staked: 0,
                total_slashed: 0,
                active_tournaments: 0,
                completed_tournaments: 0,
            })
    }

    /// Check if user can withdraw stake from tournament
    ///
    /// # Arguments
    /// * `user` - User address
    /// * `tournament_id` - Tournament identifier
    ///
    /// # Returns
    /// True if withdrawal is allowed
    pub fn can_withdraw(env: Env, user: Address, tournament_id: BytesN<32>) -> bool {
        if let Some(stake_info) = env
            .storage()
            .persistent()
            .get::<DataKey, StakeInfo>(&DataKey::Stake(tournament_id, user))
        {
            stake_info.can_withdraw
        } else {
            false
        }
    }

    /// Get total staked amount for a tournament
    ///
    /// # Arguments
    /// * `tournament_id` - Tournament identifier
    ///
    /// # Returns
    /// Total staked amount
    pub fn get_total_staked(env: Env, tournament_id: BytesN<32>) -> i128 {
        let tournament_info: TournamentInfo = env
            .storage()
            .persistent()
            .get(&DataKey::TournamentInfo(tournament_id))
            .expect("tournament not found");
        tournament_info.total_staked
    }

    /// Pause/unpause the contract
    ///
    /// # Arguments
    /// * `paused` - Whether to pause the contract
    ///
    /// # Panics
    /// * If caller is not admin
    pub fn set_paused(env: Env, paused: bool) {
        Self::require_admin(&env);
        let admin = env.current_contract_address();
        
        env.storage().instance().set(&DataKey::Paused, &paused);

        ContractPaused {
            paused,
            paused_by: admin,
        }
        .publish(&env);
    }

    /// Get the admin address
    ///
    /// # Returns
    /// The admin address
    ///
    /// # Panics
    /// * If contract is not initialized
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    /// Get the AX token address
    ///
    /// # Returns
    /// The AX token address
    ///
    /// # Panics
    /// * If token is not set
    pub fn get_ax_token(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::AxToken)
            .expect("AX token not set")
    }

    /// Check if the contract is paused
    ///
    /// # Returns
    /// True if the contract is paused, false otherwise
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    // Helper functions for internal use

    fn unlock_tournament_stakes(env: &Env, tournament_id: &BytesN<32>) {
        // This would need to iterate through all stakes for the tournament
        // For now, this is a placeholder - in a real implementation,
        // you'd need a way to efficiently find all stakes for a tournament
    }

    fn update_user_stake_info(
        env: &Env,
        user: &Address,
        staked_amount: i128,
        slashed_amount: i128,
        active_delta: i32,
        completed_delta: i32,
    ) {
        let mut user_info: UserStakeInfo = env
            .storage()
            .instance()
            .get(&DataKey::UserStakeInfo(user.clone()))
            .unwrap_or(UserStakeInfo {
                user: user.clone(),
                total_staked: 0,
                total_slashed: 0,
                active_tournaments: 0,
                completed_tournaments: 0,
            });

        user_info.total_staked += staked_amount;
        user_info.total_slashed += slashed_amount;
        user_info.active_tournaments = (user_info.active_tournaments as i32 + active_delta) as u32;
        user_info.completed_tournaments =
            (user_info.completed_tournaments as i32 + completed_delta) as u32;

        env.storage()
            .instance()
            .set(&DataKey::UserStakeInfo(user.clone()), &user_info);
    }

    fn require_admin(env: &Env) {
        let admin = Self::get_admin(env.clone());
        admin.require_auth();
    }

    fn require_not_paused(env: &Env) {
        let paused = Self::is_paused(env.clone());
        if paused {
            panic!("contract is paused");
        }
    }

    fn require_admin_or_tournament_contract(env: &Env) {
        let admin = Self::get_admin(env.clone());
        
        if let Some(tournament_contract) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::TournamentContract)
        {
            // Check if caller is admin or tournament contract
            // This is simplified - in practice, you'd check the actual caller
            admin.require_auth();
        } else {
            admin.require_auth();
        }
    }

    fn require_dispute_contract_or_admin(env: &Env, caller: &Address) {
        let admin = Self::get_admin(env.clone());
        
        if caller == &admin {
            return;
        }

        if let Some(dispute_contract) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::DisputeContract)
        {
            if caller == &dispute_contract {
                return;
            }
        }

        panic!("caller not authorized");
    }
}
