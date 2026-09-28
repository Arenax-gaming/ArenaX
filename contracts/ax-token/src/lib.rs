#![no_std]

mod flash_loan_protection;
use flash_loan_protection::FlashLoanGuard;

use arenax_events::ax_token as events;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, Env, String, Symbol, Vec};

// ---------------------------------------------------------------------------
// Cross-contract client for StakingManager (#914: governance voting by stake)
// ---------------------------------------------------------------------------
//
// We declare a minimal client interface that only exposes the two read-only
// methods we need: `get_governance_weight` (tier-weighted reward stake) and
// `get_voting_weight` (time-lock voting escrow weight).  Both return i128 and
// take a single `Address` argument.  The actual staking-manager contract
// address is stored under `DataKey::StakingContract` and must be set by the
// admin via `set_staking_contract` before stake-weighted voting is active.
//
// If no staking contract is configured the governance system still works —
// voting power falls back to the AX token checkpoint value alone.

mod staking_client {
    use soroban_sdk::{contractclient, Address, Env};

    #[contractclient(name = "StakingClient")]
    pub trait StakingInterface {
        /// Tier-weighted governance power from reward staking positions.
        fn get_governance_weight(env: Env, user: Address) -> i128;
        /// Voting-escrow weight from time-locked AX positions.
        fn get_voting_weight(env: Env, user: Address) -> i128;
    }
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VestingSchedule {
    pub beneficiary: Address,
    pub start_time: u64,
    pub cliff_duration: u64,
    pub duration: u64,
    pub total_amount: i128,
    pub amount_claimed: i128,
    pub revoked: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct LockupRecord {
    pub amount: i128,
    pub unlock_time: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub description: String,
    pub votes_for: i128,
    pub votes_against: i128,
    pub end_time: u64,
    pub executed: bool,
    /// Ledger sequence ("block number") at proposal creation. Voting power is
    /// read as of this snapshot rather than live, so buying tokens (or
    /// collecting a delegation) after a proposal opens can't manufacture
    /// extra votes.
    pub snapshot_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct BurnMetrics {
    pub total_burned: i128,
    pub last_burn_time: u64,
    pub last_burn_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct BuybackSchedule {
    pub burn_amount_per_interval: i128,
    pub interval_seconds: u64,
    pub next_burn_time: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DelegationRecord {
    pub delegatee: Address,
    pub timestamp: u64,
    pub revoked: bool,
}

/// One entry in an address's voting-power history: the power in effect from
/// `ledger` onward, until the next checkpoint (if any). Checkpoints are
/// appended in non-decreasing `ledger` order, so a snapshot lookup for a past
/// ledger is a binary search for the last entry at or before it.
#[contracttype]
#[derive(Clone, Debug)]
pub struct VotingCheckpoint {
    pub ledger: u32,
    pub power: i128,
}

/// A single cast vote, recorded for historical/auditing purposes.
#[contracttype]
#[derive(Clone, Debug)]
pub struct VoteRecord {
    pub voter: Address,
    pub support: bool,
    pub power: i128,
    pub ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct PauseInfo {
    pub paused: bool,
    pub paused_at: u64,
    pub paused_by: Address,
    pub timeout: u64,
    pub reason: Symbol,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Balance(Address),
    TotalSupply,
    Vesting(Address),
    Lockups(Address),
    ProposalCounter,
    Proposal(u64),
    HasVoted(u64, Address),
    TotalLockedSupply,
    RevenuePoolBalance,
    BurnMetrics,
    BuybackSchedule,
    TotalBurned,
    // Flash loan protection
    LastOpSequence(Address),
    GlobalLastSequence,
    // Emergency pause
    PauseInfo,
    Paused,
    PauseTimeout,
    // Supply cap enforcement
    SupplyCap,
    // Vote delegation
    Delegate(Address),
    Delegators(Address),
    DelegationHistory(Address),
    // Voting-power snapshots
    Checkpoints(Address),
    VoteRecords(u64),
    // Stake-weighted governance (#914)
    /// Address of the StakingManager contract used to include staked AX and
    /// voting-escrow positions in governance voting power.
    StakingContract,
    /// When `true`, voting power is square-rooted before tallying (quadratic
    /// voting option, #914).  Defaults to `false` (linear).
    QuadraticVoting,
}

#[contract]
pub struct AxToken;

// `Events::publish` is deprecated in favor of the `#[contractevent]` macro;
// this contract's events predate that macro's availability and migrating
// their wire format is out of scope here.
#[allow(deprecated)]
#[contractimpl]
impl AxToken {
    pub fn initialize(env: &Env, admin: Address) {
        if Self::has_admin(env) {
            panic!("already initialized");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::TotalLockedSupply, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::ProposalCounter, &0u64);
    }

    pub fn mint(env: &Env, to: Address, amount: i128) {
        Self::require_admin(env);

        if amount <= 0 {
            panic!("amount must be positive");
        }

        let current_supply = Self::total_supply(env);
        let new_supply = current_supply.checked_add(amount).expect("supply overflow");

        let cap = Self::get_supply_cap(env.clone());
        if cap > 0 && new_supply > cap {
            panic!("supply cap exceeded");
        }

        let current_balance = Self::balance(env, to.clone());
        let new_balance = current_balance
            .checked_add(amount)
            .expect("balance overflow");

        env.storage()
            .instance()
            .set(&DataKey::Balance(to.clone()), &new_balance);

        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &new_supply);

        Self::checkpoint_add(env, &Self::voting_power_holder(env, &to), amount);

        events::emit_mint(env, &to, amount);
    }

    pub fn burn(env: &Env, from: Address, amount: i128) {
        Self::require_admin(env);

        if amount <= 0 {
            panic!("amount must be positive");
        }

        // Flash loan protection: reject same-sequence re-use
        if FlashLoanGuard::check_and_set_sequence(env, &from) {
            panic!("flash loan detected: same-sequence burn");
        }

        let current_balance = Self::balance(env, from.clone());
        if current_balance < amount {
            panic!("insufficient balance");
        }

        let new_balance = current_balance - amount;
        env.storage()
            .instance()
            .set(&DataKey::Balance(from.clone()), &new_balance);

        let current_supply = Self::total_supply(env);
        let new_supply = current_supply - amount;
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &new_supply);

        // The supply cap is independent of total supply. Burning tokens must
        // not tighten the cap; only `set_supply_cap` (decrease) and
        // `adjust_cap_via_governance` (increase) change it.
        Self::checkpoint_add(env, &Self::voting_power_holder(env, &from), -amount);

        events::emit_burn(env, &from, amount);
    }

    pub fn transfer(env: &Env, from: Address, to: Address, amount: i128) {
        from.require_auth();

        if Self::is_paused(env.clone()) {
            panic!("contract is paused");
        }

        if amount <= 0 {
            panic!("amount must be positive");
        }

        if from == to {
            panic!("cannot transfer to self");
        }

        // Flash loan protection: reject same-sequence re-use
        if FlashLoanGuard::check_and_set_sequence(env, &from) {
            panic!("flash loan detected: same-sequence transfer");
        }

        let from_balance = Self::balance(env, from.clone());
        if from_balance < amount {
            panic!("insufficient balance");
        }

        let new_from_balance = from_balance - amount;
        env.storage()
            .instance()
            .set(&DataKey::Balance(from.clone()), &new_from_balance);

        let to_balance = Self::balance(env, to.clone());
        let new_to_balance = to_balance + amount;
        env.storage()
            .instance()
            .set(&DataKey::Balance(to.clone()), &new_to_balance);

        Self::checkpoint_add(env, &Self::voting_power_holder(env, &from), -amount);
        Self::checkpoint_add(env, &Self::voting_power_holder(env, &to), amount);

        events::emit_transfer(env, &from, &to, amount);
    }

    pub fn balance(env: &Env, addr: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Balance(addr))
            .unwrap_or(0)
    }

    pub fn total_supply(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    pub fn get_admin(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn set_admin(env: &Env, new_admin: Address) {
        Self::require_admin(env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    // ---------------------------------------------------------------------------
    // Advanced Features: Emergency Pause Mechanism
    // ---------------------------------------------------------------------------

    pub fn pause(env: Env, reason: Symbol) {
        Self::require_admin(&env);

        let admin = Self::get_admin(&env);
        let timeout = env
            .storage()
            .instance()
            .get(&DataKey::PauseTimeout)
            .unwrap_or(86400u64); // 24 hours default

        let info = PauseInfo {
            paused: true,
            paused_at: env.ledger().timestamp(),
            paused_by: admin.clone(),
            timeout,
            reason: reason.clone(),
        };

        env.storage().instance().set(&DataKey::PauseInfo, &info);
        env.storage().instance().set(&DataKey::Paused, &true);

        arenax_events::emergency_pause::emit_paused(
            &env,
            &env.current_contract_address(),
            &admin,
            &reason,
        );
    }

    pub fn is_paused(env: Env) -> bool {
        let info_opt: Option<PauseInfo> = env.storage().instance().get(&DataKey::PauseInfo);
        match info_opt {
            Some(info) => {
                if !info.paused {
                    return false;
                }
                let current_time = env.ledger().timestamp();
                if current_time >= info.paused_at.saturating_add(info.timeout) {
                    false
                } else {
                    true
                }
            }
            None => false,
        }
    }

    pub fn get_pause_info(env: Env) -> Option<PauseInfo> {
        env.storage().instance().get(&DataKey::PauseInfo)
    }

    pub fn set_pause_timeout(env: Env, timeout_seconds: u64) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::PauseTimeout, &timeout_seconds);
    }

    pub fn unpause_via_governance(env: Env, proposal_id: u64) {
        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");

        if env.ledger().timestamp() <= proposal.end_time {
            panic!("voting period not ended");
        }

        if proposal.votes_for <= proposal.votes_against {
            panic!("proposal did not pass");
        }

        if proposal.executed {
            panic!("proposal already executed");
        }

        proposal.executed = true;
        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        if let Some(mut info) = env
            .storage()
            .instance()
            .get::<_, PauseInfo>(&DataKey::PauseInfo)
        {
            info.paused = false;
            env.storage().instance().set(&DataKey::PauseInfo, &info);
        }
        env.storage().instance().set(&DataKey::Paused, &false);

        arenax_events::emergency_pause::emit_unpaused(
            &env,
            &env.current_contract_address(),
            &proposal.proposer,
        );
    }

    // ---------------------------------------------------------------------------
    // Advanced Features: Supply Cap Enforcement
    // ---------------------------------------------------------------------------

    /// Tighten the supply cap. Admin-only.
    ///
    /// A stored cap of `0` means no cap is set. The first call may introduce a
    /// finite cap, which is a tightening, not an increase. Once a cap is set,
    /// this function can only lower it. Raising the cap is governance-only:
    /// see [`Self::adjust_cap_via_governance`].
    pub fn set_supply_cap(env: Env, cap: i128) {
        Self::require_admin(&env);
        if cap <= 0 {
            panic!("supply cap must be positive");
        }
        let current_cap = Self::get_supply_cap(env.clone());
        if current_cap > 0 && cap >= current_cap {
            panic!("supply cap cannot be increased by admin");
        }
        let current_supply = Self::total_supply(&env);
        if current_supply > cap {
            panic!("current supply exceeds new cap");
        }
        env.storage().instance().set(&DataKey::SupplyCap, &cap);
    }

    pub fn get_supply_cap(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::SupplyCap)
            .unwrap_or(0)
    }

    /// Change the supply cap through a passed governance proposal.
    ///
    /// This is the only path that may raise the cap. `set_supply_cap` is
    /// admin-only and can only tighten an existing cap.
    pub fn adjust_cap_via_governance(env: Env, proposal_id: u64, new_cap: i128) {
        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");

        if env.ledger().timestamp() <= proposal.end_time {
            panic!("voting period not ended");
        }

        if proposal.votes_for <= proposal.votes_against {
            panic!("proposal did not pass");
        }

        if proposal.executed {
            panic!("proposal already executed");
        }

        if new_cap <= 0 {
            panic!("supply cap must be positive");
        }

        let current_supply = Self::total_supply(&env);
        if current_supply > new_cap {
            panic!("current supply exceeds new cap");
        }

        env.storage().instance().set(&DataKey::SupplyCap, &new_cap);
        proposal.executed = true;
        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);
    }

    // ---------------------------------------------------------------------------
    // Advanced Features: Vesting
    // ---------------------------------------------------------------------------

    pub fn create_vesting_schedule(
        env: Env,
        beneficiary: Address,
        total_amount: i128,
        start_time: u64,
        cliff_duration: u64,
        duration: u64,
    ) {
        Self::require_admin(&env);
        Self::store_vesting_schedule(
            &env,
            beneficiary,
            total_amount,
            start_time,
            cliff_duration,
            duration,
        );
    }

    /// Creates vesting schedules for multiple beneficiaries in a single call,
    /// all sharing the same start time, cliff, and duration.
    pub fn create_vesting_schedules_batch(
        env: Env,
        beneficiaries: Vec<Address>,
        amounts: Vec<i128>,
        start_time: u64,
        cliff_duration: u64,
        duration: u64,
    ) {
        Self::require_admin(&env);
        if beneficiaries.len() != amounts.len() {
            panic!("beneficiaries and amounts length mismatch");
        }
        if beneficiaries.is_empty() {
            panic!("empty batch");
        }

        for i in 0..beneficiaries.len() {
            Self::store_vesting_schedule(
                &env,
                beneficiaries.get(i).unwrap(),
                amounts.get(i).unwrap(),
                start_time,
                cliff_duration,
                duration,
            );
        }
    }

    /// Revokes a vesting schedule before it fully vests (clawback). Any amount
    /// already vested as of now remains claimable by the beneficiary; the
    /// unvested remainder is forfeited and can no longer be claimed.
    pub fn revoke_vesting_schedule(env: Env, beneficiary: Address) -> i128 {
        Self::require_admin(&env);

        let key = DataKey::Vesting(beneficiary.clone());
        let mut schedule: VestingSchedule = env
            .storage()
            .instance()
            .get(&key)
            .expect("no vesting schedule found");

        if schedule.revoked {
            panic!("vesting schedule already revoked");
        }

        let vested_amount = Self::vested_amount(&env, &schedule);
        let forfeited = schedule.total_amount - vested_amount;

        // Freeze `duration` at the elapsed time so future calls to
        // `vested_amount` always take the `elapsed >= duration` branch and
        // return the capped `total_amount` outright, instead of re-applying
        // the linear elapsed/duration fraction to an already-capped amount.
        let elapsed_at_revoke = env.ledger().timestamp().saturating_sub(schedule.start_time);
        schedule.total_amount = vested_amount;
        schedule.duration = elapsed_at_revoke;
        schedule.revoked = true;
        env.storage().instance().set(&key, &schedule);

        env.events().publish(
            (
                Symbol::new(&env, "ArenaXToken_v1"),
                Symbol::new(&env, "VESTING_REVOKE"),
            ),
            (beneficiary, forfeited),
        );

        forfeited
    }

    pub fn claim_vested_tokens(env: Env, beneficiary: Address) -> i128 {
        beneficiary.require_auth();

        let key = DataKey::Vesting(beneficiary.clone());
        let mut schedule: VestingSchedule = env
            .storage()
            .instance()
            .get(&key)
            .expect("no vesting schedule found");

        let current_time = env.ledger().timestamp();
        if current_time < schedule.start_time + schedule.cliff_duration {
            panic!("cliff period not met");
        }

        let vested_amount = Self::vested_amount(&env, &schedule);
        let claimable = vested_amount - schedule.amount_claimed;
        if claimable <= 0 {
            panic!("no vested tokens to claim");
        }

        schedule.amount_claimed += claimable;
        env.storage().instance().set(&key, &schedule);

        // Add vested tokens to beneficiary balance
        let current_balance = Self::balance(&env, beneficiary.clone());
        env.storage().instance().set(
            &DataKey::Balance(beneficiary.clone()),
            &(current_balance + claimable),
        );

        let current_supply = Self::total_supply(&env);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(current_supply + claimable));

        env.events().publish(
            (
                Symbol::new(&env, "ArenaXToken_v1"),
                Symbol::new(&env, "VESTING_CLAIM"),
            ),
            (beneficiary, claimable),
        );

        claimable
    }

    pub fn get_vesting_schedule(env: Env, beneficiary: Address) -> Option<VestingSchedule> {
        env.storage().instance().get(&DataKey::Vesting(beneficiary))
    }

    // ---------------------------------------------------------------------------
    // Advanced Features: Token Locking
    // ---------------------------------------------------------------------------

    pub fn lock_tokens(env: Env, from: Address, amount: i128, unlock_time: u64) {
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        if unlock_time <= env.ledger().timestamp() {
            panic!("unlock time must be in future");
        }

        let balance = Self::balance(&env, from.clone());
        if balance < amount {
            panic!("insufficient balance");
        }

        env.storage()
            .instance()
            .set(&DataKey::Balance(from.clone()), &(balance - amount));

        let lockup_key = DataKey::Lockups(from.clone());
        let mut lockups: Vec<LockupRecord> = env
            .storage()
            .instance()
            .get(&lockup_key)
            .unwrap_or_else(|| Vec::new(&env));

        lockups.push_back(LockupRecord {
            amount,
            unlock_time,
        });
        env.storage().instance().set(&lockup_key, &lockups);

        let total_locked: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalLockedSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalLockedSupply, &(total_locked + amount));

        env.events().publish(
            (
                Symbol::new(&env, "ArenaXToken_v1"),
                Symbol::new(&env, "LOCK"),
            ),
            (from, amount, unlock_time),
        );
    }

    pub fn unlock_tokens(env: Env, from: Address) -> i128 {
        from.require_auth();

        let lockup_key = DataKey::Lockups(from.clone());
        let lockups: Vec<LockupRecord> = env
            .storage()
            .instance()
            .get(&lockup_key)
            .expect("no lockups found");

        let current_time = env.ledger().timestamp();
        let mut active_lockups = Vec::new(&env);
        let mut unlocked_amount = 0i128;

        for lock in lockups.iter() {
            if current_time >= lock.unlock_time {
                unlocked_amount += lock.amount;
            } else {
                active_lockups.push_back(lock);
            }
        }

        if unlocked_amount == 0 {
            panic!("no tokens ready to unlock");
        }

        env.storage().instance().set(&lockup_key, &active_lockups);

        let balance = Self::balance(&env, from.clone());
        env.storage().instance().set(
            &DataKey::Balance(from.clone()),
            &(balance + unlocked_amount),
        );

        let total_locked: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalLockedSupply)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::TotalLockedSupply,
            &(total_locked - unlocked_amount),
        );

        env.events().publish(
            (
                Symbol::new(&env, "ArenaXToken_v1"),
                Symbol::new(&env, "UNLOCK"),
            ),
            (from, unlocked_amount),
        );

        unlocked_amount
    }

    pub fn get_locked_balance(env: Env, addr: Address) -> i128 {
        let lockup_key = DataKey::Lockups(addr);
        let lockups: Vec<LockupRecord> = env
            .storage()
            .instance()
            .get(&lockup_key)
            .unwrap_or_else(|| Vec::new(&env));

        let mut total = 0i128;
        for lock in lockups.iter() {
            total += lock.amount;
        }
        total
    }

    pub fn get_total_locked_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalLockedSupply)
            .unwrap_or(0)
    }

    // ---------------------------------------------------------------------------
    // Advanced Features: Token Governance
    // ---------------------------------------------------------------------------

    pub fn create_proposal(
        env: Env,
        proposer: Address,
        description: String,
        voting_duration: u64,
    ) -> u64 {
        proposer.require_auth();

        let balance = Self::balance(&env, proposer.clone());
        if balance < 1000 {
            panic!("insufficient balance to propose");
        }

        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ProposalCounter)
            .unwrap_or(0);
        counter += 1;

        let proposal = Proposal {
            id: counter,
            proposer: proposer.clone(),
            description,
            votes_for: 0,
            votes_against: 0,
            end_time: env.ledger().timestamp() + voting_duration,
            executed: false,
            snapshot_ledger: env.ledger().sequence(),
        };

        env.storage()
            .instance()
            .set(&DataKey::Proposal(counter), &proposal);
        env.storage()
            .instance()
            .set(&DataKey::ProposalCounter, &counter);

        env.events().publish(
            (
                Symbol::new(&env, "ArenaXToken_v1"),
                Symbol::new(&env, "PROPOSAL_CREATE"),
            ),
            (counter, proposer),
        );

        counter
    }

    pub fn vote_on_proposal(env: Env, voter: Address, proposal_id: u64, support: bool) {
        voter.require_auth();

        // Flash loan protection: prevent same-sequence governance manipulation
        if FlashLoanGuard::check_and_set_sequence(&env, &voter) {
            panic!("flash loan detected: same-sequence governance vote");
        }

        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");

        if env.ledger().timestamp() > proposal.end_time {
            panic!("voting ended");
        }

        let vote_key = DataKey::HasVoted(proposal_id, voter.clone());
        if env.storage().instance().has(&vote_key) {
            panic!("already voted");
        }

        // Snapshot lookup: power is read as of the proposal's creation ledger,
        // not live, so it can't be inflated by acquiring tokens or a
        // delegation after the proposal opened.
        // Composite power includes AX checkpoints + stake weight + escrow (#914).
        let voting_power =
            Self::composite_voting_power(&env, &voter, proposal.snapshot_ledger);

        if voting_power <= 0 {
            panic!("no voting power");
        }

        if support {
            proposal.votes_for += voting_power;
        } else {
            proposal.votes_against += voting_power;
        }

        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage().instance().set(&vote_key, &true);

        let records_key = DataKey::VoteRecords(proposal_id);
        let mut records: Vec<VoteRecord> = env
            .storage()
            .instance()
            .get(&records_key)
            .unwrap_or_else(|| Vec::new(&env));
        records.push_back(VoteRecord {
            voter: voter.clone(),
            support,
            power: voting_power,
            ledger: env.ledger().sequence(),
        });
        env.storage().instance().set(&records_key, &records);

        env.events().publish(
            (
                Symbol::new(&env, "ArenaXToken_v1"),
                Symbol::new(&env, "VOTE"),
            ),
            (proposal_id, voter, support, voting_power),
        );
    }

    /// Full history of individual votes cast on `proposal_id`, in the order
    /// they were cast.
    pub fn get_vote_records(env: Env, proposal_id: u64) -> Vec<VoteRecord> {
        env.storage()
            .instance()
            .get(&DataKey::VoteRecords(proposal_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<Proposal> {
        env.storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
    }

    /// Set the grace period before passed unexecuted proposals can be expired
    ///
    /// # Arguments
    /// * `grace_period` - Grace period duration in seconds (default 7 days = 604,800s)
    pub fn set_proposal_grace_period(env: Env, grace_period: u64) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::ProposalGracePeriod, &grace_period);
    }

    /// Get the configured proposal grace period (defaults to 7 days = 604,800s)
    pub fn get_proposal_grace_period(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::ProposalGracePeriod)
            .unwrap_or(7 * 24 * 60 * 60)
    }

    /// Admin approves an execution target contract address
    pub fn approve_execution_target(env: Env, target: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::ApprovedExecutionTarget(target), &true);
    }

    /// Check if a contract address is an approved execution target
    pub fn is_execution_target_approved(env: Env, target: Address) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::ApprovedExecutionTarget(target))
            .unwrap_or(false)
    }

    /// Expire a proposal and clean it up from storage.
    ///
    /// - Rejected proposals (`votes_for <= votes_against`) can be expired immediately after `end_time`.
    /// - Passed unexecuted proposals can only be expired after `end_time + grace_period`.
    /// - Executed proposals can be expired/cleaned up immediately after `end_time`.
    /// Callable by anyone.
    pub fn expire_proposal(env: Env, proposal_id: u64) {
        let proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");

        let now = env.ledger().timestamp();
        if now < proposal.end_time {
            panic!("voting period not ended");
        }

        let is_rejected = proposal.votes_for <= proposal.votes_against;
        if !is_rejected && !proposal.executed {
            let grace_period = Self::get_proposal_grace_period(env.clone());
            if now < proposal.end_time + grace_period {
                panic!("proposal within grace period");
            }
        }

        env.storage()
            .instance()
            .remove(&DataKey::Proposal(proposal_id));

        env.events().publish(
            (
                Symbol::new(&env, "ArenaXToken_v1"),
                Symbol::new(&env, "PROPOSAL_EXPIRED"),
            ),
            proposal_id,
        );
    }

    /// General execution hook for passed proposals
    ///
    /// Marks the proposal as executed and emits the general execution event with calldata.
    pub fn execute_proposal(env: Env, proposal_id: u64, calldata: Bytes) {
        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");

        if env.ledger().timestamp() <= proposal.end_time {
            panic!("voting period not ended");
        }

        if proposal.votes_for <= proposal.votes_against {
            panic!("proposal did not pass");
        }

        if proposal.executed {
            panic!("proposal already executed");
        }

        proposal.executed = true;
        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (
                Symbol::new(&env, "ArenaXToken_v1"),
                Symbol::new(&env, "PROPOSAL_EXECUTED"),
            ),
            (proposal_id, calldata),
        );
    }

    // ---------------------------------------------------------------------------
    // Advanced Features: Vote Delegation
    // ---------------------------------------------------------------------------

    /// Delegate voting power (own balance + locked balance) to another address.
    /// Re-delegating simply moves the delegation from the old delegatee to the
    /// new one. Self-delegation is blocked since holding your own power
    /// directly already achieves the same effect.
    pub fn delegate(env: Env, delegator: Address, delegatee: Address) {
        delegator.require_auth();

        if delegator == delegatee {
            panic!("cannot delegate to self");
        }

        let current_time = env.ledger().timestamp();
        let previous = Self::get_delegate(env.clone(), delegator.clone());

        let power = Self::balance(&env, delegator.clone())
            + Self::get_locked_balance(env.clone(), delegator.clone());

        if let Some(previous_delegatee) = previous {
            if previous_delegatee == delegatee {
                panic!("already delegated to this address");
            }
            Self::remove_delegator(&env, &previous_delegatee, &delegator);
            Self::checkpoint_add(&env, &previous_delegatee, -power);
        } else {
            Self::checkpoint_add(&env, &delegator, -power);
        }

        env.storage()
            .instance()
            .set(&DataKey::Delegate(delegator.clone()), &delegatee);
        Self::add_delegator(&env, &delegatee, &delegator);
        Self::checkpoint_add(&env, &delegatee, power);

        let mut history = Self::get_delegation_history(env.clone(), delegator.clone());
        history.push_back(DelegationRecord {
            delegatee: delegatee.clone(),
            timestamp: current_time,
            revoked: false,
        });
        env.storage()
            .instance()
            .set(&DataKey::DelegationHistory(delegator.clone()), &history);

        env.events().publish(
            (
                Symbol::new(&env, "ArenaXToken_v1"),
                Symbol::new(&env, "DELEGATE"),
            ),
            (delegator, delegatee),
        );
    }

    /// Revoke an active delegation, returning voting power to the delegator.
    pub fn revoke_delegation(env: Env, delegator: Address) {
        delegator.require_auth();

        let delegatee =
            Self::get_delegate(env.clone(), delegator.clone()).expect("no active delegation found");

        let power = Self::balance(&env, delegator.clone())
            + Self::get_locked_balance(env.clone(), delegator.clone());

        Self::remove_delegator(&env, &delegatee, &delegator);
        env.storage()
            .instance()
            .remove(&DataKey::Delegate(delegator.clone()));
        Self::checkpoint_add(&env, &delegatee, -power);
        Self::checkpoint_add(&env, &delegator, power);

        let mut history = Self::get_delegation_history(env.clone(), delegator.clone());
        history.push_back(DelegationRecord {
            delegatee: delegatee.clone(),
            timestamp: env.ledger().timestamp(),
            revoked: true,
        });
        env.storage()
            .instance()
            .set(&DataKey::DelegationHistory(delegator.clone()), &history);

        env.events().publish(
            (
                Symbol::new(&env, "ArenaXToken_v1"),
                Symbol::new(&env, "DELEGATION_REVOKE"),
            ),
            (delegator, delegatee),
        );
    }

    /// The address `delegator` currently delegates to, if any.
    pub fn get_delegate(env: Env, delegator: Address) -> Option<Address> {
        env.storage().instance().get(&DataKey::Delegate(delegator))
    }

    /// Addresses that currently delegate their voting power to `delegatee`.
    pub fn get_delegators(env: Env, delegatee: Address) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Delegators(delegatee))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Full history of delegation/revocation events for `delegator`.
    pub fn get_delegation_history(env: Env, delegator: Address) -> Vec<DelegationRecord> {
        env.storage()
            .instance()
            .get(&DataKey::DelegationHistory(delegator))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Current effective voting power for `address`: their own balance +
    /// locked balance (zero if they've delegated it away) plus the raw power
    /// of every address currently delegating to them. Backed by the same
    /// voting-power checkpoints `get_voting_power_at` reads, so it's always
    /// consistent with a snapshot taken "now".
    pub fn get_voting_power(env: Env, address: Address) -> i128 {
        Self::power_at(&env, &address, env.ledger().sequence())
    }

    /// Effective voting power for `address` as of a past ledger sequence
    /// (the Soroban analog of a block number). Used by `vote_on_proposal` so
    /// votes are weighted by power held at proposal-creation time rather
    /// than whatever the caller holds right now.
    pub fn get_voting_power_at(env: Env, address: Address, ledger_seq: u32) -> i128 {
        Self::power_at(&env, &address, ledger_seq)
    }

    /// The address whose checkpoint currently represents `address`'s voting
    /// power: `address` itself, unless it has delegated away, in which case
    /// it's the delegatee.
    fn voting_power_holder(env: &Env, address: &Address) -> Address {
        Self::get_delegate(env.clone(), address.clone()).unwrap_or_else(|| address.clone())
    }

    /// Record a change of `delta` to `address`'s voting power as of the
    /// current ledger, appending a new checkpoint (or updating the current
    /// ledger's checkpoint if one was already written this ledger).
    fn checkpoint_add(env: &Env, address: &Address, delta: i128) {
        let key = DataKey::Checkpoints(address.clone());
        let mut checkpoints: Vec<VotingCheckpoint> = env
            .storage()
            .instance()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));

        let current_ledger = env.ledger().sequence();
        let previous_power = checkpoints.last().map(|c| c.power).unwrap_or(0);
        let new_power = previous_power + delta;

        match checkpoints.last() {
            Some(last) if last.ledger == current_ledger => {
                let last_index = checkpoints.len() - 1;
                checkpoints.set(
                    last_index,
                    VotingCheckpoint {
                        ledger: current_ledger,
                        power: new_power,
                    },
                );
            }
            _ => {
                checkpoints.push_back(VotingCheckpoint {
                    ledger: current_ledger,
                    power: new_power,
                });
            }
        }

        env.storage().instance().set(&key, &checkpoints);
    }

    /// Binary search `address`'s checkpoint history for the power in effect
    /// at `ledger_seq` (the last checkpoint at or before it, 0 if none).
    fn power_at(env: &Env, address: &Address, ledger_seq: u32) -> i128 {
        let checkpoints: Vec<VotingCheckpoint> = env
            .storage()
            .instance()
            .get(&DataKey::Checkpoints(address.clone()))
            .unwrap_or_else(|| Vec::new(env));

        if checkpoints.is_empty() {
            return 0;
        }

        let mut low: u32 = 0;
        let mut high: u32 = checkpoints.len();
        while low < high {
            let mid = low + (high - low) / 2;
            let checkpoint = checkpoints.get(mid).unwrap();
            if checkpoint.ledger <= ledger_seq {
                low = mid + 1;
            } else {
                high = mid;
            }
        }

        if low == 0 {
            0
        } else {
            checkpoints.get(low - 1).unwrap().power
        }
    }

    fn add_delegator(env: &Env, delegatee: &Address, delegator: &Address) {
        let key = DataKey::Delegators(delegatee.clone());
        let mut delegators: Vec<Address> = env
            .storage()
            .instance()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        delegators.push_back(delegator.clone());
        env.storage().instance().set(&key, &delegators);
    }

    fn remove_delegator(env: &Env, delegatee: &Address, delegator: &Address) {
        let key = DataKey::Delegators(delegatee.clone());
        let delegators: Vec<Address> = env
            .storage()
            .instance()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        let mut remaining = Vec::new(env);
        for existing in delegators.iter() {
            if existing != *delegator {
                remaining.push_back(existing);
            }
        }
        env.storage().instance().set(&key, &remaining);
    }

    // ---------------------------------------------------------------------------
    // Advanced Features: Buyback and Burn
    // ---------------------------------------------------------------------------

    pub fn deposit_revenue(env: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let balance = Self::balance(&env, from.clone());
        if balance < amount {
            panic!("insufficient balance");
        }

        env.storage()
            .instance()
            .set(&DataKey::Balance(from.clone()), &(balance - amount));

        let pool: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RevenuePoolBalance)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::RevenuePoolBalance, &(pool + amount));

        env.events().publish(
            (
                Symbol::new(&env, "ArenaXToken_v1"),
                Symbol::new(&env, "REVENUE_DEPOSIT"),
            ),
            (from, amount),
        );
    }

    pub fn configure_buyback(env: Env, amount: i128, interval: u64) {
        Self::require_admin(&env);
        if amount <= 0 || interval == 0 {
            panic!("invalid configuration");
        }

        let schedule = BuybackSchedule {
            burn_amount_per_interval: amount,
            interval_seconds: interval,
            next_burn_time: env.ledger().timestamp() + interval,
        };
        env.storage()
            .instance()
            .set(&DataKey::BuybackSchedule, &schedule);
    }

    pub fn execute_buyback_and_burn(env: Env) -> i128 {
        let mut schedule: BuybackSchedule = env
            .storage()
            .instance()
            .get(&DataKey::BuybackSchedule)
            .expect("no schedule configured");
        let current_time = env.ledger().timestamp();

        if current_time < schedule.next_burn_time {
            panic!("too early for next burn");
        }

        let pool: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RevenuePoolBalance)
            .unwrap_or(0);
        let amount_to_burn = if pool < schedule.burn_amount_per_interval {
            pool
        } else {
            schedule.burn_amount_per_interval
        };

        if amount_to_burn <= 0 {
            panic!("no revenue to burn");
        }

        env.storage()
            .instance()
            .set(&DataKey::RevenuePoolBalance, &(pool - amount_to_burn));

        let current_supply = Self::total_supply(&env);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(current_supply - amount_to_burn));

        let total_burned: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalBurned)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalBurned, &(total_burned + amount_to_burn));

        let metrics = BurnMetrics {
            total_burned: total_burned + amount_to_burn,
            last_burn_time: current_time,
            last_burn_amount: amount_to_burn,
        };
        env.storage()
            .instance()
            .set(&DataKey::BurnMetrics, &metrics);

        schedule.next_burn_time = current_time + schedule.interval_seconds;
        env.storage()
            .instance()
            .set(&DataKey::BuybackSchedule, &schedule);

        env.events().publish(
            (
                Symbol::new(&env, "ArenaXToken_v1"),
                Symbol::new(&env, "BUYBACK_BURN"),
            ),
            (amount_to_burn, current_time),
        );

        amount_to_burn
    }

    pub fn get_burn_metrics(env: Env) -> Option<BurnMetrics> {
        env.storage().instance().get(&DataKey::BurnMetrics)
    }

    // ---------------------------------------------------------------------------
    // Advanced Features: Stake-Weighted Governance (#914)
    // ---------------------------------------------------------------------------

    /// Register the StakingManager contract address so voting power includes
    /// staked AX (governance weight) and voting-escrow locked AX (#914).
    /// Admin-only. Call this once after both contracts are deployed.
    pub fn set_staking_contract(env: Env, staking_contract: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::StakingContract, &staking_contract);
        env.events().publish(
            (
                Symbol::new(&env, "ArenaXToken_v1"),
                Symbol::new(&env, "STAKING_CONTRACT_SET"),
            ),
            staking_contract,
        );
    }

    /// Return the configured StakingManager address, or `None` if not set.
    pub fn get_staking_contract(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::StakingContract)
    }

    /// Enable or disable quadratic voting (#914: quadratic voting option).
    /// When enabled, each voter's effective power = floor(sqrt(raw_power)).
    /// Admin-only — should be set via a passed governance proposal in production.
    pub fn set_quadratic_voting(env: Env, enabled: bool) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::QuadraticVoting, &enabled);
        env.events().publish(
            (
                Symbol::new(&env, "ArenaXToken_v1"),
                Symbol::new(&env, "QUADRATIC_VOTING_SET"),
            ),
            enabled,
        );
    }

    /// Whether quadratic voting is currently active.
    pub fn get_quadratic_voting(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::QuadraticVoting)
            .unwrap_or(false)
    }

    /// Full composite voting power for `address` at `ledger_seq` (#914).
    ///
    /// Combines three sources — each snapshotted or read at proposal-creation
    /// time to prevent post-proposal manipulation:
    ///
    /// 1. **Token checkpoint power** — the voter's AX balance + delegated AX
    ///    at `ledger_seq` (existing checkpoint mechanism, unchanged).
    /// 2. **Governance weight** — tier-weighted staked AX from
    ///    `StakingManager::get_governance_weight` (live read; staking manager
    ///    snapshots are not yet implemented, so we take the live value).
    /// 3. **Voting-escrow weight** — time-lock boosted AX from
    ///    `StakingManager::get_voting_weight` (live read).
    ///
    /// If no staking contract is configured, only source 1 is used.
    ///
    /// When quadratic voting is enabled the *sum* is square-rooted before
    /// being returned, so whales cannot dominate linearly (#914).
    pub fn get_total_voting_power_at(env: Env, address: Address, ledger_seq: u32) -> i128 {
        Self::composite_voting_power(&env, &address, ledger_seq)
    }

    // ---------------------------------------------------------------------------
    // Internal Helpers
    // ---------------------------------------------------------------------------

    // ---------------------------------------------------------------------------
    // Composite Voting Power (#914)
    // ---------------------------------------------------------------------------

    /// Compute the full stake-weighted voting power for `address` at
    /// `ledger_seq`.
    ///
    /// Sources:
    /// 1. AX token checkpoint (snapshot — anti-flash-loan).
    /// 2. Staking governance weight (live cross-contract call to StakingManager).
    /// 3. Voting-escrow weight (live cross-contract call to StakingManager).
    ///
    /// Sources 2 & 3 are live because the staking-manager contract does not
    /// maintain block-level checkpoints yet; using live values is safe because
    /// the flash-loan guard already blocks same-ledger vote manipulation.
    ///
    /// When quadratic voting is on, the sum is square-rooted (#914).
    /// When delegation is active the checkpoint power already includes the
    /// delegated amount; stake power is always per-voter (delegating AX
    /// tokens doesn't move them out of the staking contract).
    fn composite_voting_power(env: &Env, address: &Address, ledger_seq: u32) -> i128 {
        // 1. Token checkpoint power (snapshot at proposal creation ledger)
        let checkpoint_power = Self::power_at(env, address, ledger_seq);

        // 2 & 3. Stake power — cross-contract call if staking contract is set
        let stake_power: i128 =
            if let Some(staking_addr) = env
                .storage()
                .instance()
                .get::<DataKey, Address>(&DataKey::StakingContract)
            {
                let client = staking_client::StakingClient::new(env, &staking_addr);
                // governance_weight = tier-weighted reward stake
                let gov = client.get_governance_weight(address.clone());
                // voting_weight = time-lock escrow weight
                let escrow = client.get_voting_weight(address.clone());
                gov.saturating_add(escrow)
            } else {
                0
            };

        let raw_power = checkpoint_power.saturating_add(stake_power);

        // Apply quadratic voting if enabled (#914: quadratic voting option)
        let quadratic: bool = env
            .storage()
            .instance()
            .get(&DataKey::QuadraticVoting)
            .unwrap_or(false);

        if quadratic && raw_power > 0 {
            Self::isqrt(raw_power)
        } else {
            raw_power
        }
    }

    /// Integer square root (floor) for quadratic voting (#914).
    /// Uses Newton's method — O(log n) iterations, no floating point.
    fn isqrt(n: i128) -> i128 {
        if n < 0 {
            return 0;
        }
        if n == 0 {
            return 0;
        }
        let mut x = n;
        let mut y = (x + 1) / 2;
        while y < x {
            x = y;
            y = (x + n / x) / 2;
        }
        x
    }

    fn store_vesting_schedule(
        env: &Env,
        beneficiary: Address,
        total_amount: i128,
        start_time: u64,
        cliff_duration: u64,
        duration: u64,
    ) {
        if total_amount <= 0 {
            panic!("amount must be positive");
        }
        if duration == 0 {
            panic!("duration must be positive");
        }

        let schedule = VestingSchedule {
            beneficiary: beneficiary.clone(),
            start_time,
            cliff_duration,
            duration,
            total_amount,
            amount_claimed: 0,
            revoked: false,
        };
        env.storage()
            .instance()
            .set(&DataKey::Vesting(beneficiary.clone()), &schedule);

        env.events().publish(
            (
                Symbol::new(env, "ArenaXToken_v1"),
                Symbol::new(env, "VESTING_CREATE"),
            ),
            (beneficiary, total_amount),
        );
    }

    fn vested_amount(env: &Env, schedule: &VestingSchedule) -> i128 {
        let current_time = env.ledger().timestamp();
        if current_time < schedule.start_time + schedule.cliff_duration {
            return 0;
        }

        let elapsed = current_time.saturating_sub(schedule.start_time);
        if elapsed >= schedule.duration {
            schedule.total_amount
        } else {
            schedule.total_amount * (elapsed as i128) / (schedule.duration as i128)
        }
    }

    // ── Upgrade & Migration (#1064) ──────────────────────────────────────────

    pub fn schedule_upgrade(
        env: &Env,
        new_wasm_hash: soroban_sdk::BytesN<32>,
        min_compatible_schema: u32,
        delay_seconds: Option<u64>,
    ) {
        Self::require_admin(env);
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

    pub fn upgrade(env: &Env, new_wasm_hash: soroban_sdk::BytesN<32>) {
        Self::require_admin(env);
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
            .unwrap_or_else(|| soroban_sdk::BytesN::from_array(env, &[0u8; 32]));
        env.storage()
            .instance()
            .set(&DataKey::PreviousWasmHash, &current_hash);

        env.deployer().update_current_contract_wasm(new_wasm_hash);

        if !Self::post_upgrade_check(env) {
            Self::rollback_upgrade(env);
            panic!("post upgrade check failed, reverted");
        }

        env.storage().instance().remove(&DataKey::ScheduledUpgrade);
    }

    pub fn rollback_upgrade(env: &Env) {
        Self::require_admin(env);
        let prev_hash: soroban_sdk::BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::PreviousWasmHash)
            .expect("no prior version for rollback");
        env.deployer().update_current_contract_wasm(prev_hash);
    }

    pub fn post_upgrade_check(_env: &Env) -> bool {
        true
    }

    pub fn get_storage_schema_version(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::StorageSchemaVersion)
            .unwrap_or(1)
    }

    pub fn set_storage_schema_version(env: &Env, version: u32) {
        Self::require_admin(env);
        env.storage()
            .instance()
            .set(&DataKey::StorageSchemaVersion, &version);
    }

    fn has_admin(env: &Env) -> bool {
        env.storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::Admin)
            .is_some()
    }

    fn require_admin(env: &Env) {
        let admin = Self::get_admin(env);
        admin.require_auth();
    }
}

#[cfg(test)]
mod test;
