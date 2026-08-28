#![no_std]

use arenax_events::ax_token as events;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol, Vec};

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
    Delegate(Address),
    Delegators(Address),
    DelegationHistory(Address),
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

        let current_balance = Self::balance(env, to.clone());
        let new_balance = current_balance + amount;
        env.storage()
            .instance()
            .set(&DataKey::Balance(to.clone()), &new_balance);

        let current_supply = Self::total_supply(env);
        let new_supply = current_supply + amount;
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &new_supply);

        events::emit_mint(env, &to, amount);
    }

    pub fn burn(env: &Env, from: Address, amount: i128) {
        Self::require_admin(env);

        if amount <= 0 {
            panic!("amount must be positive");
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

        events::emit_burn(env, &from, amount);
    }

    pub fn transfer(env: &Env, from: Address, to: Address, amount: i128) {
        from.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        if from == to {
            panic!("cannot transfer to self");
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

        let voting_power = Self::get_voting_power(env.clone(), voter.clone());

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

        env.events().publish(
            (
                Symbol::new(&env, "ArenaXToken_v1"),
                Symbol::new(&env, "VOTE"),
            ),
            (proposal_id, voter, support, voting_power),
        );
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<Proposal> {
        env.storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
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

        if let Some(previous_delegatee) = previous {
            if previous_delegatee == delegatee {
                panic!("already delegated to this address");
            }
            Self::remove_delegator(&env, &previous_delegatee, &delegator);
        }

        env.storage()
            .instance()
            .set(&DataKey::Delegate(delegator.clone()), &delegatee);
        Self::add_delegator(&env, &delegatee, &delegator);

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

        Self::remove_delegator(&env, &delegatee, &delegator);
        env.storage()
            .instance()
            .remove(&DataKey::Delegate(delegator.clone()));

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

    /// Effective voting power for `address`: their own balance + locked
    /// balance (zero if they've delegated it away) plus the raw power of
    /// every address currently delegating to them. Delegation chains are not
    /// followed further than one hop — a delegatee's received power isn't
    /// forwarded on if they in turn delegate elsewhere.
    pub fn get_voting_power(env: Env, address: Address) -> i128 {
        let has_delegated = Self::get_delegate(env.clone(), address.clone()).is_some();
        let own_power = if has_delegated {
            0
        } else {
            Self::balance(&env, address.clone())
                + Self::get_locked_balance(env.clone(), address.clone())
        };

        let delegators = Self::get_delegators(env.clone(), address.clone());
        let mut delegated_power = 0i128;
        for delegator in delegators.iter() {
            delegated_power += Self::balance(&env, delegator.clone())
                + Self::get_locked_balance(env.clone(), delegator.clone());
        }

        own_power + delegated_power
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
    // Internal Helpers
    // ---------------------------------------------------------------------------

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
