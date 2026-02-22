#![no_std]

//! # Match Escrow Vault
//!
//! A secure Soroban smart contract for holding player stakes during matches.
//! Funds are released only after match completion or dispute resolution.
//!
//! ## Features
//! - Deposit stakes before match start
//! - Lock funds during active matches
//! - Release to winner after match completion
//! - Refund both players on match cancellation
//! - Dispute resolution with authorized resolvers
//! - Re-entrancy protection via state machine
//! - Integration with Match Contract for state verification
//! - Integration with Identity Contract for role verification
//!
//! ## Security
//! - Adversarial design: assumes hostile inputs
//! - State machine prevents invalid transitions
//! - Re-entrancy guard on all fund movements
//! - Only authorized contracts can trigger releases
//! - All actions emit events for auditability

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, token, Address, BytesN, Env, IntoVal,
    Symbol,
};

#[contractevent(topics = ["ArenaXEscrow", "INIT"])]
pub struct Initialized {
    pub admin: Address,
}

#[contractevent(topics = ["ArenaXEscrow", "MATCH_SET"])]
pub struct MatchContractSet {
    pub match_contract: Address,
}

#[contractevent(topics = ["ArenaXEscrow", "ID_SET"])]
pub struct IdentityContractSet {
    pub identity_contract: Address,
}

#[contractevent(topics = ["ArenaXEscrow", "TREASURY"])]
pub struct TreasurySet {
    pub treasury: Address,
}

#[contractevent(topics = ["ArenaXEscrow", "DEPOSIT"])]
pub struct Deposited {
    pub match_id: BytesN<32>,
    pub player: Address,
    pub amount: i128,
    pub asset: Address,
}

#[contractevent(topics = ["ArenaXEscrow", "LOCKED"])]
pub struct MatchLocked {
    pub match_id: BytesN<32>,
}

#[contractevent(topics = ["ArenaXEscrow", "RELEASED"])]
pub struct FundsReleased {
    pub match_id: BytesN<32>,
    pub winner: Address,
    pub amount: i128,
    pub asset: Address,
}

#[contractevent(topics = ["ArenaXEscrow", "REFUNDED"])]
pub struct FundsRefunded {
    pub match_id: BytesN<32>,
    pub player_a: Address,
    pub player_b: Address,
    pub amount: i128,
    pub asset: Address,
}

#[contractevent(topics = ["ArenaXEscrow", "SLASHED"])]
pub struct StakeSlashed {
    pub match_id: BytesN<32>,
    pub subject: Address,
    pub amount: i128,
    pub asset: Address,
}

#[contractevent(topics = ["ArenaXEscrow", "EMERGENCY"])]
pub struct EmergencyWithdraw {
    pub match_id: BytesN<32>,
    pub admin: Address,
    pub amount: i128,
    pub asset: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    MatchContract,
    IdentityContract,
    Treasury,
    Escrow(BytesN<32>),
    ReentrancyGuard(BytesN<32>),
    Paused,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum EscrowState {
    AwaitingDeposits = 0,
    PlayerADeposited = 1,
    PlayerBDeposited = 2,
    FullyFunded = 3,
    Locked = 4,
    Released = 5,
    Refunded = 6,
    Disputed = 7,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowData {
    pub match_id: BytesN<32>,
    pub player_a: Address,
    pub player_b: Address,
    pub amount: i128,
    pub asset: Address,
    pub state: u32,
    pub player_a_deposited: bool,
    pub player_b_deposited: bool,
    pub created_at: u64,
    pub locked_at: Option<u64>,
    pub released_at: Option<u64>,
}

#[contract]
pub struct MatchEscrowVault;

#[contractimpl]
impl MatchEscrowVault {
    /// Initialize the escrow vault with an admin address
    ///
    /// # Arguments
    /// * `admin` - The admin address with full control over the contract
    ///
    /// # Panics
    /// * If contract is already initialized
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);

        Initialized { admin }.publish(&env);
    }

    /// Set the Match Contract address for state verification
    ///
    /// # Arguments
    /// * `match_contract` - Address of the deployed Match Contract
    ///
    /// # Panics
    /// * If caller is not admin
    pub fn set_match_contract(env: Env, match_contract: Address) {
        Self::require_admin(&env);

        env.storage()
            .instance()
            .set(&DataKey::MatchContract, &match_contract);

        MatchContractSet { match_contract }.publish(&env);
    }

    /// Set the Identity Contract address for role verification
    ///
    /// # Arguments
    /// * `identity_contract` - Address of the deployed Identity Contract
    ///
    /// # Panics
    /// * If caller is not admin
    pub fn set_identity_contract(env: Env, identity_contract: Address) {
        Self::require_admin(&env);

        env.storage()
            .instance()
            .set(&DataKey::IdentityContract, &identity_contract);

        IdentityContractSet { identity_contract }.publish(&env);
    }

    /// Set the treasury address for slashed funds
    ///
    /// # Arguments
    /// * `treasury` - Address where slashed funds are sent
    ///
    /// # Panics
    /// * If caller is not admin
    pub fn set_treasury(env: Env, treasury: Address) {
        Self::require_admin(&env);

        env.storage()
            .instance()
            .set(&DataKey::Treasury, &treasury);

        TreasurySet { treasury }.publish(&env);
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
        env.storage().instance().set(&DataKey::Paused, &paused);
    }

    /// Create a new escrow for a match
    ///
    /// # Arguments
    /// * `match_id` - Unique identifier for the match (32 bytes)
    /// * `player_a` - Address of player A
    /// * `player_b` - Address of player B
    /// * `amount` - Stake amount required from each player
    /// * `asset` - Token address for the stake
    ///
    /// # Panics
    /// * If contract is paused
    /// * If escrow already exists for this match
    /// * If amount is not positive
    /// * If players are the same address
    pub fn create_escrow(
        env: Env,
        match_id: BytesN<32>,
        player_a: Address,
        player_b: Address,
        amount: i128,
        asset: Address,
    ) {
        Self::require_not_paused(&env);

        if env
            .storage()
            .persistent()
            .has(&DataKey::Escrow(match_id.clone()))
        {
            panic!("escrow already exists");
        }

        if amount <= 0 {
            panic!("amount must be positive");
        }

        if player_a == player_b {
            panic!("players must be different");
        }

        let escrow = EscrowData {
            match_id: match_id.clone(),
            player_a,
            player_b,
            amount,
            asset,
            state: EscrowState::AwaitingDeposits as u32,
            player_a_deposited: false,
            player_b_deposited: false,
            created_at: env.ledger().timestamp(),
            locked_at: None,
            released_at: None,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Escrow(match_id), &escrow);
    }

    /// Deposit stake for a match
    ///
    /// # Arguments
    /// * `match_id` - The match identifier
    /// * `player` - The depositing player's address
    ///
    /// # Panics
    /// * If contract is paused
    /// * If escrow doesn't exist
    /// * If player is not part of the match
    /// * If player has already deposited
    /// * If escrow is not in a valid state for deposits
    /// * If re-entrancy is detected
    pub fn deposit(env: Env, match_id: BytesN<32>, player: Address) {
        Self::require_not_paused(&env);
        Self::acquire_reentrancy_guard(&env, &match_id);

        player.require_auth();

        let mut escrow: EscrowData = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(match_id.clone()))
            .expect("escrow not found");

        let is_player_a = player == escrow.player_a;
        let is_player_b = player == escrow.player_b;

        if !is_player_a && !is_player_b {
            Self::release_reentrancy_guard(&env, &match_id);
            panic!("player not in match");
        }

        if is_player_a && escrow.player_a_deposited {
            Self::release_reentrancy_guard(&env, &match_id);
            panic!("player A already deposited");
        }
        if is_player_b && escrow.player_b_deposited {
            Self::release_reentrancy_guard(&env, &match_id);
            panic!("player B already deposited");
        }

        let valid_states = [
            EscrowState::AwaitingDeposits as u32,
            EscrowState::PlayerADeposited as u32,
            EscrowState::PlayerBDeposited as u32,
        ];
        if !valid_states.contains(&escrow.state) {
            Self::release_reentrancy_guard(&env, &match_id);
            panic!("invalid escrow state for deposit");
        }

        let contract_address = env.current_contract_address();
        let token_client = token::Client::new(&env, &escrow.asset);
        token_client.transfer(&player, &contract_address, &escrow.amount);

        if is_player_a {
            escrow.player_a_deposited = true;
            if escrow.player_b_deposited {
                escrow.state = EscrowState::FullyFunded as u32;
            } else {
                escrow.state = EscrowState::PlayerADeposited as u32;
            }
        } else {
            escrow.player_b_deposited = true;
            if escrow.player_a_deposited {
                escrow.state = EscrowState::FullyFunded as u32;
            } else {
                escrow.state = EscrowState::PlayerBDeposited as u32;
            }
        }

        env.storage()
            .persistent()
            .set(&DataKey::Escrow(match_id.clone()), &escrow);

        Self::release_reentrancy_guard(&env, &match_id);

        Deposited {
            match_id,
            player,
            amount: escrow.amount,
            asset: escrow.asset,
        }
        .publish(&env);
    }

    /// Lock funds when match starts
    /// Can only be called by the match contract or admin
    ///
    /// # Arguments
    /// * `match_id` - The match identifier
    ///
    /// # Panics
    /// * If contract is paused
    /// * If escrow doesn't exist
    /// * If escrow is not fully funded
    /// * If caller is not authorized
    pub fn lock_funds(env: Env, match_id: BytesN<32>) {
        Self::require_not_paused(&env);
        Self::require_match_contract_or_admin(&env);
        Self::acquire_reentrancy_guard(&env, &match_id);

        let mut escrow: EscrowData = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(match_id.clone()))
            .expect("escrow not found");

        if escrow.state != EscrowState::FullyFunded as u32 {
            Self::release_reentrancy_guard(&env, &match_id);
            panic!("escrow not fully funded");
        }

        escrow.state = EscrowState::Locked as u32;
        escrow.locked_at = Some(env.ledger().timestamp());

        env.storage()
            .persistent()
            .set(&DataKey::Escrow(match_id.clone()), &escrow);

        Self::release_reentrancy_guard(&env, &match_id);

        MatchLocked { match_id }.publish(&env);
    }

    /// Release funds to the winner after match completion
    /// Can only be called by the match contract or admin
    ///
    /// # Arguments
    /// * `match_id` - The match identifier
    /// * `winner` - The winning player's address
    ///
    /// # Panics
    /// * If contract is paused
    /// * If escrow doesn't exist
    /// * If escrow is not locked
    /// * If winner is not a player in the match
    /// * If caller is not authorized
    /// * If re-entrancy is detected
    pub fn release_to_winner(env: Env, match_id: BytesN<32>, winner: Address) {
        Self::require_not_paused(&env);
        Self::require_match_contract_or_admin(&env);
        Self::acquire_reentrancy_guard(&env, &match_id);

        let mut escrow: EscrowData = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(match_id.clone()))
            .expect("escrow not found");

        if escrow.state != EscrowState::Locked as u32 {
            Self::release_reentrancy_guard(&env, &match_id);
            panic!("escrow not locked");
        }

        if winner != escrow.player_a && winner != escrow.player_b {
            Self::release_reentrancy_guard(&env, &match_id);
            panic!("winner not in match");
        }

        // Calculate total amount (both players' stakes)
        let total_amount = escrow.amount * 2;

        // Transfer to winner
        let contract_address = env.current_contract_address();
        let token_client = token::Client::new(&env, &escrow.asset);
        token_client.transfer(&contract_address, &winner, &total_amount);

        // Update escrow state
        escrow.state = EscrowState::Released as u32;
        escrow.released_at = Some(env.ledger().timestamp());

        env.storage()
            .persistent()
            .set(&DataKey::Escrow(match_id.clone()), &escrow);

        Self::release_reentrancy_guard(&env, &match_id);

        FundsReleased {
            match_id,
            winner,
            amount: total_amount,
            asset: escrow.asset,
        }
        .publish(&env);
    }

    /// Refund both players when match is cancelled
    /// Can only be called by the match contract or admin
    ///
    /// # Arguments
    /// * `match_id` - The match identifier
    ///
    /// # Panics
    /// * If contract is paused
    /// * If escrow doesn't exist
    /// * If escrow is already released or refunded
    /// * If caller is not authorized
    /// * If re-entrancy is detected
    pub fn refund(env: Env, match_id: BytesN<32>) {
        Self::require_not_paused(&env);
        Self::require_match_contract_or_admin(&env);
        Self::acquire_reentrancy_guard(&env, &match_id);

        let mut escrow: EscrowData = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(match_id.clone()))
            .expect("escrow not found");

        if escrow.state == EscrowState::Released as u32
            || escrow.state == EscrowState::Refunded as u32
        {
            Self::release_reentrancy_guard(&env, &match_id);
            panic!("escrow already finalized");
        }

        let contract_address = env.current_contract_address();
        let token_client = token::Client::new(&env, &escrow.asset);

        if escrow.player_a_deposited {
            token_client.transfer(&contract_address, &escrow.player_a, &escrow.amount);
        }

        if escrow.player_b_deposited {
            token_client.transfer(&contract_address, &escrow.player_b, &escrow.amount);
        }

        escrow.state = EscrowState::Refunded as u32;
        escrow.released_at = Some(env.ledger().timestamp());

        env.storage()
            .persistent()
            .set(&DataKey::Escrow(match_id.clone()), &escrow);

        Self::release_reentrancy_guard(&env, &match_id);

        FundsRefunded {
            match_id,
            player_a: escrow.player_a,
            player_b: escrow.player_b,
            amount: escrow.amount,
            asset: escrow.asset,
        }
        .publish(&env);
    }

    /// Mark escrow as disputed
    /// Can only be called by the match contract or admin
    ///
    /// # Arguments
    /// * `match_id` - The match identifier
    ///
    /// # Panics
    /// * If escrow doesn't exist
    /// * If escrow is not locked
    /// * If caller is not authorized
    pub fn mark_disputed(env: Env, match_id: BytesN<32>) {
        Self::require_match_contract_or_admin(&env);

        let mut escrow: EscrowData = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(match_id.clone()))
            .expect("escrow not found");

        if escrow.state != EscrowState::Locked as u32 {
            panic!("escrow not locked");
        }

        escrow.state = EscrowState::Disputed as u32;

        env.storage()
            .persistent()
            .set(&DataKey::Escrow(match_id), &escrow);
    }

    /// Resolve a disputed match and release funds to winner
    /// Can only be called by authorized resolvers (Referee or Admin)
    ///
    /// # Arguments
    /// * `match_id` - The match identifier
    /// * `winner` - The winning player's address
    /// * `resolver` - The resolver's address (must be Referee or Admin)
    ///
    /// # Panics
    /// * If contract is paused
    /// * If escrow doesn't exist
    /// * If escrow is not disputed
    /// * If winner is not a player in the match
    /// * If resolver is not authorized
    /// * If re-entrancy is detected
    pub fn resolve_dispute(env: Env, match_id: BytesN<32>, winner: Address, resolver: Address) {
        Self::require_not_paused(&env);
        resolver.require_auth();
        Self::require_resolver_role(&env, &resolver);
        Self::acquire_reentrancy_guard(&env, &match_id);

        let mut escrow: EscrowData = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(match_id.clone()))
            .expect("escrow not found");

        if escrow.state != EscrowState::Disputed as u32 {
            Self::release_reentrancy_guard(&env, &match_id);
            panic!("escrow not disputed");
        }

        if winner != escrow.player_a && winner != escrow.player_b {
            Self::release_reentrancy_guard(&env, &match_id);
            panic!("winner not in match");
        }

        // Calculate total amount (both players' stakes)
        let total_amount = escrow.amount * 2;

        // Transfer to winner
        let contract_address = env.current_contract_address();
        let token_client = token::Client::new(&env, &escrow.asset);
        token_client.transfer(&contract_address, &winner, &total_amount);

        // Update escrow state
        escrow.state = EscrowState::Released as u32;
        escrow.released_at = Some(env.ledger().timestamp());

        env.storage()
            .persistent()
            .set(&DataKey::Escrow(match_id.clone()), &escrow);

        Self::release_reentrancy_guard(&env, &match_id);

        FundsReleased {
            match_id,
            winner,
            amount: total_amount,
            asset: escrow.asset,
        }
        .publish(&env);
    }

    /// Slash a player's stake (called by Slashing Contract)
    ///
    /// # Arguments
    /// * `subject` - The player to slash
    /// * `amount` - Amount to slash
    /// * `asset` - Asset address
    ///
    /// # Panics
    /// * If caller is not admin or slashing contract
    /// * If amount is not positive
    pub fn slash_stake(env: Env, subject: Address, amount: i128, asset: Address) {
        Self::require_admin(&env);

        if amount <= 0 {
            panic!("amount must be positive");
        }

        let treasury: Address = env
            .storage()
            .instance()
            .get(&DataKey::Treasury)
            .expect("treasury not set");

        let contract_address = env.current_contract_address();
        let token_client = token::Client::new(&env, &asset);

        let balance = token_client.balance(&contract_address);
        if balance < amount {
            panic!("insufficient balance for slash");
        }

        token_client.transfer(&contract_address, &treasury, &amount);

        StakeSlashed {
            match_id: BytesN::from_array(&env, &[0u8; 32]), // Generic slash, no specific match
            subject,
            amount,
            asset,
        }
        .publish(&env);
    }

    /// Confiscate rewards (called by Slashing Contract)
    pub fn confiscate_reward(env: Env, subject: Address, amount: i128, asset: Address) {
        Self::slash_stake(env, subject, amount, asset);
    }

    /// Emergency withdraw for a specific match (admin only)
    /// Use only in case of critical bugs or exploits
    ///
    /// # Arguments
    /// * `match_id` - The match identifier
    /// * `recipient` - Where to send the funds
    ///
    /// # Panics
    /// * If caller is not admin
    /// * If escrow doesn't exist
    pub fn emergency_withdraw(env: Env, match_id: BytesN<32>, recipient: Address) {
        Self::require_admin(&env);
        Self::acquire_reentrancy_guard(&env, &match_id);

        let escrow: EscrowData = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(match_id.clone()))
            .expect("escrow not found");

        let contract_address = env.current_contract_address();
        let token_client = token::Client::new(&env, &escrow.asset);

        let mut total = 0i128;
        if escrow.player_a_deposited {
            total += escrow.amount;
        }
        if escrow.player_b_deposited {
            total += escrow.amount;
        }

        if total > 0 {
            token_client.transfer(&contract_address, &recipient, &total);
        }

        Self::release_reentrancy_guard(&env, &match_id);

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");

        EmergencyWithdraw {
            match_id,
            admin,
            amount: total,
            asset: escrow.asset,
        }
        .publish(&env);
    }

    /// Get escrow data for a match
    pub fn get_escrow(env: Env, match_id: BytesN<32>) -> EscrowData {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(match_id))
            .expect("escrow not found")
    }

    /// Check if escrow exists for a match
    pub fn escrow_exists(env: Env, match_id: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Escrow(match_id))
    }

    /// Get escrow state for a match
    pub fn get_escrow_state(env: Env, match_id: BytesN<32>) -> u32 {
        let escrow: EscrowData = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(match_id))
            .expect("escrow not found");
        escrow.state
    }

    /// Check if contract is paused
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
    }

    fn require_not_paused(env: &Env) {
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            panic!("contract is paused");
        }
    }

    fn require_match_contract_or_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");

        admin.require_auth();
    }

    fn require_resolver_role(env: &Env, resolver: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");

        if resolver == &admin {
            return;
        }

        if let Some(identity_contract) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::IdentityContract)
        {
            let role: u32 = env.invoke_contract(
                &identity_contract,
                &Symbol::new(env, "get_role"),
                (resolver.clone(),).into_val(env),
            );

            if role != 1 && role != 2 {
                panic!("resolver not authorized");
            }
        } else {
            panic!("identity contract not set");
        }
    }

    fn acquire_reentrancy_guard(env: &Env, match_id: &BytesN<32>) {
        let key = DataKey::ReentrancyGuard(match_id.clone());
        if env.storage().temporary().has(&key) {
            panic!("reentrancy detected");
        }
        env.storage().temporary().set(&key, &true);
    }

    fn release_reentrancy_guard(env: &Env, match_id: &BytesN<32>) {
        let key = DataKey::ReentrancyGuard(match_id.clone());
        env.storage().temporary().remove(&key);
    }
}

mod test;
