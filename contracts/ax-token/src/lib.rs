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
        };
        env.storage()
            .instance()
            .set(&DataKey::Vesting(beneficiary.clone()), &schedule);

        env.events().publish(
            (
                Symbol::new(&env, "ArenaXToken_v1"),
                Symbol::new(&env, "VESTING_CREATE"),
            ),
            (beneficiary, total_amount),
        );
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

        let elapsed = current_time.saturating_sub(schedule.start_time);
        let vested_amount = if elapsed >= schedule.duration {
            schedule.total_amount
        } else {
            schedule.total_amount * (elapsed as i128) / (schedule.duration as i128)
        };

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

        let mut voting_power = Self::balance(&env, voter.clone());
        voting_power += Self::get_locked_balance(env.clone(), voter.clone());

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
