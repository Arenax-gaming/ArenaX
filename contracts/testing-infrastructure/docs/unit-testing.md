# Unit Testing Guide for ArenaX Smart Contracts

## Overview

This guide covers best practices for writing unit tests for ArenaX smart contracts using the Soroban SDK test utilities.

## Test Structure

### Basic Test Template

```rust
#[test]
fn test_function_name() {
    // 1. Setup
    let fixture = TestFixture::new().with_timestamp(1000);
    let contract_id = fixture.env.register(YourContract, ());
    let client = YourContractClient::new(&fixture.env, &contract_id);
    
    // 2. Execute
    let result = client.your_function(&param1, &param2);
    
    // 3. Assert
    assert_eq!(result, expected_value);
}
```

## Test Categories

### 1. Happy Path Tests

Test normal, expected behavior:

```rust
#[test]
fn test_create_match_success() {
    let fixture = TestFixture::new();
    let client = setup_match_contract(&fixture);
    
    let match_id = fixture.generate_match_id();
    client.create_match(&match_id, &fixture.player_a, &fixture.player_b);
    
    let data = client.get_match(&match_id);
    assert_eq!(data.state, MatchState::Created);
}
```

### 2. Error Condition Tests

Test error handling:

```rust
#[test]
#[should_panic(expected = "already exists")]
fn test_create_duplicate_match_fails() {
    let fixture = TestFixture::new();
    let client = setup_match_contract(&fixture);
    
    let match_id = fixture.generate_match_id();
    client.create_match(&match_id, &fixture.player_a, &fixture.player_b);
    client.create_match(&match_id, &fixture.player_a, &fixture.player_b); // Should panic
}
```

### 3. Edge Case Tests

Test boundary conditions:

```rust
#[test]
fn test_zero_stake_amount() {
    let fixture = TestFixture::new();
    let client = setup_escrow_contract(&fixture);
    
    let result = std::panic::catch_unwind(|| {
        client.deposit(&match_id, &player, &0);
    });
    
    assert!(result.is_err());
}
```

### 4. State Transition Tests

Test all valid and invalid state transitions:

```rust
#[test]
fn test_valid_state_transitions() {
    let fixture = TestFixture::new();
    let client = setup_match_contract(&fixture);
    
    // Created -> Started
    client.create_match(&match_id, &player_a, &player_b);
    client.start_match(&match_id);
    assert_eq!(client.get_match(&match_id).state, MatchState::Started);
    
    // Started -> Completed
    client.complete_match(&match_id, &player_a);
    assert_eq!(client.get_match(&match_id).state, MatchState::Completed);
}
```

### 5. Authorization Tests

Test access control:

```rust
#[test]
fn test_unauthorized_access_fails() {
    let fixture = TestFixture::new();
    fixture.env.mock_auths(&[]); // Clear all auths
    
    let client = setup_match_contract(&fixture);
    
    let result = std::panic::catch_unwind(|| {
        client.admin_function(&param);
    });
    
    assert!(result.is_err());
}
```

### 6. Time-Based Tests

Test time-dependent logic:

```rust
#[test]
fn test_match_timeout() {
    let fixture = TestFixture::new().with_timestamp(1000);
    let client = setup_match_contract(&fixture);
    
    client.create_match(&match_id, &player_a, &player_b);
    client.start_match(&match_id);
    
    // Advance time beyond timeout
    fixture.advance_time(3600);
    
    client.timeout_match(&match_id);
    assert_eq!(client.get_match(&match_id).state, MatchState::Timeout);
}
```

## Using Test Utilities

### TestFixture

The `TestFixture` provides common test setup:

```rust
let fixture = TestFixture::new()
    .with_timestamp(1000);

// Access pre-generated addresses
let admin = fixture.admin;
let player_a = fixture.player_a;
let player_b = fixture.player_b;

// Generate match IDs
let match_id = fixture.generate_match_id();

// Advance time
fixture.advance_time(100);
```

### Mock Contracts

Use mock contracts for dependencies:

```rust
use test_utils::mocks::MockIdentityContract;

let identity_id = fixture.env.register(MockIdentityContract, ());
let identity_client = MockIdentityContractClient::new(&fixture.env, &identity_id);
```

### Gas Measurement

Measure gas costs:

```rust
use test_utils::gas::GasMeter;

let meter = GasMeter::start(&fixture.env);
client.expensive_operation(&params);
let gas_report = meter.stop(&fixture.env);

gas_report.print("expensive_operation");
assert!(gas_report.cpu_instructions < 1_000_000);
```

### Event Assertions

Verify events are emitted:

```rust
use test_utils::assertions::assert_event_emitted;

client.create_match(&match_id, &player_a, &player_b);
assert_event_emitted(&fixture.env, "MatchCreated");
```

## Best Practices

### 1. Test Naming

Use descriptive names that explain what is being tested:

```rust
// Good
#[test]
fn test_create_match_with_same_player_fails()

// Bad
#[test]
fn test_match()
```

### 2. Test Independence

Each test should be independent and not rely on other tests:

```rust
// Good - Each test creates its own fixture
#[test]
fn test_a() {
    let fixture = TestFixture::new();
    // ...
}

#[test]
fn test_b() {
    let fixture = TestFixture::new();
    // ...
}
```

### 3. Arrange-Act-Assert Pattern

Structure tests clearly:

```rust
#[test]
fn test_example() {
    // Arrange
    let fixture = TestFixture::new();
    let client = setup_contract(&fixture);
    
    // Act
    let result = client.function(&params);
    
    // Assert
    assert_eq!(result, expected);
}
```

### 4. Test One Thing

Each test should verify one specific behavior:

```rust
// Good - Tests one specific scenario
#[test]
fn test_complete_match_updates_winner()

// Bad - Tests multiple things
#[test]
fn test_match_lifecycle()
```

### 5. Use Meaningful Assertions

Provide context in assertion messages:

```rust
assert_eq!(
    actual_state,
    expected_state,
    "Match state should be Completed after calling complete_match"
);
```

## Coverage Requirements

- Minimum 95% line coverage
- All public functions tested
- All error conditions tested
- All state transitions tested
- All edge cases documented and tested

## Running Tests

```bash
# Run all unit tests
cargo test --workspace --lib

# Run tests for specific contract
cargo test -p match-contract

# Run specific test
cargo test test_create_match_success

# Run with output
cargo test -- --nocapture

# Run with coverage
cargo tarpaulin --workspace
```

## Common Patterns

### Testing Panics

```rust
#[test]
#[should_panic(expected = "error message")]
fn test_function_panics() {
    // Code that should panic
}
```

### Testing Results

```rust
#[test]
fn test_function_returns_error() {
    let result = function_that_returns_result();
    assert!(result.is_err());
}
```

### Testing with Multiple Scenarios

```rust
#[test]
fn test_multiple_scenarios() {
    let scenarios = vec![
        (input1, expected1),
        (input2, expected2),
        (input3, expected3),
    ];
    
    for (input, expected) in scenarios {
        let result = function(input);
        assert_eq!(result, expected);
    }
}
```

## Debugging Tests

### Print Debug Information

```rust
#[test]
fn test_with_debug() {
    let result = function();
    println!("Result: {:?}", result);
    assert_eq!(result, expected);
}
```

### Use Test Helpers

```rust
fn setup_test_environment() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);
    (env, player_a, player_b)
}
```

## Resources

- [Soroban Testing Documentation](https://soroban.stellar.org/docs/testing)
- [Rust Testing Guide](https://doc.rust-lang.org/book/ch11-00-testing.html)
- [Test-Driven Development](https://en.wikipedia.org/wiki/Test-driven_development)
