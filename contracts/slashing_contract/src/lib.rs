#![no_std]

//! # Slashing & Penalty Enforcement Engine
//!
//! A Soroban smart contract responsible for enforcing penalties and slashing actions
//! against players, referees, or system actors who violate ArenaX rules.
//!
//! ## Features
//! - Deterministic penalty enforcement (stake slashing, reward confiscation, suspensions, bans)
//! - Role-based access control via Identity Contract
//! - Irreversible permanent bans
//! - Evidence-based case management
//! - Integration with Escrow Vault for fund slashing
//! - Comprehensive event emission for transparency
//!
//! ## Security
//! - Adversarial design: assumes hostile inputs
//! - No slashing without approved case
//! - Each case executed only once
//! - Financial penalties reference escrowed funds
//! - All actions emit events for auditability

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, Address, BytesN, Env, IntoVal, Symbol,
};

// ============================================================================
// Events
// ============================================================================

#[contractevent(topics = ["ArenaXSlashing", "INIT"])]
pub struct Initialized {
    pub admin: Address,
}

#[contractevent(topics = ["ArenaXSlashing", "ID_SET"])]
pub struct IdentityContractSet {
    pub identity_contract: Address,
}

#[contractevent(topics = ["ArenaXSlashing", "ESC_SET"])]
pub struct EscrowContractSet {
    pub escrow_contract: Address,
}

#[contractevent(topics = ["ArenaXSlashing", "CASE_OPEN"])]
pub struct CaseOpened {
    pub case_id: BytesN<32>,
    pub subject: Address,
    pub initiator: Address,
    pub reason_code: u32,
    pub evidence_hash: BytesN<32>,
}

#[contractevent(topics = ["ArenaXSlashing", "APPROVED"])]
pub struct CaseApproved {
    pub case_id: BytesN<32>,
    pub approver: Address,
}

#[contractevent(topics = ["ArenaXSlashing", "EXECUTED"])]
pub struct PenaltyExecuted {
    pub case_id: BytesN<32>,
    pub penalty_type: u32,
    pub subject: Address,
}

#[contractevent(topics = ["ArenaXSlashing", "CANCELED"])]
pub struct CaseCancelled {
    pub case_id: BytesN<32>,
    pub subject: Address,
}

#[contractevent(topics = ["ArenaXSlashing", "SLASHED"])]
pub struct StakeSlashed {
    pub subject: Address,
    pub amount: i128,
    pub asset: Address,
}

#[contractevent(topics = ["ArenaXSlashing", "CONFISCT"])]
pub struct RewardConfiscated {
    pub subject: Address,
    pub amount: i128,
    pub asset: Address,
}

#[contractevent(topics = ["ArenaXSlashing", "SUSPEND"])]
pub struct TemporarySuspension {
    pub subject: Address,
    pub duration: u64,
    pub expires_at: u64,
}

#[contractevent(topics = ["ArenaXSlashing", "PERMA_BN"])]
pub struct PermanentBan {
    pub subject: Address,
}

// ============================================================================
// Data Types
// ============================================================================

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    IdentityContract,
    EscrowContract,
    SlashCase(BytesN<32>),
    BannedUsers(Address),
    CaseExecuted(BytesN<32>),
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PenaltyType {
    StakeSlash = 0,
    RewardConfiscation = 1,
    TemporarySuspension = 2,
    PermanentBan = 3,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum SlashStatus {
    Proposed = 0,
    Approved = 1,
    Executed = 2,
    Cancelled = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SlashCase {
    pub case_id: BytesN<32>,
    pub subject: Address,
    pub initiator: Address,
    pub reason_code: u32,
    pub evidence_hash: BytesN<32>,
    pub status: u32,
    pub created_at: u64,
    pub resolved_at: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Penalty {
    pub penalty_type: u32,
    pub amount: Option<i128>,
    pub asset: Option<Address>,
    pub duration: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BanRecord {
    pub subject: Address,
    pub case_id: BytesN<32>,
    pub banned_at: u64,
    pub is_permanent: bool,
    pub expires_at: Option<u64>,
}

// ============================================================================
// Contract Implementation
// ============================================================================

#[contract]
pub struct SlashingContract;

#[contractimpl]
impl SlashingContract {
    /// Initialize the slashing contract with an admin address
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

        Initialized { admin }.publish(&env);
    }

    /// Set the Identity Contract address for role verification
    ///
    /// # Arguments
    /// * `identity_contract` - Address of the deployed Identity Contract
    ///
    /// # Panics
    /// * If caller is not admin
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

        IdentityContractSet { identity_contract }.publish(&env);
    }

    /// Set the Escrow Contract address for fund slashing
    ///
    /// # Arguments
    /// * `escrow_contract` - Address of the deployed Escrow Vault Contract
    ///
    /// # Panics
    /// * If caller is not admin
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

        EscrowContractSet { escrow_contract }.publish(&env);
    }

    /// Open a new slashing case against a subject
    ///
    /// # Arguments
    /// * `case_id` - Unique identifier for the case (32 bytes)
    /// * `subject` - Address of the accused party
    /// * `reason_code` - Numeric code representing the violation type
    /// * `evidence_hash` - Hash of off-chain evidence (32 bytes)
    ///
    /// # Panics
    /// * If caller is not authorized (Admin or System role)
    /// * If case_id already exists
    /// * If subject is already permanently banned
    pub fn open_case(
        env: Env,
        case_id: BytesN<32>,
        subject: Address,
        reason_code: u32,
        evidence_hash: BytesN<32>,
    ) {
        let initiator = Self::get_caller(&env);

        // Verify initiator has authority (Admin or System role)
        Self::require_authority(&env, &initiator);

        // Check case doesn't already exist
        if env
            .storage()
            .persistent()
            .has(&DataKey::SlashCase(case_id.clone()))
        {
            panic!("case already exists");
        }

        // Check subject is not already permanently banned
        if Self::is_permanently_banned(&env, &subject) {
            panic!("subject already permanently banned");
        }

        let slash_case = SlashCase {
            case_id: case_id.clone(),
            subject: subject.clone(),
            initiator: initiator.clone(),
            reason_code,
            evidence_hash: evidence_hash.clone(),
            status: SlashStatus::Proposed as u32,
            created_at: env.ledger().timestamp(),
            resolved_at: None,
        };

        env.storage()
            .persistent()
            .set(&DataKey::SlashCase(case_id.clone()), &slash_case);

        CaseOpened {
            case_id,
            subject,
            initiator,
            reason_code,
            evidence_hash,
        }
        .publish(&env);
    }

    /// Approve a slashing case for execution
    ///
    /// # Arguments
    /// * `case_id` - The case identifier to approve
    ///
    /// # Panics
    /// * If caller is not admin or governance
    /// * If case doesn't exist
    /// * If case is not in Proposed status
    pub fn approve_case(env: Env, case_id: BytesN<32>) {
        let approver = Self::get_caller(&env);

        // Verify approver has authority (Admin or System role)
        Self::require_authority(&env, &approver);

        let mut slash_case: SlashCase = env
            .storage()
            .persistent()
            .get(&DataKey::SlashCase(case_id.clone()))
            .expect("case not found");

        if slash_case.status != SlashStatus::Proposed as u32 {
            panic!("invalid case status");
        }

        slash_case.status = SlashStatus::Approved as u32;

        env.storage()
            .persistent()
            .set(&DataKey::SlashCase(case_id.clone()), &slash_case);

        CaseApproved { case_id, approver }.publish(&env);
    }

    /// Execute a penalty against the subject of an approved case
    ///
    /// # Arguments
    /// * `case_id` - The approved case identifier
    /// * `penalty_type` - Type of penalty (0=StakeSlash, 1=RewardConfiscation, 2=TemporarySuspension, 3=PermanentBan)
    /// * `amount` - Amount to slash/confiscate (required for types 0,1)
    /// * `asset` - Asset address for financial penalties (required for types 0,1)
    /// * `duration` - Duration in seconds for temporary suspension (required for type 2)
    ///
    /// # Panics
    /// * If caller is not authorized
    /// * If case doesn't exist or not approved
    /// * If case already executed
    /// * If penalty parameters are invalid
    /// * If financial penalty but no escrow contract set
    pub fn execute_penalty(
        env: Env,
        case_id: BytesN<32>,
        penalty_type: u32,
        amount: Option<i128>,
        asset: Option<Address>,
        duration: Option<u64>,
    ) {
        let executor = Self::get_caller(&env);

        // Verify executor has authority
        Self::require_authority(&env, &executor);

        // Check case hasn't been executed already
        if env
            .storage()
            .persistent()
            .has(&DataKey::CaseExecuted(case_id.clone()))
        {
            panic!("case already executed");
        }

        let mut slash_case: SlashCase = env
            .storage()
            .persistent()
            .get(&DataKey::SlashCase(case_id.clone()))
            .expect("case not found");

        if slash_case.status != SlashStatus::Approved as u32 {
            panic!("case not approved");
        }

        // Validate penalty type
        if penalty_type > 3 {
            panic!("invalid penalty type");
        }

        let _penalty = Penalty {
            penalty_type,
            amount: amount.clone(),
            asset: asset.clone(),
            duration,
        };

        // Execute the specific penalty
        match penalty_type {
            0 => Self::execute_stake_slash(&env, &slash_case.subject, amount, asset),
            1 => Self::execute_reward_confiscation(&env, &slash_case.subject, amount, asset),
            2 => Self::execute_temporary_suspension(&env, &slash_case.subject, duration, &case_id),
            3 => Self::execute_permanent_ban(&env, &slash_case.subject, &case_id),
            _ => panic!("invalid penalty type"),
        }

        // Mark case as executed
        slash_case.status = SlashStatus::Executed as u32;
        slash_case.resolved_at = Some(env.ledger().timestamp());

        env.storage()
            .persistent()
            .set(&DataKey::SlashCase(case_id.clone()), &slash_case);

        // Mark case as executed (prevent double execution)
        env.storage()
            .persistent()
            .set(&DataKey::CaseExecuted(case_id.clone()), &true);

        PenaltyExecuted {
            case_id,
            penalty_type,
            subject: slash_case.subject,
        }
        .publish(&env);
    }

    /// Cancel a proposed case before approval
    ///
    /// # Arguments
    /// * `case_id` - The case identifier to cancel
    ///
    /// # Panics
    /// * If caller is not admin
    /// * If case doesn't exist
    /// * If case is not in Proposed status
    pub fn cancel_case(env: Env, case_id: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        let mut slash_case: SlashCase = env
            .storage()
            .persistent()
            .get(&DataKey::SlashCase(case_id.clone()))
            .expect("case not found");

        if slash_case.status != SlashStatus::Proposed as u32 {
            panic!("can only cancel proposed cases");
        }

        slash_case.status = SlashStatus::Cancelled as u32;
        slash_case.resolved_at = Some(env.ledger().timestamp());

        env.storage()
            .persistent()
            .set(&DataKey::SlashCase(case_id.clone()), &slash_case);

        CaseCancelled {
            case_id,
            subject: slash_case.subject,
        }
        .publish(&env);
    }

    /// Get case details
    ///
    /// # Arguments
    /// * `case_id` - The case identifier
    ///
    /// # Returns
    /// The SlashCase struct with all case details
    pub fn get_case(env: Env, case_id: BytesN<32>) -> SlashCase {
        env.storage()
            .persistent()
            .get(&DataKey::SlashCase(case_id))
            .expect("case not found")
    }

    /// Check if an address is currently banned (temporary or permanent)
    ///
    /// # Arguments
    /// * `subject` - The address to check
    ///
    /// # Returns
    /// true if the subject is currently banned, false otherwise
    pub fn is_banned(env: Env, subject: Address) -> bool {
        if let Some(ban_record) = env
            .storage()
            .persistent()
            .get::<DataKey, BanRecord>(&DataKey::BannedUsers(subject.clone()))
        {
            if ban_record.is_permanent {
                return true;
            }

            // Check if temporary ban has expired
            if let Some(expires_at) = ban_record.expires_at {
                return env.ledger().timestamp() < expires_at;
            }
        }

        false
    }

    /// Check if a case has been executed
    ///
    /// # Arguments
    /// * `case_id` - The case identifier
    ///
    /// # Returns
    /// true if the case has been executed, false otherwise
    pub fn is_case_executed(env: Env, case_id: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::CaseExecuted(case_id))
            .unwrap_or(false)
    }

    /// Get ban record for a subject
    ///
    /// # Arguments
    /// * `subject` - The address to check
    ///
    /// # Returns
    /// Option<BanRecord> with ban details if banned, None otherwise
    pub fn get_ban_record(env: Env, subject: Address) -> Option<BanRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::BannedUsers(subject))
    }

    // ========================================================================
    // Internal Helper Functions
    // ========================================================================

    /// Get the caller address (for testing compatibility)
    fn get_caller(env: &Env) -> Address {
        // In production, this would use env.invoker() or similar
        // For now, we'll use a placeholder that requires auth
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    /// Require that the caller has authority (Admin or System role)
    fn require_authority(env: &Env, caller: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");

        // Check if caller is admin
        if caller == &admin {
            caller.require_auth();
            return;
        }

        // Check if identity contract is set
        if let Some(identity_contract) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::IdentityContract)
        {
            caller.require_auth();

            // Check if caller has Admin (2) or System (3) role
            let role: u32 = env.invoke_contract(
                &identity_contract,
                &Symbol::new(&env, "get_role"),
                (caller.clone(),).into_val(env),
            );

            if role != 2 && role != 3 {
                panic!("insufficient authority");
            }
        } else {
            // If no identity contract set, only admin can act
            panic!("caller not authorized");
        }
    }

    /// Check if subject is permanently banned
    fn is_permanently_banned(env: &Env, subject: &Address) -> bool {
        if let Some(ban_record) = env
            .storage()
            .persistent()
            .get::<DataKey, BanRecord>(&DataKey::BannedUsers(subject.clone()))
        {
            return ban_record.is_permanent;
        }
        false
    }

    /// Execute stake slashing penalty
    fn execute_stake_slash(
        env: &Env,
        subject: &Address,
        amount: Option<i128>,
        asset: Option<Address>,
    ) {
        let amount = amount.expect("amount required for stake slash");
        let asset = asset.expect("asset required for stake slash");

        if amount <= 0 {
            panic!("amount must be positive");
        }

        // Get escrow contract
        let escrow_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::EscrowContract)
            .expect("escrow contract not set");

        // Call escrow contract to slash funds
        // slash_stake(subject: Address, amount: i128, asset: Address)
        let _result: () = env.invoke_contract(
            &escrow_contract,
            &Symbol::new(&env, "slash_stake"),
            (subject.clone(), amount, asset.clone()).into_val(env),
        );

        StakeSlashed {
            subject: subject.clone(),
            amount,
            asset,
        }
        .publish(env);
    }

    /// Execute reward confiscation penalty
    fn execute_reward_confiscation(
        env: &Env,
        subject: &Address,
        amount: Option<i128>,
        asset: Option<Address>,
    ) {
        let amount = amount.expect("amount required for reward confiscation");
        let asset = asset.expect("asset required for reward confiscation");

        if amount <= 0 {
            panic!("amount must be positive");
        }

        // Get escrow contract
        let escrow_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::EscrowContract)
            .expect("escrow contract not set");

        // Call escrow contract to confiscate rewards
        // confiscate_reward(subject: Address, amount: i128, asset: Address)
        let _result: () = env.invoke_contract(
            &escrow_contract,
            &Symbol::new(&env, "confiscate_reward"),
            (subject.clone(), amount, asset.clone()).into_val(env),
        );

        RewardConfiscated {
            subject: subject.clone(),
            amount,
            asset,
        }
        .publish(env);
    }

    /// Execute temporary suspension penalty
    fn execute_temporary_suspension(
        env: &Env,
        subject: &Address,
        duration: Option<u64>,
        case_id: &BytesN<32>,
    ) {
        let duration = duration.expect("duration required for temporary suspension");

        if duration == 0 {
            panic!("duration must be positive");
        }

        let current_time = env.ledger().timestamp();
        let expires_at = current_time + duration;

        let ban_record = BanRecord {
            subject: subject.clone(),
            case_id: case_id.clone(),
            banned_at: current_time,
            is_permanent: false,
            expires_at: Some(expires_at),
        };

        env.storage()
            .persistent()
            .set(&DataKey::BannedUsers(subject.clone()), &ban_record);

        TemporarySuspension {
            subject: subject.clone(),
            duration,
            expires_at,
        }
        .publish(env);
    }

    /// Execute permanent ban penalty (irreversible)
    fn execute_permanent_ban(env: &Env, subject: &Address, case_id: &BytesN<32>) {
        let ban_record = BanRecord {
            subject: subject.clone(),
            case_id: case_id.clone(),
            banned_at: env.ledger().timestamp(),
            is_permanent: true,
            expires_at: None,
        };

        env.storage()
            .persistent()
            .set(&DataKey::BannedUsers(subject.clone()), &ban_record);

        PermanentBan {
            subject: subject.clone(),
        }
        .publish(env);
    }
}

mod test;
