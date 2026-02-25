#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Env, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Reputation {
    pub skill: i128,
    pub fair_play: i128,
    pub last_update_ts: u64,
}

#[contracttype]
pub enum DataKey {
    Reputation(Address),
    Admin,
    AuthorizedMatchContract,
    AuthorizedAntiCheatOracle,
    DecayRate, // points per day (as i128)
}

#[contract]
pub struct ReputationIndex;

mod events;

#[contractimpl]
impl ReputationIndex {
    /// Initialize the contract
    pub fn initialize(env: Env, admin: Address, match_contract: Address, decay_rate: i128) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::AuthorizedMatchContract, &match_contract);
        env.storage().instance().set(&DataKey::DecayRate, &decay_rate);
    }

    /// Update reputation after a match outcome is finalized.
    /// outcome: skill delta for each player corresponding to the players list.
    pub fn update_on_match(env: Env, match_id: u64, players: Vec<Address>, outcome: Vec<i128>) {
        let match_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::AuthorizedMatchContract)
            .expect("match contract not set");
        
        match_contract.require_auth();

        if players.len() != outcome.len() {
            panic!("players and outcome length mismatch");
        }

        let now = env.ledger().timestamp();

        for i in 0..players.len() {
            let player = players.get(i).unwrap();
            let skill_delta = outcome.get(i).unwrap();
            
            let mut rep = Self::get_reputation(env.clone(), player.clone());
            
            // Apply decay before updating
            rep = Self::internal_apply_decay(&env, rep, now);

            let fair_play_delta = 1i128; // Completion bonus
            
            rep.skill = rep.skill.saturating_add(skill_delta).max(0);
            rep.fair_play = rep.fair_play.saturating_add(fair_play_delta).max(0);
            rep.last_update_ts = now;

            env.storage().persistent().set(&DataKey::Reputation(player.clone()), &rep);

            // Emit reputation_changed event
            events::ReputationChanged {
                player: player.clone(),
                skill_delta,
                fair_play_delta,
                match_id,
            }
            .publish(&env);
        }
    }

    /// Explicitly apply decay to a player's reputation based on a timestamp.
    pub fn apply_decay(env: Env, addr: Address, now_ts: u64) {
        let mut rep = Self::get_reputation(env.clone(), addr.clone());
        let old_skill = rep.skill;
        let old_fair_play = rep.fair_play;
        
        rep = Self::internal_apply_decay(&env, rep, now_ts);
        env.storage().persistent().set(&DataKey::Reputation(addr.clone()), &rep);

        // Emit decay event
        events::ReputationDecayed {
            player: addr,
            skill_decayed: old_skill - rep.skill,
            fair_play_decayed: old_fair_play - rep.fair_play,
        }
        .publish(&env);
    }

    /// Get current reputation for a player.
    pub fn get_reputation(env: Env, addr: Address) -> Reputation {
        env.storage()
            .persistent()
            .get(&DataKey::Reputation(addr))
            .unwrap_or(Reputation {
                skill: 1000,
                fair_play: 100,
                last_update_ts: env.ledger().timestamp(),
            })
    }

    fn internal_apply_decay(env: &Env, mut rep: Reputation, now: u64) -> Reputation {
        let elapsed = now.saturating_sub(rep.last_update_ts);
        if elapsed == 0 {
            return rep;
        }

        let decay_rate: i128 = env.storage().instance().get(&DataKey::DecayRate).unwrap_or(0);
        if decay_rate == 0 {
            return rep;
        }

        // decay_rate is points per day (86400 seconds)
        let decay_amount = (elapsed as i128 * decay_rate) / 86400;
        
        if decay_amount > 0 {
            rep.skill = rep.skill.saturating_sub(decay_amount).max(0);
            rep.fair_play = rep.fair_play.saturating_sub(decay_amount).max(0);
            rep.last_update_ts = now;
        }
        
        rep
    }

    pub fn set_decay_rate(env: Env, admin: Address, new_rate: i128) {
        let saved_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != saved_admin {
            panic!("not admin");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::DecayRate, &new_rate);
    }

    /// Set the authorized anti-cheat oracle contract (admin only). That contract may call
    /// apply_anticheat_penalty to apply bounded fair_play penalties.
    pub fn set_authorized_anticheat_oracle(env: Env, admin: Address, oracle: Address) {
        let saved_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != saved_admin {
            panic!("not admin");
        }
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedAntiCheatOracle, &oracle);
    }

    /// Apply a bounded anti-cheat penalty to a player's fair_play score.
    /// Callable only by the authorized anti-cheat oracle contract. Penalty is capped and
    /// fair_play cannot underflow (floor at 0).
    pub fn apply_anticheat_penalty(
        env: Env,
        oracle: Address,
        player: Address,
        match_id: u64,
        penalty: i128,
    ) {
        oracle.require_auth();
        let authorized: Address = env
            .storage()
            .instance()
            .get(&DataKey::AuthorizedAntiCheatOracle)
            .expect("anticheat oracle not set");
        if oracle != authorized {
            panic!("not authorized anticheat oracle");
        }
        // Cap penalty at a maximum (e.g. 100 per call) to keep penalties bounded
        const MAX_PENALTY_PER_FLAG: i128 = 100;
        let capped = if penalty > MAX_PENALTY_PER_FLAG {
            MAX_PENALTY_PER_FLAG
        } else if penalty < 0 {
            0
        } else {
            penalty
        };
        if capped == 0 {
            return;
        }
        let now = env.ledger().timestamp();
        let mut rep = Self::get_reputation(env.clone(), player.clone());
        rep = Self::internal_apply_decay(&env, rep, now);
        rep.fair_play = rep.fair_play.saturating_sub(capped).max(0);
        rep.last_update_ts = now;
        env.storage()
            .persistent()
            .set(&DataKey::Reputation(player.clone()), &rep);
        events::ReputationChanged {
            player,
            skill_delta: 0,
            fair_play_delta: -(capped as i128),
            match_id,
        }
        .publish(&env);
    }
}

mod test;
