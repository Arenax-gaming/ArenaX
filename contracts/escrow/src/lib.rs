use soroban_sdk::{contract, contractimpl, Address, Env, String, Vec, Symbol, token};

/// Escrow state enumeration
#[derive(Clone, Debug, PartialEq)]
pub enum EscrowState {
    Created,           // Escrow created, waiting for deposits
    Funded,           // Funds deposited, waiting for conditions
    Disputed,         // Dispute has been raised
    Released,         // Funds released to beneficiary
    Refunded,         // Funds refunded to depositor
    Cancelled,        // Escrow cancelled
    Arbitrating,      // Under arbitration
}

/// Dispute status enumeration
#[derive(Clone, Debug, PartialEq)]
pub enum DisputeStatus {
    None,             // No dispute
    Pending,          // Dispute raised, waiting for arbitration
    Resolved,         // Dispute resolved
    Rejected,         // Dispute rejected
}

/// Arbitration decision enumeration
#[derive(Clone, Debug, PartialEq)]
pub enum ArbitrationDecision {
    Pending,          // Decision pending
    FavorDepositor,   // Decision favors depositor
    FavorBeneficiary, // Decision favors beneficiary
    PartialSplit,     // Split funds between parties
    RejectDispute,    // Dispute rejected
}

/// Escrow configuration structure
#[derive(Clone, Debug)]
pub struct EscrowConfig {
    pub depositor: Address,
    pub beneficiary: Address,
    pub arbitrator: Address,
    pub amount: i128,
    pub token_address: Address,
    pub release_conditions: String,
    pub dispute_timeout: u64,
    pub auto_release_time: u64,
    pub created_at: u64,
}

/// Storage keys for the contract
const ADMIN_KEY: &str = "admin";
const ESCROW_COUNTER_KEY: &str = "escrow_counter";
const ARBITRATORS_KEY: &str = "arbitrators";

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Initialize the contract with an admin address
    pub fn initialize(env: Env, admin: Address) {
        env.storage()
            .instance()
            .set(&Symbol::new(&env, ADMIN_KEY), &admin);
        
        // Initialize escrow counter
        env.storage()
            .instance()
            .set(&Symbol::new(&env, ESCROW_COUNTER_KEY), &0u64);
            
        // Initialize arbitrators list
        env.storage()
            .instance()
            .set(&Symbol::new(&env, ARBITRATORS_KEY), &Vec::<Address>::new(&env));
    }

    /// Get the admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, ADMIN_KEY))
            .unwrap()
    }

    /// Add an arbitrator (admin only)
    pub fn add_arbitrator(env: Env, admin: Address, arbitrator: Address) {
        admin.require_auth();
        if admin != Self::get_admin(env.clone()) {
            panic!("Only admin can add arbitrators");
        }

        let mut arbitrators: Vec<Address> = env.storage()
            .instance()
            .get(&Symbol::new(&env, ARBITRATORS_KEY))
            .unwrap_or(Vec::new(&env));

        // Check if arbitrator already exists
        for arb in arbitrators.iter() {
            if arb == arbitrator {
                panic!("Arbitrator already exists");
            }
        }

        arbitrators.push_back(arbitrator.clone());
        env.storage()
            .instance()
            .set(&Symbol::new(&env, ARBITRATORS_KEY), &arbitrators);

        // TODO: Add event emission for arbitrator added
    }

    /// Remove an arbitrator (admin only)
    pub fn remove_arbitrator(env: Env, admin: Address, arbitrator: Address) {
        admin.require_auth();
        if admin != Self::get_admin(env.clone()) {
            panic!("Only admin can remove arbitrators");
        }

        let arbitrators: Vec<Address> = env.storage()
            .instance()
            .get(&Symbol::new(&env, ARBITRATORS_KEY))
            .unwrap_or(Vec::new(&env));

        let mut new_arbitrators = Vec::new(&env);
        let mut found = false;

        for arb in arbitrators.iter() {
            if arb != arbitrator {
                new_arbitrators.push_back(arb);
            } else {
                found = true;
            }
        }

        if !found {
            panic!("Arbitrator not found");
        }

        env.storage()
            .instance()
            .set(&Symbol::new(&env, ARBITRATORS_KEY), &new_arbitrators);

        // TODO: Add event emission for arbitrator removed
    }

    /// Get list of arbitrators
    pub fn get_arbitrators(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, ARBITRATORS_KEY))
            .unwrap_or(Vec::new(&env))
    }

    /// Create a new escrow
    pub fn create_escrow(
        env: Env,
        depositor: Address,
        beneficiary: Address,
        arbitrator: Address,
        amount: i128,
        token_address: Address,
        release_conditions: String,
        dispute_timeout: u64,
        auto_release_time: u64,
    ) -> u64 {
        depositor.require_auth();

        // Validate arbitrator
        let arbitrators = Self::get_arbitrators(env.clone());
        let mut valid_arbitrator = false;
        for arb in arbitrators.iter() {
            if arb == arbitrator {
                valid_arbitrator = true;
                break;
            }
        }
        if !valid_arbitrator {
            panic!("Invalid arbitrator");
        }

        // Validate amounts and times
        if amount <= 0 {
            panic!("Amount must be positive");
        }
        
        if auto_release_time <= env.ledger().timestamp() {
            panic!("Auto release time must be in the future");
        }

        if dispute_timeout == 0 {
            panic!("Dispute timeout must be greater than 0");
        }

        // Get next escrow ID
        let escrow_id = env.storage()
            .instance()
            .get(&Symbol::new(&env, ESCROW_COUNTER_KEY))
            .unwrap_or(0u64) + 1;

        // Store escrow configuration
        let escrow_prefix = format!("escrow_{}", escrow_id);
        
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_depositor", escrow_prefix)), &depositor);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_beneficiary", escrow_prefix)), &beneficiary);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_arbitrator", escrow_prefix)), &arbitrator);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_amount", escrow_prefix)), &amount);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_token", escrow_prefix)), &token_address);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_conditions", escrow_prefix)), &release_conditions);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_dispute_timeout", escrow_prefix)), &dispute_timeout);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_auto_release_time", escrow_prefix)), &auto_release_time);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_state", escrow_prefix)), &0u32); // Created
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_dispute_status", escrow_prefix)), &0u32); // None
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_arbitration_decision", escrow_prefix)), &0u32); // Pending
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_created_at", escrow_prefix)), &env.ledger().timestamp());
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_deposited_amount", escrow_prefix)), &0i128);

        // Update escrow counter
        env.storage()
            .instance()
            .set(&Symbol::new(&env, ESCROW_COUNTER_KEY), &escrow_id);

        // TODO: Add event emission for escrow created

        escrow_id
    }

    /// Deposit funds into escrow
    pub fn deposit_funds(env: Env, escrow_id: u64, depositor: Address) {
        depositor.require_auth();

        let escrow_prefix = format!("escrow_{}", escrow_id);
        
        // Check if escrow exists
        if env.storage()
            .instance()
            .get::<Symbol, Address>(&Symbol::new(&env, &format!("{}_depositor", escrow_prefix))).is_none() {
            panic!("Escrow not found");
        }

        // Verify depositor
        let escrow_depositor: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_depositor", escrow_prefix)))
            .unwrap();
        
        if depositor != escrow_depositor {
            panic!("Only the designated depositor can deposit funds");
        }

        // Check escrow state
        let state: u32 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_state", escrow_prefix)))
            .unwrap_or(0u32);

        if state != 0 { // Not in Created state
            panic!("Escrow is not in the correct state for deposits");
        }

        let amount: i128 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_amount", escrow_prefix)))
            .unwrap();

        let token_address: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_token", escrow_prefix)))
            .unwrap();

        // Transfer tokens from depositor to contract
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&depositor, &env.current_contract_address(), &amount);

        // Update escrow state and deposited amount
        let deposited_at = env.ledger().timestamp();
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_state", escrow_prefix)), &1u32); // Funded
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_deposited_amount", escrow_prefix)), &amount);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_deposited_at", escrow_prefix)), &deposited_at);

        // TODO: Add event emission for funds deposited
    }

    /// Release funds to beneficiary
    pub fn release_funds(env: Env, escrow_id: u64, releaser: Address) {
        releaser.require_auth();

        let escrow_prefix = format!("escrow_{}", escrow_id);
        
        // Check if escrow exists
        if env.storage()
            .instance()
            .get::<Symbol, Address>(&Symbol::new(&env, &format!("{}_depositor", escrow_prefix))).is_none() {
            panic!("Escrow not found");
        }

        let depositor: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_depositor", escrow_prefix)))
            .unwrap();
        let beneficiary: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_beneficiary", escrow_prefix)))
            .unwrap();
        let arbitrator: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_arbitrator", escrow_prefix)))
            .unwrap();

        // Check authorization - only depositor or arbitrator can release
        if releaser != depositor && releaser != arbitrator {
            panic!("Only depositor or arbitrator can release funds");
        }

        // Check escrow state
        let state: u32 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_state", escrow_prefix)))
            .unwrap_or(0u32);

        if state != 1 { // Not in Funded state
            panic!("Escrow is not in funded state");
        }

        // Check dispute status
        let dispute_status: u32 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_dispute_status", escrow_prefix)))
            .unwrap_or(0u32);

        if dispute_status == 1 { // Pending dispute
            panic!("Cannot release funds while dispute is pending");
        }

        let amount: i128 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_deposited_amount", escrow_prefix)))
            .unwrap();

        let token_address: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_token", escrow_prefix)))
            .unwrap();

        // Transfer tokens to beneficiary
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &beneficiary, &amount);

        // Update escrow state
        let released_at = env.ledger().timestamp();
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_state", escrow_prefix)), &3u32); // Released
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_released_at", escrow_prefix)), &released_at);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_released_by", escrow_prefix)), &releaser);

        // TODO: Add event emission for funds released
    }

    /// Refund funds to depositor
    pub fn refund_funds(env: Env, escrow_id: u64, refunder: Address) {
        refunder.require_auth();

        let escrow_prefix = format!("escrow_{}", escrow_id);
        
        // Check if escrow exists
        if env.storage()
            .instance()
            .get::<Symbol, Address>(&Symbol::new(&env, &format!("{}_depositor", escrow_prefix))).is_none() {
            panic!("Escrow not found");
        }

        let depositor: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_depositor", escrow_prefix)))
            .unwrap();
        let arbitrator: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_arbitrator", escrow_prefix)))
            .unwrap();

        // Check authorization - only depositor or arbitrator can refund
        if refunder != depositor && refunder != arbitrator {
            panic!("Only depositor or arbitrator can refund funds");
        }

        // Check escrow state
        let state: u32 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_state", escrow_prefix)))
            .unwrap_or(0u32);

        if state != 1 { // Not in Funded state
            panic!("Escrow is not in funded state");
        }

        let amount: i128 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_deposited_amount", escrow_prefix)))
            .unwrap();

        let token_address: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_token", escrow_prefix)))
            .unwrap();

        // Transfer tokens back to depositor
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &depositor, &amount);

        // Update escrow state
        let refunded_at = env.ledger().timestamp();
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_state", escrow_prefix)), &4u32); // Refunded
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_refunded_at", escrow_prefix)), &refunded_at);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_refunded_by", escrow_prefix)), &refunder);

        // TODO: Add event emission for funds refunded
    }

    /// Raise a dispute
    pub fn raise_dispute(env: Env, escrow_id: u64, disputer: Address, reason: String) {
        disputer.require_auth();

        let escrow_prefix = format!("escrow_{}", escrow_id);
        
        // Check if escrow exists
        if env.storage()
            .instance()
            .get::<Symbol, Address>(&Symbol::new(&env, &format!("{}_depositor", escrow_prefix))).is_none() {
            panic!("Escrow not found");
        }

        let depositor: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_depositor", escrow_prefix)))
            .unwrap();
        let beneficiary: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_beneficiary", escrow_prefix)))
            .unwrap();

        // Check authorization - only depositor or beneficiary can raise dispute
        if disputer != depositor && disputer != beneficiary {
            panic!("Only depositor or beneficiary can raise disputes");
        }

        // Check escrow state
        let state: u32 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_state", escrow_prefix)))
            .unwrap_or(0u32);

        if state != 1 { // Not in Funded state
            panic!("Escrow is not in funded state");
        }

        // Check if dispute already exists
        let dispute_status: u32 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_dispute_status", escrow_prefix)))
            .unwrap_or(0u32);

        if dispute_status != 0 { // Not None
            panic!("Dispute already exists");
        }

        // Update escrow state and dispute status
        let raised_at = env.ledger().timestamp();
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_state", escrow_prefix)), &2u32); // Disputed
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_dispute_status", escrow_prefix)), &1u32); // Pending
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_dispute_raised_by", escrow_prefix)), &disputer);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_dispute_reason", escrow_prefix)), &reason);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_dispute_raised_at", escrow_prefix)), &raised_at);

        // TODO: Add event emission for dispute raised
    }

    /// Resolve dispute (arbitrator only)
    pub fn resolve_dispute(
        env: Env, 
        escrow_id: u64, 
        arbitrator: Address, 
        decision: u32,
        depositor_amount: i128,
        beneficiary_amount: i128,
        reason: String
    ) {
        arbitrator.require_auth();

        let escrow_prefix = format!("escrow_{}", escrow_id);
        
        // Check if escrow exists
        if env.storage()
            .instance()
            .get::<Symbol, Address>(&Symbol::new(&env, &format!("{}_depositor", escrow_prefix))).is_none() {
            panic!("Escrow not found");
        }

        let escrow_arbitrator: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_arbitrator", escrow_prefix)))
            .unwrap();

        // Verify arbitrator
        if arbitrator != escrow_arbitrator {
            panic!("Only the designated arbitrator can resolve disputes");
        }

        // Check dispute status
        let dispute_status: u32 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_dispute_status", escrow_prefix)))
            .unwrap_or(0u32);

        if dispute_status != 1 { // Not Pending
            panic!("No pending dispute to resolve");
        }

        let depositor: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_depositor", escrow_prefix)))
            .unwrap();
        let beneficiary: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_beneficiary", escrow_prefix)))
            .unwrap();

        let total_amount: i128 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_deposited_amount", escrow_prefix)))
            .unwrap();

        let token_address: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_token", escrow_prefix)))
            .unwrap();

        let token_client = token::Client::new(&env, &token_address);

        // Execute arbitration decision
        match decision {
            1 => { // Favor depositor - full refund
                token_client.transfer(&env.current_contract_address(), &depositor, &total_amount);
                env.storage()
                    .instance()
                    .set(&Symbol::new(&env, &format!("{}_state", escrow_prefix)), &4u32); // Refunded
            },
            2 => { // Favor beneficiary - full release
                token_client.transfer(&env.current_contract_address(), &beneficiary, &total_amount);
                env.storage()
                    .instance()
                    .set(&Symbol::new(&env, &format!("{}_state", escrow_prefix)), &3u32); // Released
            },
            3 => { // Partial split
                if depositor_amount + beneficiary_amount != total_amount {
                    panic!("Split amounts must equal total amount");
                }
                if depositor_amount > 0 {
                    token_client.transfer(&env.current_contract_address(), &depositor, &depositor_amount);
                }
                if beneficiary_amount > 0 {
                    token_client.transfer(&env.current_contract_address(), &beneficiary, &beneficiary_amount);
                }
                env.storage()
                    .instance()
                    .set(&Symbol::new(&env, &format!("{}_state", escrow_prefix)), &3u32); // Released (partial)
            },
            4 => { // Reject dispute
                // Return to funded state, allow normal release/refund
                env.storage()
                    .instance()
                    .set(&Symbol::new(&env, &format!("{}_state", escrow_prefix)), &1u32); // Funded
            },
            _ => panic!("Invalid arbitration decision"),
        }

        // Update dispute resolution
        let resolved_at = env.ledger().timestamp();
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_dispute_status", escrow_prefix)), &2u32); // Resolved
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_arbitration_decision", escrow_prefix)), &decision);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_arbitration_reason", escrow_prefix)), &reason);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_arbitration_resolved_at", escrow_prefix)), &resolved_at);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_arbitration_depositor_amount", escrow_prefix)), &depositor_amount);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_arbitration_beneficiary_amount", escrow_prefix)), &beneficiary_amount);

        // TODO: Add event emission for dispute resolved
    }

    /// Auto-release funds when conditions are met
    pub fn check_auto_release(env: Env, escrow_id: u64) {
        let escrow_prefix = format!("escrow_{}", escrow_id);
        
        // Check if escrow exists
        if env.storage()
            .instance()
            .get::<Symbol, Address>(&Symbol::new(&env, &format!("{}_depositor", escrow_prefix))).is_none() {
            panic!("Escrow not found");
        }

        // Check escrow state
        let state: u32 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_state", escrow_prefix)))
            .unwrap_or(0u32);

        if state != 1 { // Not in Funded state
            panic!("Escrow is not in funded state");
        }

        let auto_release_time: u64 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_auto_release_time", escrow_prefix)))
            .unwrap();

        // Check if auto-release time has passed
        if env.ledger().timestamp() >= auto_release_time {
            let beneficiary: Address = env.storage()
                .instance()
                .get(&Symbol::new(&env, &format!("{}_beneficiary", escrow_prefix)))
                .unwrap();

            let amount: i128 = env.storage()
                .instance()
                .get(&Symbol::new(&env, &format!("{}_deposited_amount", escrow_prefix)))
                .unwrap();

            let token_address: Address = env.storage()
                .instance()
                .get(&Symbol::new(&env, &format!("{}_token", escrow_prefix)))
                .unwrap();

            // Transfer tokens to beneficiary
            let token_client = token::Client::new(&env, &token_address);
            token_client.transfer(&env.current_contract_address(), &beneficiary, &amount);

            // Update escrow state
            let released_at = env.ledger().timestamp();
            env.storage()
                .instance()
                .set(&Symbol::new(&env, &format!("{}_state", escrow_prefix)), &3u32); // Released
            env.storage()
                .instance()
                .set(&Symbol::new(&env, &format!("{}_released_at", escrow_prefix)), &released_at);
            env.storage()
                .instance()
                .set(&Symbol::new(&env, &format!("{}_released_by", escrow_prefix)), &env.current_contract_address());

            // TODO: Add event emission for auto released
        } else {
            panic!("Auto-release time has not been reached");
        }
    }

    /// Emergency recovery function (admin only)
    pub fn emergency_recovery(env: Env, escrow_id: u64, admin: Address, recovery_address: Address) {
        admin.require_auth();
        if admin != Self::get_admin(env.clone()) {
            panic!("Only admin can perform emergency recovery");
        }

        let escrow_prefix = format!("escrow_{}", escrow_id);
        
        // Check if escrow exists
        if env.storage()
            .instance()
            .get::<Symbol, Address>(&Symbol::new(&env, &format!("{}_depositor", escrow_prefix))).is_none() {
            panic!("Escrow not found");
        }

        let amount: i128 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_deposited_amount", escrow_prefix)))
            .unwrap();

        let token_address: Address = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_token", escrow_prefix)))
            .unwrap();

        // Transfer tokens to recovery address
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &recovery_address, &amount);

        // Update escrow state
        let recovered_at = env.ledger().timestamp();
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_state", escrow_prefix)), &5u32); // Cancelled
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_emergency_recovery_at", escrow_prefix)), &recovered_at);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, &format!("{}_recovery_address", escrow_prefix)), &recovery_address);

        // TODO: Add event emission for emergency recovery
    }

    /// Get escrow details
    pub fn get_escrow_depositor(env: Env, escrow_id: u64) -> Address {
        let escrow_prefix = format!("escrow_{}", escrow_id);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_depositor", escrow_prefix)))
            .unwrap_or_else(|| panic!("Escrow not found"))
    }

    pub fn get_escrow_beneficiary(env: Env, escrow_id: u64) -> Address {
        let escrow_prefix = format!("escrow_{}", escrow_id);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_beneficiary", escrow_prefix)))
            .unwrap_or_else(|| panic!("Escrow not found"))
    }

    pub fn get_escrow_arbitrator(env: Env, escrow_id: u64) -> Address {
        let escrow_prefix = format!("escrow_{}", escrow_id);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_arbitrator", escrow_prefix)))
            .unwrap_or_else(|| panic!("Escrow not found"))
    }

    pub fn get_escrow_amount(env: Env, escrow_id: u64) -> i128 {
        let escrow_prefix = format!("escrow_{}", escrow_id);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_amount", escrow_prefix)))
            .unwrap_or_else(|| panic!("Escrow not found"))
    }

    pub fn get_escrow_deposited_amount(env: Env, escrow_id: u64) -> i128 {
        let escrow_prefix = format!("escrow_{}", escrow_id);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_deposited_amount", escrow_prefix)))
            .unwrap_or(0i128)
    }

    pub fn get_escrow_state(env: Env, escrow_id: u64) -> u32 {
        let escrow_prefix = format!("escrow_{}", escrow_id);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_state", escrow_prefix)))
            .unwrap_or_else(|| panic!("Escrow not found"))
    }

    pub fn get_escrow_dispute_status(env: Env, escrow_id: u64) -> u32 {
        let escrow_prefix = format!("escrow_{}", escrow_id);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_dispute_status", escrow_prefix)))
            .unwrap_or(0u32)
    }

    pub fn get_escrow_token_address(env: Env, escrow_id: u64) -> Address {
        let escrow_prefix = format!("escrow_{}", escrow_id);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_token", escrow_prefix)))
            .unwrap_or_else(|| panic!("Escrow not found"))
    }

    pub fn get_escrow_conditions(env: Env, escrow_id: u64) -> String {
        let escrow_prefix = format!("escrow_{}", escrow_id);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_conditions", escrow_prefix)))
            .unwrap_or_else(|| panic!("Escrow not found"))
    }

    pub fn get_escrow_auto_release_time(env: Env, escrow_id: u64) -> u64 {
        let escrow_prefix = format!("escrow_{}", escrow_id);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_auto_release_time", escrow_prefix)))
            .unwrap_or_else(|| panic!("Escrow not found"))
    }

    /// Get total number of escrows created
    pub fn get_escrow_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, ESCROW_COUNTER_KEY))
            .unwrap_or(0u64)
    }

    /// Get escrows by state
    pub fn get_escrows_by_state(env: Env, state: u32) -> Vec<u64> {
        let count = Self::get_escrow_count(env.clone());
        let mut result = Vec::new(&env);

        for i in 1..=count {
            let escrow_prefix = format!("escrow_{}", i);
            if let Some(escrow_state) = env.storage()
                .instance()
                .get::<Symbol, u32>(&Symbol::new(&env, &format!("{}_state", escrow_prefix))) {
                if escrow_state == state {
                    result.push_back(i);
                }
            }
        }

        result
    }

    /// Check if escrow is eligible for auto-release
    pub fn is_eligible_for_auto_release(env: Env, escrow_id: u64) -> bool {
        let escrow_prefix = format!("escrow_{}", escrow_id);
        
        // Check if escrow exists
        if env.storage()
            .instance()
            .get::<Symbol, Address>(&Symbol::new(&env, &format!("{}_depositor", escrow_prefix))).is_none() {
            return false;
        }

        // Check escrow state
        let state: u32 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_state", escrow_prefix)))
            .unwrap_or(0u32);

        if state != 1 { // Not in Funded state
            return false;
        }

        let auto_release_time: u64 = env.storage()
            .instance()
            .get(&Symbol::new(&env, &format!("{}_auto_release_time", escrow_prefix)))
            .unwrap();

        env.ledger().timestamp() >= auto_release_time
    }
}

#[cfg(test)]
mod test;
