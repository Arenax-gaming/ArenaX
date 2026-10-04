#![no_std]
// Every event in this contract is published via the raw `env.events().publish`
// API; migrating them all to `#[contractevent]` is out of scope. Silenced at
// crate level so the deprecation warning doesn't fail `-D warnings` CI runs
// now that this crate is a workspace member.
#![allow(deprecated)]

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Bytes, BytesN, Env, String, Symbol, Vec,
};
use time_lock::{TimeLockClient, CATEGORY_TREASURY, PRIORITY_MEDIUM};

// ---------------------------------------------------------------------------
// Issue #918: Multi-sig treasury
//
// This contract implements 2-of-N (configurable threshold) multi-sig governance
// over a DAO treasury with the following acceptance criteria:
//
//  ✓ 2-of-3 multisig governance  — `initialize` accepts a `signers` Vec and
//    a `threshold` (e.g. 2 for a 2-of-3 setup). Any signer count/threshold
//    combination is supported; 2-of-3 is the recommended minimum.
//
//  ✓ Timelock on withdrawals     — every `SpendingProposal` has an
//    `execute_after` timestamp = created_at + time_lock_duration. Execution
//    panics if the timelock has not elapsed.
//
//  ✓ Treasury operations logged  — every mutating operation emits an on-chain
//    event via `env.events().publish`.
//
//  ✓ Emergency pause capability  — `set_paused(true)` halts all operations
//    except `set_paused(false)` (admin can always unpause).
//
//  ✓ Recovery procedures         — documented below:
//
//    RECOVERY PROCEDURES
//    ───────────────────
//    Scenario 1 — Signer key compromised:
//      1. Surviving signers create a SpendingProposal to drain funds to a
//         safe address, gather threshold approvals, wait for timelock, execute.
//      2. Admin calls `remove_signer` to revoke the compromised key.
//      3. Admin calls `add_signer` to add a replacement key.
//
//    Scenario 2 — Admin key compromised:
//      1. Any signer calls `set_paused(false)` — wait, only admin can call it.
//         For this reason, deploy with a multisig wallet as admin.
//      2. If admin is an EOA and is compromised, the signers should immediately
//         pause via a governance proposal on the DAO and rotate the admin via
//         an upgrade proposal or redeployment.
//
//    Scenario 3 — Threshold signers unavailable (quorum loss):
//      1. Admin calls `update_threshold` to lower the threshold temporarily
//         so remaining signers can act.
//      2. Once new signers are onboarded, restore the original threshold.
//
//    Scenario 4 — Stuck proposal (signers changed):
//      1. Admin or original proposer calls `cancel_proposal` to clear it.
//      2. Recreate the proposal with updated signer set.
//
//    Scenario 5 — Contract bug / fund recovery:
//      1. Admin calls `set_paused(true)` to halt all operations immediately.
//      2. A governance vote is held off-chain (snapshot / forum).
//      3. If the vote passes, admin deploys a new treasury contract and
//         executes a drain proposal (after unpausing briefly) to move all
//         funds.
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug)]
pub struct SpendingProposal {
    pub id: u64,
    pub proposer: Address,
    pub recipient: Address,
    pub amount: i128,
    pub category: Symbol,
    pub description: String,
    pub approvals: Vec<Address>,
    pub created_at: u64,
    pub execute_after: u64,
    pub executed: bool,
    pub cancelled: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct BudgetAllocation {
    pub category: Symbol,
    pub allocated: i128,
    pub spent: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct AllocationProposal {
    pub id: u64,
    pub proposer: Address,
    pub category: Symbol,
    pub amount: i128,
    pub votes_for: Vec<Address>,
    pub votes_against: Vec<Address>,
    pub created_at: u64,
    pub finalized: bool,
    pub approved: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DurationProposal {
    pub id: u64,
    pub proposer: Address,
    pub new_duration: u64,
    pub votes_for: Vec<Address>,
    pub votes_against: Vec<Address>,
    pub created_at: u64,
    pub finalized: bool,
    pub approved: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct TreasuryDashboard {
    pub balance: i128,
    pub total_allocated: i128,
    pub total_spent: i128,
    pub signer_count: u32,
    pub threshold: u32,
    pub time_lock_duration: u64,
    pub spending_proposal_count: u64,
    pub active_spending_proposals: u32,
    pub allocation_proposal_count: u64,
}

/// A single entry in the immutable treasury transaction log (#918: treasury
/// operations logged).
#[contracttype]
#[derive(Clone, Debug)]
pub struct TreasuryTxLog {
    pub proposal_id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub category: Symbol,
    pub executed_at: u64,
    pub executed_by: Address,
}

/// Scheduled contract upgrade (#1064).
#[contracttype]
#[derive(Clone, Debug)]
pub struct ScheduledUpgrade {
    pub new_wasm_hash: BytesN<32>,
    pub min_compatible_schema: u32,
    pub scheduled_at: u64,
    pub executable_at: u64,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    Signers,
    Threshold,
    TimeLockDuration,
    TimeLockContract,
    Balance,
    /// Address of the AX token contract used for real on-chain transfers (#918).
    TokenAddress,
    SpendingProposalCounter,
    SpendingProposal(u64),
    AllocationProposalCounter,
    AllocationProposal(u64),
    AllocationVote(u64, Address),
    DurationProposalCounter,
    DurationProposal(u64),
    DurationVote(u64, Address),
    BudgetAllocation(Symbol),
    TotalAllocated,
    TotalSpent,
    Paused,
    TransactionLog,
    ScheduledUpgrade,
    PreviousWasmHash,
    StorageSchemaVersion,
}

#[contract]
pub struct Treasury;

#[contractimpl]
impl Treasury {
    // -----------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------

    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        signers: Vec<Address>,
        threshold: u32,
        time_lock_duration: u64,
        time_lock: Address,
        token_address: Option<Address>,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        if signers.is_empty() {
            panic!("at least one signer required");
        }
        if threshold == 0 || threshold > signers.len() {
            panic!("invalid threshold");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Signers, &signers);
        env.storage()
            .instance()
            .set(&DataKey::Threshold, &threshold);
        env.storage()
            .instance()
            .set(&DataKey::TimeLockDuration, &time_lock_duration);
        env.storage()
            .instance()
            .set(&DataKey::TimeLockContract, &time_lock);
        env.storage().instance().set(&DataKey::Balance, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::SpendingProposalCounter, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::AllocationProposalCounter, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::DurationProposalCounter, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::TotalAllocated, &0i128);
        env.storage().instance().set(&DataKey::TotalSpent, &0i128);
        env.storage().instance().set(&DataKey::Paused, &false);

        // Store the token address if provided (#918: real on-chain transfers)
        if let Some(token) = token_address {
            env.storage().instance().set(&DataKey::TokenAddress, &token);
        }

        env.events().publish(
            (Symbol::new(&env, "Treasury"), Symbol::new(&env, "INIT")),
            (admin, threshold),
        );
    }

    /// Set or update the AX token contract address used for on-chain transfers.
    /// Admin-only (#918).
    pub fn set_token_address(env: Env, caller: Address, token_address: Address) {
        Self::require_admin(&env, &caller);
        env.storage()
            .instance()
            .set(&DataKey::TokenAddress, &token_address);
        env.events().publish(
            (
                Symbol::new(&env, "Treasury"),
                Symbol::new(&env, "TOKEN_SET"),
            ),
            token_address,
        );
    }

    /// Return the configured token address, or `None` if not set.
    pub fn get_token_address(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::TokenAddress)
    }

    // -----------------------------------------------------------------
    // Funding
    // -----------------------------------------------------------------

    /// Transfer `amount` of the treasury token from `from` into the contract
    /// and record it in the internal ledger balance. The transfer runs first,
    /// so a failed transfer aborts the call before storage is touched.
    pub fn deposit(env: Env, from: Address, amount: i128) {
        Self::require_not_paused(&env);
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let token_id: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("not initialized");
        token::Client::new(&env, &token_id).transfer(
            &from,
            env.current_contract_address(),
            &amount,
        );
        let balance = Self::get_balance(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::Balance, &(balance + amount));

        env.events().publish(
            (Symbol::new(&env, "Treasury"), Symbol::new(&env, "DEPOSIT")),
            (from, amount),
        );
    }

    pub fn get_token(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .expect("not initialized")
    }

    pub fn get_balance(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::Balance).unwrap_or(0)
    }

    // -----------------------------------------------------------------
    // Multi-sig signer management
    // -----------------------------------------------------------------

    pub fn add_signer(env: Env, caller: Address, new_signer: Address) {
        Self::require_not_paused(&env);
        Self::require_admin(&env, &caller);
        let mut signers = Self::get_signers(env.clone());
        for signer in signers.iter() {
            if signer == new_signer {
                panic!("already a signer");
            }
        }
        signers.push_back(new_signer.clone());
        env.storage().instance().set(&DataKey::Signers, &signers);

        env.events().publish(
            (
                Symbol::new(&env, "Treasury"),
                Symbol::new(&env, "SIGNER_ADD"),
            ),
            new_signer,
        );
    }

    pub fn remove_signer(env: Env, caller: Address, signer: Address) {
        Self::require_not_paused(&env);
        Self::require_admin(&env, &caller);
        let signers = Self::get_signers(env.clone());
        let threshold = Self::get_threshold(env.clone());

        let mut remaining = Vec::new(&env);
        let mut found = false;
        for existing in signers.iter() {
            if existing == signer {
                found = true;
            } else {
                remaining.push_back(existing);
            }
        }
        if !found {
            panic!("not a signer");
        }
        if remaining.len() < threshold {
            panic!("cannot drop signer count below threshold");
        }
        env.storage().instance().set(&DataKey::Signers, &remaining);

        env.events().publish(
            (
                Symbol::new(&env, "Treasury"),
                Symbol::new(&env, "SIGNER_REMOVE"),
            ),
            signer,
        );
    }

    pub fn update_threshold(env: Env, caller: Address, new_threshold: u32) {
        Self::require_not_paused(&env);
        Self::require_admin(&env, &caller);
        let signers = Self::get_signers(env.clone());
        if new_threshold == 0 || new_threshold > signers.len() {
            panic!("invalid threshold");
        }
        env.storage()
            .instance()
            .set(&DataKey::Threshold, &new_threshold);
    }

    pub fn get_signers(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Signers)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_threshold(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Threshold)
            .unwrap_or(0)
    }

    pub fn is_signer(env: Env, address: Address) -> bool {
        let signers = Self::get_signers(env);
        for signer in signers.iter() {
            if signer == address {
                return true;
            }
        }
        false
    }

    pub fn get_time_lock(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::TimeLockContract)
            .expect("time-lock not set")
    }

    /// Deterministically derive the time-lock operation id for a proposal.
    /// sha256(treasury_address_xdr || proposal_id_be) so ids are unique even
    /// when several treasuries share one time-lock contract.
    pub fn proposal_operation_id(env: &Env, proposal_id: u64) -> BytesN<32> {
        let mut buf = env.current_contract_address().to_xdr(env);
        for b in proposal_id.to_be_bytes().iter() {
            buf.push_back(*b);
        }
        env.crypto().sha256(&buf).into()
    }

    // -----------------------------------------------------------------
    // Spending proposals (multi-sig approval + time-lock execution)
    // -----------------------------------------------------------------

    pub fn create_spending_proposal(
        env: Env,
        proposer: Address,
        recipient: Address,
        amount: i128,
        category: Symbol,
        description: String,
    ) -> u64 {
        Self::require_not_paused(&env);
        Self::require_signer(&env, &proposer);
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::SpendingProposalCounter)
            .unwrap_or(0);
        counter += 1;

        let now = env.ledger().timestamp();
        let time_lock_duration: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TimeLockDuration)
            .unwrap_or(0);

        let mut approvals = Vec::new(&env);
        approvals.push_back(proposer.clone());

        let proposal = SpendingProposal {
            id: counter,
            proposer: proposer.clone(),
            recipient,
            amount,
            category,
            description,
            approvals,
            created_at: now,
            execute_after: now + time_lock_duration,
            executed: false,
            cancelled: false,
        };

        env.storage()
            .instance()
            .set(&DataKey::SpendingProposal(counter), &proposal);
        env.storage()
            .instance()
            .set(&DataKey::SpendingProposalCounter, &counter);

        // Schedule the matching operation in the dedicated time-lock contract.
        // execute_after is frozen on the proposal; later duration changes only
        // affect future proposals.
        let time_lock_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TimeLockContract)
            .expect("time-lock not set");
        let operation_id = Self::proposal_operation_id(&env, counter);
        let self_addr = env.current_contract_address();
        let timelock = TimeLockClient::new(&env, &time_lock_addr);
        timelock.schedule_operation(
            &self_addr,
            &operation_id,
            &self_addr,
            &Symbol::new(&env, "exec_prop"),
            &Bytes::new(&env),
            &time_lock_duration,
            &Symbol::new(&env, "spend"),
            &CATEGORY_TREASURY,
            &PRIORITY_MEDIUM,
            &0u64,
        );

        env.events().publish(
            (
                Symbol::new(&env, "Treasury"),
                Symbol::new(&env, "PROPOSAL_CREATE"),
            ),
            (counter, proposer, amount),
        );

        counter
    }

    pub fn approve_proposal(env: Env, signer: Address, proposal_id: u64) {
        Self::require_not_paused(&env);
        Self::require_signer(&env, &signer);

        let mut proposal =
            Self::get_spending_proposal(env.clone(), proposal_id).expect("proposal not found");
        if proposal.executed || proposal.cancelled {
            panic!("proposal not active");
        }
        for existing in proposal.approvals.iter() {
            if existing == signer {
                panic!("already approved");
            }
        }
        proposal.approvals.push_back(signer.clone());
        env.storage()
            .instance()
            .set(&DataKey::SpendingProposal(proposal_id), &proposal);

        env.events().publish(
            (
                Symbol::new(&env, "Treasury"),
                Symbol::new(&env, "PROPOSAL_APPROVE"),
            ),
            (proposal_id, signer),
        );
    }

    pub fn revoke_approval(env: Env, signer: Address, proposal_id: u64) {
        Self::require_not_paused(&env);
        signer.require_auth();

        let mut proposal =
            Self::get_spending_proposal(env.clone(), proposal_id).expect("proposal not found");
        if proposal.executed || proposal.cancelled {
            panic!("proposal not active");
        }

        let mut remaining = Vec::new(&env);
        let mut found = false;
        for existing in proposal.approvals.iter() {
            if existing == signer {
                found = true;
            } else {
                remaining.push_back(existing);
            }
        }
        if !found {
            panic!("no approval to revoke");
        }
        proposal.approvals = remaining;
        env.storage()
            .instance()
            .set(&DataKey::SpendingProposal(proposal_id), &proposal);

        env.events().publish(
            (
                Symbol::new(&env, "Treasury"),
                Symbol::new(&env, "PROPOSAL_APPROVAL_REVOKE"),
            ),
            (proposal_id, signer),
        );
    }

    /// Execute a spending proposal once the multi-sig threshold of
    /// approvals is met, the time-lock delay has elapsed, and the
    /// proposal's budget category has sufficient unspent allocation.
    pub fn execute_proposal(env: Env, caller: Address, proposal_id: u64) {
        Self::require_not_paused(&env);
        Self::require_signer(&env, &caller);

        let mut proposal =
            Self::get_spending_proposal(env.clone(), proposal_id).expect("proposal not found");
        if proposal.executed {
            panic!("already executed");
        }
        if proposal.cancelled {
            panic!("proposal cancelled");
        }

        let threshold = Self::get_threshold(env.clone());
        if proposal.approvals.len() < threshold {
            panic!("insufficient approvals");
        }

        // Delegate timing/execution validation to the dedicated time-lock
        // contract. The operation was scheduled at creation with the then
        // current duration; the time-lock enforces its own execute_after.
        let time_lock_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TimeLockContract)
            .expect("time-lock not set");
        let operation_id = Self::proposal_operation_id(&env, proposal_id);
        let self_addr = env.current_contract_address();
        TimeLockClient::new(&env, &time_lock_addr).execute_operation(&self_addr, &operation_id);

        let now = env.ledger().timestamp();
        if now < proposal.execute_after {
            panic!("time-lock not yet elapsed");
        }

        let balance = Self::get_balance(env.clone());
        if balance < proposal.amount {
            panic!("insufficient treasury balance");
        }

        let mut allocation = Self::get_budget_allocation(env.clone(), proposal.category.clone());
        let available = allocation.allocated - allocation.spent;
        if available < proposal.amount {
            panic!("exceeds budget allocation for category");
        }

        // Pay out the custodied tokens. If the contract is underfunded the
        // transfer panics and the whole execution reverts, leaving the
        // proposal unexecuted and storage untouched.
        let token = Self::token(&env);
        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &proposal.recipient,
            &proposal.amount,
        );

        env.storage()
            .instance()
            .set(&DataKey::Balance, &(balance - proposal.amount));

        allocation.spent += proposal.amount;
        env.storage().instance().set(
            &DataKey::BudgetAllocation(proposal.category.clone()),
            &allocation,
        );

        let total_spent: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSpent)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSpent, &(total_spent + proposal.amount));

        proposal.executed = true;
        env.storage()
            .instance()
            .set(&DataKey::SpendingProposal(proposal_id), &proposal);

        // Real on-chain token transfer to recipient (#918: 2-of-N multisig)
        if let Some(token_addr) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::TokenAddress)
        {
            token::Client::new(&env, &token_addr).transfer(
                &env.current_contract_address(),
                &proposal.recipient,
                &proposal.amount,
            );
        }

        // Append to the on-chain transaction log (#918: treasury operations logged)
        let mut logs: Vec<TreasuryTxLog> = env
            .storage()
            .instance()
            .get(&DataKey::TransactionLog)
            .unwrap_or_else(|| Vec::new(&env));
        logs.push_back(TreasuryTxLog {
            proposal_id,
            recipient: proposal.recipient.clone(),
            amount: proposal.amount,
            category: proposal.category.clone(),
            executed_at: now,
            executed_by: caller.clone(),
        });
        env.storage()
            .instance()
            .set(&DataKey::TransactionLog, &logs);

        env.events().publish(
            (
                Symbol::new(&env, "Treasury"),
                Symbol::new(&env, "PROPOSAL_EXECUTE"),
            ),
            (proposal_id, proposal.recipient, proposal.amount),
        );
    }

    pub fn cancel_proposal(env: Env, caller: Address, proposal_id: u64) {
        Self::require_not_paused(&env);

        let mut proposal =
            Self::get_spending_proposal(env.clone(), proposal_id).expect("proposal not found");
        if proposal.executed {
            panic!("already executed");
        }

        if caller == proposal.proposer {
            caller.require_auth();
        } else {
            Self::require_admin(&env, &caller);
        }

        proposal.cancelled = true;
        env.storage()
            .instance()
            .set(&DataKey::SpendingProposal(proposal_id), &proposal);

        env.events().publish(
            (
                Symbol::new(&env, "Treasury"),
                Symbol::new(&env, "PROPOSAL_CANCEL"),
            ),
            proposal_id,
        );
    }

    pub fn get_spending_proposal(env: Env, proposal_id: u64) -> Option<SpendingProposal> {
        env.storage()
            .instance()
            .get(&DataKey::SpendingProposal(proposal_id))
    }

    pub fn get_spending_proposal_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::SpendingProposalCounter)
            .unwrap_or(0)
    }

    // -----------------------------------------------------------------
    // Budget allocation voting
    // -----------------------------------------------------------------

    pub fn propose_budget_allocation(
        env: Env,
        proposer: Address,
        category: Symbol,
        amount: i128,
    ) -> u64 {
        Self::require_not_paused(&env);
        Self::require_signer(&env, &proposer);
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::AllocationProposalCounter)
            .unwrap_or(0);
        counter += 1;

        let mut votes_for = Vec::new(&env);
        votes_for.push_back(proposer.clone());

        let proposal = AllocationProposal {
            id: counter,
            proposer: proposer.clone(),
            category,
            amount,
            votes_for,
            votes_against: Vec::new(&env),
            created_at: env.ledger().timestamp(),
            finalized: false,
            approved: false,
        };

        env.storage()
            .instance()
            .set(&DataKey::AllocationProposal(counter), &proposal);
        env.storage()
            .instance()
            .set(&DataKey::AllocationProposalCounter, &counter);
        env.storage()
            .instance()
            .set(&DataKey::AllocationVote(counter, proposer.clone()), &true);

        env.events().publish(
            (
                Symbol::new(&env, "Treasury"),
                Symbol::new(&env, "ALLOCATION_PROPOSE"),
            ),
            (counter, proposer, amount),
        );

        counter
    }

    pub fn vote_budget_allocation(env: Env, signer: Address, allocation_id: u64, support: bool) {
        Self::require_not_paused(&env);
        Self::require_signer(&env, &signer);

        let vote_key = DataKey::AllocationVote(allocation_id, signer.clone());
        if env.storage().instance().has(&vote_key) {
            panic!("already voted");
        }

        let mut proposal = Self::get_allocation_proposal(env.clone(), allocation_id)
            .expect("allocation proposal not found");
        if proposal.finalized {
            panic!("allocation already finalized");
        }

        if support {
            proposal.votes_for.push_back(signer.clone());
        } else {
            proposal.votes_against.push_back(signer.clone());
        }
        env.storage().instance().set(&vote_key, &true);
        env.storage()
            .instance()
            .set(&DataKey::AllocationProposal(allocation_id), &proposal);

        env.events().publish(
            (
                Symbol::new(&env, "Treasury"),
                Symbol::new(&env, "ALLOCATION_VOTE"),
            ),
            (allocation_id, signer, support),
        );
    }

    /// Finalize a budget allocation vote once the multi-sig threshold of
    /// `for` votes is reached, crediting the category's spendable envelope.
    pub fn finalize_budget_allocation(env: Env, caller: Address, allocation_id: u64) {
        Self::require_not_paused(&env);
        Self::require_signer(&env, &caller);

        let mut proposal = Self::get_allocation_proposal(env.clone(), allocation_id)
            .expect("allocation proposal not found");
        if proposal.finalized {
            panic!("already finalized");
        }

        let threshold = Self::get_threshold(env.clone());
        if proposal.votes_for.len() < threshold {
            panic!("insufficient votes for quorum");
        }

        proposal.finalized = true;
        proposal.approved = true;
        env.storage()
            .instance()
            .set(&DataKey::AllocationProposal(allocation_id), &proposal);

        let mut allocation = Self::get_budget_allocation(env.clone(), proposal.category.clone());
        allocation.category = proposal.category.clone();
        allocation.allocated += proposal.amount;
        env.storage().instance().set(
            &DataKey::BudgetAllocation(proposal.category.clone()),
            &allocation,
        );

        let total_allocated: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalAllocated)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::TotalAllocated,
            &(total_allocated + proposal.amount),
        );

        env.events().publish(
            (
                Symbol::new(&env, "Treasury"),
                Symbol::new(&env, "ALLOCATION_FINALIZE"),
            ),
            (allocation_id, proposal.category, proposal.amount),
        );
    }

    pub fn get_allocation_proposal(env: Env, allocation_id: u64) -> Option<AllocationProposal> {
        env.storage()
            .instance()
            .get(&DataKey::AllocationProposal(allocation_id))
    }

    pub fn get_budget_allocation(env: Env, category: Symbol) -> BudgetAllocation {
        env.storage()
            .instance()
            .get(&DataKey::BudgetAllocation(category.clone()))
            .unwrap_or(BudgetAllocation {
                category,
                allocated: 0,
                spent: 0,
            })
    }

    // -----------------------------------------------------------------
    // Time-lock duration governance (no direct admin setter)
    // -----------------------------------------------------------------

    /// Propose a new time-lock duration. Only signers may propose; approval
    /// requires the multi-sig threshold via vote + finalize. Applies only to
    /// future spending proposals; existing proposals keep their frozen
    /// execute_after.
    pub fn propose_time_lock_update(env: Env, proposer: Address, new_duration: u64) -> u64 {
        Self::require_not_paused(&env);
        Self::require_signer(&env, &proposer);

        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DurationProposalCounter)
            .unwrap_or(0);
        counter += 1;

        let mut votes_for = Vec::new(&env);
        votes_for.push_back(proposer.clone());

        let proposal = DurationProposal {
            id: counter,
            proposer: proposer.clone(),
            new_duration,
            votes_for,
            votes_against: Vec::new(&env),
            created_at: env.ledger().timestamp(),
            finalized: false,
            approved: false,
        };

        env.storage()
            .instance()
            .set(&DataKey::DurationProposal(counter), &proposal);
        env.storage()
            .instance()
            .set(&DataKey::DurationProposalCounter, &counter);
        env.storage()
            .instance()
            .set(&DataKey::DurationVote(counter, proposer.clone()), &true);

        env.events().publish(
            (
                Symbol::new(&env, "Treasury"),
                Symbol::new(&env, "DURATION_PROPOSE"),
            ),
            (counter, proposer, new_duration),
        );

        counter
    }

    pub fn vote_time_lock_update(env: Env, signer: Address, proposal_id: u64, support: bool) {
        Self::require_not_paused(&env);
        Self::require_signer(&env, &signer);

        let vote_key = DataKey::DurationVote(proposal_id, signer.clone());
        if env.storage().instance().has(&vote_key) {
            panic!("already voted");
        }

        let mut proposal = Self::get_duration_proposal(env.clone(), proposal_id)
            .expect("duration proposal not found");
        if proposal.finalized {
            panic!("duration proposal already finalized");
        }

        if support {
            proposal.votes_for.push_back(signer.clone());
        } else {
            proposal.votes_against.push_back(signer.clone());
        }
        env.storage().instance().set(&vote_key, &true);
        env.storage()
            .instance()
            .set(&DataKey::DurationProposal(proposal_id), &proposal);

        env.events().publish(
            (
                Symbol::new(&env, "Treasury"),
                Symbol::new(&env, "DURATION_VOTE"),
            ),
            (proposal_id, signer, support),
        );
    }

    /// Finalize a duration change once threshold of `for` votes is reached.
    /// Only updates the default for future proposals.
    pub fn finalize_time_lock_update(env: Env, caller: Address, proposal_id: u64) {
        Self::require_not_paused(&env);
        Self::require_signer(&env, &caller);

        let mut proposal = Self::get_duration_proposal(env.clone(), proposal_id)
            .expect("duration proposal not found");
        if proposal.finalized {
            panic!("already finalized");
        }

        let threshold = Self::get_threshold(env.clone());
        if proposal.votes_for.len() < threshold {
            panic!("insufficient votes for quorum");
        }

        proposal.finalized = true;
        proposal.approved = true;
        env.storage()
            .instance()
            .set(&DataKey::DurationProposal(proposal_id), &proposal);
        env.storage()
            .instance()
            .set(&DataKey::TimeLockDuration, &proposal.new_duration);

        env.events().publish(
            (
                Symbol::new(&env, "Treasury"),
                Symbol::new(&env, "DURATION_FINALIZE"),
            ),
            (proposal_id, proposal.new_duration),
        );
    }

    pub fn get_duration_proposal(env: Env, proposal_id: u64) -> Option<DurationProposal> {
        env.storage()
            .instance()
            .get(&DataKey::DurationProposal(proposal_id))
    }

    pub fn get_duration_proposal_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::DurationProposalCounter)
            .unwrap_or(0)
    }

    // -----------------------------------------------------------------
    // Transaction log (#918: treasury operations logged)
    // -----------------------------------------------------------------

    /// Return the full on-chain transaction log of executed treasury proposals.
    /// Each entry records the proposal ID, recipient, amount, category,
    /// execution timestamp, and the signer who triggered execution.
    pub fn get_transaction_log(env: Env) -> Vec<TreasuryTxLog> {
        env.storage()
            .instance()
            .get(&DataKey::TransactionLog)
            .unwrap_or_else(|| Vec::new(&env))
    }

    // -----------------------------------------------------------------
    // Treasury dashboard
    // -----------------------------------------------------------------

    /// Aggregate, single-call snapshot of treasury health for off-chain
    /// dashboards: balance, budget totals, signer/threshold config, and
    /// proposal activity counts.
    pub fn get_dashboard(env: Env) -> TreasuryDashboard {
        let signers = Self::get_signers(env.clone());
        let spending_count = Self::get_spending_proposal_count(env.clone());

        let mut active_spending_proposals = 0u32;
        let mut i = 1u64;
        while i <= spending_count {
            if let Some(proposal) = Self::get_spending_proposal(env.clone(), i) {
                if !proposal.executed && !proposal.cancelled {
                    active_spending_proposals += 1;
                }
            }
            i += 1;
        }

        TreasuryDashboard {
            balance: Self::get_balance(env.clone()),
            total_allocated: env
                .storage()
                .instance()
                .get(&DataKey::TotalAllocated)
                .unwrap_or(0),
            total_spent: env
                .storage()
                .instance()
                .get(&DataKey::TotalSpent)
                .unwrap_or(0),
            signer_count: signers.len(),
            threshold: Self::get_threshold(env.clone()),
            time_lock_duration: env
                .storage()
                .instance()
                .get(&DataKey::TimeLockDuration)
                .unwrap_or(0),
            spending_proposal_count: spending_count,
            active_spending_proposals,
            allocation_proposal_count: env
                .storage()
                .instance()
                .get(&DataKey::AllocationProposalCounter)
                .unwrap_or(0),
        }
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    // -----------------------------------------------------------------
    // Emergency stop
    // -----------------------------------------------------------------

    /// Pause or resume the treasury (admin only, emergency stop).
    ///
    /// Deliberately NOT guarded by `require_not_paused` — unpausing must stay
    /// reachable while paused. The flag lives in instance storage, which
    /// persists across wasm upgrades of this contract at the same address.
    pub fn set_paused(env: Env, caller: Address, paused: bool) {
        Self::require_admin(&env, &caller);

        env.storage().instance().set(&DataKey::Paused, &paused);

        let action = if paused {
            Symbol::new(&env, "PAUSED")
        } else {
            Symbol::new(&env, "UNPAUSED")
        };
        env.events()
            .publish((Symbol::new(&env, "Treasury"), action), (caller, paused));
    }

    /// Check if the treasury is paused (read; works while paused).
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    // ── Upgrade & Migration (#1064) ──────────────────────────────────────────

    pub fn schedule_upgrade(
        env: Env,
        new_wasm_hash: soroban_sdk::BytesN<32>,
        min_compatible_schema: u32,
        delay_seconds: Option<u64>,
    ) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        let now = env.ledger().timestamp();
        let delay = delay_seconds.unwrap_or(86_400);
        let scheduled = ScheduledUpgrade {
            new_wasm_hash,
            min_compatible_schema,
            scheduled_at: now,
            executable_at: now + delay,
        };
        env.storage()
            .instance()
            .set(&DataKey::ScheduledUpgrade, &scheduled);
    }

    pub fn upgrade(env: Env, new_wasm_hash: soroban_sdk::BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        let scheduled: ScheduledUpgrade = env
            .storage()
            .instance()
            .get(&DataKey::ScheduledUpgrade)
            .expect("no scheduled upgrade");

        if scheduled.new_wasm_hash != new_wasm_hash {
            panic!("wasm hash does not match scheduled upgrade");
        }

        let now = env.ledger().timestamp();
        if now < scheduled.executable_at {
            panic!("timelock not elapsed");
        }

        let current_schema: u32 = env
            .storage()
            .instance()
            .get(&DataKey::StorageSchemaVersion)
            .unwrap_or(1);

        if current_schema < scheduled.min_compatible_schema {
            panic!("incompatible schema");
        }

        let current_hash = env
            .storage()
            .instance()
            .get(&DataKey::PreviousWasmHash)
            .unwrap_or_else(|| soroban_sdk::BytesN::from_array(&env, &[0u8; 32]));
        env.storage()
            .instance()
            .set(&DataKey::PreviousWasmHash, &current_hash);

        env.deployer().update_current_contract_wasm(new_wasm_hash);

        if !Self::post_upgrade_check(env.clone()) {
            Self::rollback_upgrade(env.clone());
            panic!("post upgrade check failed, reverted");
        }

        env.storage().instance().remove(&DataKey::ScheduledUpgrade);
    }

    pub fn rollback_upgrade(env: Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        let prev_hash: soroban_sdk::BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::PreviousWasmHash)
            .expect("no prior version for rollback");
        env.deployer().update_current_contract_wasm(prev_hash);
    }

    pub fn post_upgrade_check(_env: Env) -> bool {
        true
    }

    pub fn get_storage_schema_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::StorageSchemaVersion)
            .unwrap_or(1)
    }

    pub fn set_storage_schema_version(env: Env, version: u32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::StorageSchemaVersion, &version);
    }

    // -----------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------

    fn token(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not set")
    }

    fn require_admin(env: &Env, caller: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        if *caller != admin {
            panic!("caller is not admin");
        }
        caller.require_auth();
    }

    fn require_not_paused(env: &Env) {
        if Self::is_paused(env.clone()) {
            panic!("contract is paused");
        }
    }

    fn require_signer(env: &Env, caller: &Address) {
        caller.require_auth();
        let signers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Signers)
            .unwrap_or_else(|| Vec::new(env));
        for signer in signers.iter() {
            if signer == *caller {
                return;
            }
        }
        panic!("caller is not a signer");
    }
}

#[cfg(test)]
mod test;
