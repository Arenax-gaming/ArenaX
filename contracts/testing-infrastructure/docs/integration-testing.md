# Integration Testing Guide for ArenaX Smart Contracts

## Overview

Integration tests verify that multiple contracts work correctly together. This guide covers testing cross-contract interactions and complete workflows.

## Integration Test Structure

### Basic Integration Test

```rust
#[test]
fn test_cross_contract_interaction() {
    // 1. Setup environment
    let env = Env::default();
    env.mock_all_auths();
    
    // 2. Register all contracts
    let contract_a_id = env.register(ContractA, ());
    let contract_b_id = env.register(ContractB, ());
    
    // 3. Create clients
    let client_a = ContractAClient::new(&env, &contract_a_id);
    let client_b = ContractBClient::new(&env, &contract_b_id);
    
    // 4. Execute workflow
    client_a.function_that_calls_b(&contract_b_id, &params);
    
    // 5. Verify results
    let result = client_b.get_state();
    assert_eq!(result, expected);
}
```

## Common Integration Scenarios

### 1. Match with Escrow

Test complete match flow with token escrow:

```rust
#[test]
fn test_match_with_escrow_integration() {
    let env = Env::default();
    env.mock_all_auths();
    
    // Register contracts
    let match_id = env.register(MatchContract, ());
    let escrow_id = env.register(EscrowContract, ());
    let token_id = env.register(TokenContract, ());
    
    let match_client = MatchContractClient::new(&env, &match_id);
    let escrow_client = EscrowContractClient::new(&env, &escrow_id);
    let token_client = TokenContractClient::new(&env, &token_id);
    
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);
    let match_id_val = BytesN::from_array(&env, &[1u8; 32]);
    let stake = 1000i128;
    
    // 1. Players deposit stake
    token_client.transfer(&player_a, &escrow_id, &stake);
    token_client.transfer(&player_b, &escrow_id, &stake);
    escrow_client.deposit(&match_id_val, &player_a, &stake);
    escrow_client.deposit(&match_id_val, &player_b, &stake);
    
    // 2. Create and play match
    match_client.create_match(&match_id_val, &player_a, &player_b);
    match_client.start_match(&match_id_val);
    match_client.complete_match(&match_id_val, &player_a);
    
    // 3. Distribute winnings
    escrow_client.distribute(&match_id_val, &player_a);
    
    // 4. Verify balances
    let winner_balance = token_client.balance(&player_a);
    assert_eq!(winner_balance, stake * 2);
}
```

### 2. Dispute Resolution Flow

Test dispute handling across contracts:

```rust
#[test]
fn test_dispute_resolution_integration() {
    let env = Env::default();
    env.mock_all_auths();
    
    let match_id = env.register(MatchContract, ());
    let dispute_id = env.register(DisputeContract, ());
    let oracle_id = env.register(OracleContract, ());
    
    // Create match
    // Raise dispute
    // Submit evidence
    // Oracle verification
    // Resolve dispute
    // Verify final state
}
```

### 3. Tournament System

Test multi-match tournament:

```rust
#[test]
fn test_tournament_integration() {
    let env = Env::default();
    env.mock_all_auths();
    
    let tournament_id = env.register(TournamentContract, ());
    let match_id = env.register(MatchContract, ());
    let escrow_id = env.register(EscrowContract, ());
    
    // Create tournament
    // Generate bracket
    // Play all rounds
    // Finalize and distribute prizes
}
```

### 4. Staking and Reputation

Test staking impact on reputation:

```rust
#[test]
fn test_staking_reputation_integration() {
    let env = Env::default();
    env.mock_all_auths();
    
    let staking_id = env.register(StakingContract, ());
    let reputation_id = env.register(ReputationContract, ());
    let match_id = env.register(MatchContract, ());
    
    // Stake tokens
    // Play matches
    // Verify reputation boost from staking
    // Unstake and verify rewards
}
```

### 5. Governance and Parameters

Test governance affecting protocol parameters:

```rust
#[test]
fn test_governance_params_integration() {
    let env = Env::default();
    env.mock_all_auths();
    
    let governance_id = env.register(GovernanceContract, ());
    let params_id = env.register(ProtocolParamsContract, ());
    
    // Propose parameter change
    // Vote on proposal
    // Execute proposal
    // Verify parameters updated
}
```

## Testing Patterns

### Contract Registry Pattern

Use a registry to manage contract addresses:

```rust
#[test]
fn test_with_registry() {
    let env = Env::default();
    env.mock_all_auths();
    
    let registry_id = env.register(ContractRegistry, ());
    let registry_client = ContractRegistryClient::new(&env, &registry_id);
    
    // Register all contracts
    registry_client.register("match", &match_id);
    registry_client.register("escrow", &escrow_id);
    
    // Contracts can lookup each other
    let escrow_addr = registry_client.lookup("escrow");
}
```

### Event-Driven Testing

Verify events across contracts:

```rust
#[test]
fn test_event_propagation() {
    let env = Env::default();
    env.mock_all_auths();
    
    // Perform action in contract A
    client_a.action();
    
    // Verify event emitted
    let events = env.events().all();
    assert!(events.len() > 0);
    
    // Verify contract B reacted to event
    let state_b = client_b.get_state();
    assert_eq!(state_b, expected);
}
```

### Error Propagation Testing

Test error handling across contracts:

```rust
#[test]
fn test_error_propagation() {
    let env = Env::default();
    env.mock_all_auths();
    
    // Setup contracts where B depends on A
    
    // Make A fail
    let result = std::panic::catch_unwind(|| {
        client_b.function_that_calls_a();
    });
    
    // Verify error propagated correctly
    assert!(result.is_err());
}
```

## Testing Workflows

### Complete User Journey

Test end-to-end user experience:

```rust
#[test]
fn test_complete_user_journey() {
    let env = Env::default();
    env.mock_all_auths();
    
    // Setup all contracts
    
    let user = Address::generate(&env);
    
    // 1. User registers
    auth_client.register(&user);
    
    // 2. User stakes tokens
    staking_client.stake(&user, &10000);
    
    // 3. User creates match
    match_client.create_match(&match_id, &user, &opponent);
    
    // 4. Match is played
    match_client.start_match(&match_id);
    match_client.complete_match(&match_id, &user);
    
    // 5. Reputation updated
    let reputation = reputation_client.get_reputation(&user);
    assert!(reputation > initial_reputation);
    
    // 6. Rewards claimed
    staking_client.claim_rewards(&user);
}
```

### Upgrade Scenario

Test contract upgrades:

```rust
#[test]
fn test_upgrade_scenario() {
    let env = Env::default();
    env.mock_all_auths();
    
    // Deploy v1
    let contract_v1_id = env.register(ContractV1, ());
    
    // Use v1
    let client_v1 = ContractV1Client::new(&env, &contract_v1_id);
    client_v1.function();
    
    // Upgrade to v2
    let contract_v2_id = env.register(ContractV2, ());
    upgrade_client.upgrade(&contract_v1_id, &contract_v2_id);
    
    // Verify v2 works and state migrated
    let client_v2 = ContractV2Client::new(&env, &contract_v2_id);
    let state = client_v2.get_state();
    assert_eq!(state, expected_migrated_state);
}
```

## Performance Testing

### Load Testing

Test system under load:

```rust
#[test]
fn test_concurrent_matches() {
    let env = Env::default();
    env.mock_all_auths();
    
    let match_client = setup_match_contract(&env);
    
    // Create many matches concurrently
    for i in 0..1000 {
        let match_id = BytesN::from_array(&env, &[i as u8; 32]);
        let player_a = Address::generate(&env);
        let player_b = Address::generate(&env);
        
        match_client.create_match(&match_id, &player_a, &player_b);
    }
    
    // Verify system still responsive
    let test_match_id = BytesN::from_array(&env, &[0u8; 32]);
    let data = match_client.get_match(&test_match_id);
    assert!(data.is_some());
}
```

### Gas Cost Analysis

Measure gas for complete workflows:

```rust
#[test]
fn test_workflow_gas_costs() {
    let env = Env::default();
    env.mock_all_auths();
    
    // Setup contracts
    
    let start_cpu = env.budget().cpu_instruction_cost();
    let start_mem = env.budget().memory_bytes_cost();
    
    // Execute complete workflow
    execute_complete_workflow(&env);
    
    let cpu_used = env.budget().cpu_instruction_cost() - start_cpu;
    let mem_used = env.budget().memory_bytes_cost() - start_mem;
    
    println!("Workflow gas: CPU={}, Memory={}", cpu_used, mem_used);
    
    // Assert within acceptable limits
    assert!(cpu_used < MAX_CPU_LIMIT);
    assert!(mem_used < MAX_MEM_LIMIT);
}
```

## Best Practices

### 1. Test Real Workflows

Focus on actual user workflows, not just technical interactions:

```rust
// Good - Tests real user scenario
#[test]
fn test_player_joins_tournament_and_wins()

// Less useful - Tests technical detail
#[test]
fn test_contract_a_calls_contract_b()
```

### 2. Minimize Test Setup

Use helper functions to reduce boilerplate:

```rust
fn setup_gaming_environment(env: &Env) -> GamingEnvironment {
    let match_id = env.register(MatchContract, ());
    let escrow_id = env.register(EscrowContract, ());
    let token_id = env.register(TokenContract, ());
    
    GamingEnvironment {
        match_client: MatchContractClient::new(env, &match_id),
        escrow_client: EscrowContractClient::new(env, &escrow_id),
        token_client: TokenContractClient::new(env, &token_id),
    }
}
```

### 3. Test Failure Scenarios

Test what happens when contracts fail:

```rust
#[test]
fn test_escrow_failure_rolls_back_match() {
    // Setup where escrow will fail
    // Attempt match creation
    // Verify match was not created
}
```

### 4. Verify State Consistency

Ensure all contracts have consistent state:

```rust
#[test]
fn test_state_consistency_across_contracts() {
    // Perform operations
    
    // Verify all contracts agree on state
    let match_state = match_client.get_match(&match_id);
    let escrow_state = escrow_client.get_escrow(&match_id);
    
    assert_eq!(match_state.player_a, escrow_state.player_a);
}
```

## Running Integration Tests

```bash
# Run all integration tests
cargo test --test integration_tests

# Run specific integration test
cargo test test_match_with_escrow_integration

# Run with output
cargo test --test integration_tests -- --nocapture

# Run with timing
cargo test --test integration_tests -- --show-output --test-threads=1
```

## Debugging Integration Tests

### Add Logging

```rust
#[test]
fn test_with_logging() {
    let env = Env::default();
    env.mock_all_auths();
    
    println!("Step 1: Creating match");
    match_client.create_match(&match_id, &player_a, &player_b);
    
    println!("Step 2: Depositing to escrow");
    escrow_client.deposit(&match_id, &player_a, &stake);
    
    println!("Step 3: Starting match");
    match_client.start_match(&match_id);
}
```

### Inspect Events

```rust
#[test]
fn test_with_event_inspection() {
    let env = Env::default();
    env.mock_all_auths();
    
    // Perform operations
    
    // Inspect all events
    let events = env.events().all();
    for event in events.iter() {
        println!("Event: {:?}", event);
    }
}
```

## Resources

- [Soroban Cross-Contract Calls](https://soroban.stellar.org/docs/cross-contract)
- [Integration Testing Best Practices](https://martinfowler.com/bliki/IntegrationTest.html)
