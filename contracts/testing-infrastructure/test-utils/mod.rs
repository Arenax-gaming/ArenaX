/// Shared testing utilities for ArenaX smart contracts
use soroban_sdk::{Address, BytesN, Env};

/// Test fixture builder for common test scenarios
pub struct TestFixture {
    pub env: Env,
    pub admin: Address,
    pub player_a: Address,
    pub player_b: Address,
    pub referee: Address,
}

impl TestFixture {
    pub fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        
        Self {
            admin: Address::generate(&env),
            player_a: Address::generate(&env),
            player_b: Address::generate(&env),
            referee: Address::generate(&env),
            env,
        }
    }

    pub fn with_timestamp(mut self, timestamp: u64) -> Self {
        self.env.ledger().set_timestamp(timestamp);
        self
    }

    pub fn advance_time(&self, seconds: u64) {
        let current = self.env.ledger().timestamp();
        self.env.ledger().set_timestamp(current + seconds);
    }

    pub fn generate_match_id(&self) -> BytesN<32> {
        BytesN::random(&self.env)
    }
}

impl Default for TestFixture {
    fn default() -> Self {
        Self::new()
    }
}

/// Mock contract helpers
pub mod mocks {
    use soroban_sdk::{contract, contractimpl, Address, Env};

    #[contract]
    pub struct MockIdentityContract;

    #[contractimpl]
    impl MockIdentityContract {
        pub fn get_role(_env: Env, _user: Address) -> u32 {
            2 // Default role
        }

        pub fn is_verified(_env: Env, _user: Address) -> bool {
            true
        }
    }

    #[contract]
    pub struct MockTokenContract;

    #[contractimpl]
    impl MockTokenContract {
        pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) -> bool {
            true
        }

        pub fn balance(_env: Env, _user: Address) -> i128 {
            1_000_000
        }
    }

    #[contract]
    pub struct MockOracleContract;

    #[contractimpl]
    impl MockOracleContract {
        pub fn verify_result(_env: Env, _match_id: BytesN<32>, _result: u32) -> bool {
            true
        }
    }
}

/// Assertion helpers
pub mod assertions {
    use soroban_sdk::Env;

    pub fn assert_event_emitted(env: &Env, event_name: &str) {
        let events = env.events().all();
        assert!(
            events.iter().any(|e| {
                e.topics.iter().any(|t| {
                    if let Ok(s) = t.try_into_val::<String>(env) {
                        s.to_string() == event_name
                    } else {
                        false
                    }
                })
            }),
            "Event '{}' was not emitted",
            event_name
        );
    }

    pub fn assert_error_contains(result: Result<(), soroban_sdk::Error>, expected: &str) {
        match result {
            Err(e) => {
                let error_msg = format!("{:?}", e);
                assert!(
                    error_msg.contains(expected),
                    "Expected error containing '{}', got '{}'",
                    expected,
                    error_msg
                );
            }
            Ok(_) => panic!("Expected error containing '{}', but got Ok", expected),
        }
    }
}

/// Gas measurement utilities
pub mod gas {
    use soroban_sdk::Env;

    pub struct GasMeter {
        start_cpu: u64,
        start_mem: u64,
    }

    impl GasMeter {
        pub fn start(env: &Env) -> Self {
            Self {
                start_cpu: env.budget().cpu_instruction_cost(),
                start_mem: env.budget().memory_bytes_cost(),
            }
        }

        pub fn stop(&self, env: &Env) -> GasReport {
            GasReport {
                cpu_instructions: env.budget().cpu_instruction_cost() - self.start_cpu,
                memory_bytes: env.budget().memory_bytes_cost() - self.start_mem,
            }
        }
    }

    pub struct GasReport {
        pub cpu_instructions: u64,
        pub memory_bytes: u64,
    }

    impl GasReport {
        pub fn print(&self, operation: &str) {
            println!(
                "Gas Report for {}: CPU={}, Memory={}",
                operation, self.cpu_instructions, self.memory_bytes
            );
        }
    }
}

/// Property-based testing generators
pub mod generators {
    use soroban_sdk::{Address, BytesN, Env};

    pub fn gen_address(env: &Env) -> Address {
        Address::generate(env)
    }

    pub fn gen_match_id(env: &Env) -> BytesN<32> {
        BytesN::random(env)
    }

    pub fn gen_amount(min: i128, max: i128) -> i128 {
        use std::time::{SystemTime, UNIX_EPOCH};
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos() as i128;
        min + (seed % (max - min + 1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fixture_creation() {
        let fixture = TestFixture::new();
        assert!(fixture.env.ledger().timestamp() >= 0);
    }

    #[test]
    fn test_time_advancement() {
        let fixture = TestFixture::new().with_timestamp(1000);
        assert_eq!(fixture.env.ledger().timestamp(), 1000);
        
        fixture.advance_time(500);
        assert_eq!(fixture.env.ledger().timestamp(), 1500);
    }
}
