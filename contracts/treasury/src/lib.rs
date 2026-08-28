#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol, Vec};

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

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Signers,
    Threshold,
    TimeLockDuration,
    Balance,
    SpendingProposalCounter,
    SpendingProposal(u64),
    AllocationProposalCounter,
    AllocationProposal(u64),
    AllocationVote(u64, Address),
    BudgetAllocation(Symbol),
    TotalAllocated,
    TotalSpent,
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
        signers: Vec<Address>,
        threshold: u32,
        time_lock_duration: u64,
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
        env.storage().instance().set(&DataKey::Signers, &signers);
        env.storage()
            .instance()
            .set(&DataKey::Threshold, &threshold);
        env.storage()
            .instance()
            .set(&DataKey::TimeLockDuration, &time_lock_duration);
        env.storage().instance().set(&DataKey::Balance, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::SpendingProposalCounter, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::AllocationProposalCounter, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::TotalAllocated, &0i128);
        env.storage().instance().set(&DataKey::TotalSpent, &0i128);

        env.events().publish(
            (Symbol::new(&env, "Treasury"), Symbol::new(&env, "INIT")),
            (admin, threshold),
        );
    }

    // -----------------------------------------------------------------
    // Funding
    // -----------------------------------------------------------------

    /// Record a deposit into the treasury's internal ledger balance.
    pub fn deposit(env: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let balance = Self::get_balance(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::Balance, &(balance + amount));

        env.events().publish(
            (Symbol::new(&env, "Treasury"), Symbol::new(&env, "DEPOSIT")),
            (from, amount),
        );
    }

    pub fn get_balance(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::Balance).unwrap_or(0)
    }

    // -----------------------------------------------------------------
    // Multi-sig signer management
    // -----------------------------------------------------------------

    pub fn add_signer(env: Env, caller: Address, new_signer: Address) {
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
        env.storage().instance().get(&DataKey::Threshold).unwrap_or(0)
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

        env.storage()
            .instance()
            .set(&DataKey::Balance, &(balance - proposal.amount));

        allocation.spent += proposal.amount;
        env.storage().instance().set(
            &DataKey::BudgetAllocation(proposal.category.clone()),
            &allocation,
        );

        let total_spent: i128 = env.storage().instance().get(&DataKey::TotalSpent).unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSpent, &(total_spent + proposal.amount));

        proposal.executed = true;
        env.storage()
            .instance()
            .set(&DataKey::SpendingProposal(proposal_id), &proposal);

        env.events().publish(
            (
                Symbol::new(&env, "Treasury"),
                Symbol::new(&env, "PROPOSAL_EXECUTE"),
            ),
            (proposal_id, proposal.recipient, proposal.amount),
        );
    }

    pub fn cancel_proposal(env: Env, caller: Address, proposal_id: u64) {
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
        env.storage()
            .instance()
            .set(&DataKey::TotalAllocated, &(total_allocated + proposal.amount));

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
            total_spent: env.storage().instance().get(&DataKey::TotalSpent).unwrap_or(0),
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
    // Internal helpers
    // -----------------------------------------------------------------

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
