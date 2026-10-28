#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MatchOutcome {
    pub match_id: BytesN<32>,
    pub winner: Address,
    pub score_a: i64,
    pub score_b: i64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Outcome(BytesN<32>),
}

#[contract]
pub struct MatchOutcomeContract;

#[contractimpl]
impl MatchOutcomeContract {
    pub fn log_outcome(
        env: Env,
        match_id: BytesN<32>,
        winner: Address,
        score_a: i64,
        score_b: i64,
    ) -> MatchOutcome {
        let key = DataKey::Outcome(match_id.clone());
        if env.storage().instance().has(&key) {
            return env.storage().instance().get(&key).unwrap();
        }

        let outcome = MatchOutcome {
            match_id,
            winner,
            score_a,
            score_b,
            timestamp: env.ledger().timestamp(),
        };
        env.storage().instance().set(&key, &outcome);
        outcome
    }

    pub fn get_outcome(env: Env, match_id: BytesN<32>) -> Option<MatchOutcome> {
        env.storage().instance().get(&DataKey::Outcome(match_id))
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn logs_and_retrieves_outcome() {
        let env = Env::default();
        let contract_id = env.register(MatchOutcomeContract, ());
        let client = MatchOutcomeContractClient::new(&env, &contract_id);
        let match_id = BytesN::from_array(&env, &[7_u8; 32]);
        let winner = Address::generate(&env);

        let outcome = client.log_outcome(&match_id, &winner, &10, &7);
        assert_eq!(client.get_outcome(&match_id), Some(outcome.clone()));

        // Repeated writes return the original record.
        let repeated = client.log_outcome(&match_id, &winner, &0, &0);
        assert_eq!(repeated, outcome);
    }
}
