# Contract Composition and Modularity

## Overview

The ArenaX contract architecture is now built with **composition and modularity** as first-class citizens. This guide explains how to use the standardized interfaces and reusable utilities.

## Standardized Interfaces

We've created a `contract-standards` crate that defines reusable trait interfaces for common functionality:

### `Ownable`
For contracts that have an administrator/owner
```rust
pub trait Ownable {
    fn owner(env: &Env) -> Address;
    fn transfer_ownership(env: &Env, new_owner: Address);
}
```

### `Pausable`
For contracts that can pause/resume operations
```rust
pub trait Pausable {
    fn is_paused(env: &Env) -> bool;
    fn set_paused(env: &Env, paused: bool);
}
```

### Additional Traits
- `Upgradable`: For upgradeable contract proxies
- `RoleBasedAccess`: For role-based access control
- `TimeLockable`: For time-locked function calls
- `EmergencyStoppable`: For emergency stop functionality

## Reusable Utilities

The `contract-utils` crate provides common utilities:

### `storage`
```rust
use contract_utils::storage;
storage::extend_persistent_ttl(&env, &key, 1000, 10000);
storage::extend_instance_ttl(&env, 1000, 10000);
```

### `time`
```rust
use contract_utils::time;
let now = time::now(&env);
if time::is_past(&env, timestamp) { ... }
```

## Composable Example Contract

The `composable-example` contract demonstrates how to use these interfaces together! It:
1. Implements `Ownable` (ownership management)
2. Implements `Pausable` (pause/resume functionality)
3. Uses `contract-utils` for storage and time operations

## Usage in Your Own Contracts

### Step 1: Add Dependencies
In your `Cargo.toml`:
```toml
[dependencies]
contract-standards = { path = "../contract-standards" }
contract-utils = { path = "../contract-utils" }
```

### Step 2: Define Your Contract and Data Keys
```rust
#[contracttype]
enum DataKey {
    Owner,
    Paused,
    YourData,
}
```

### Step 3: Implement the Traits
Use the provided macros or implement manually!

## Composition Patterns

### 1. Plugin Architecture
Deploy specialized contracts independently and have them communicate via cross-contract calls.
- Each contract has a single responsibility
- Contracts reference each other via their addresses
- e.g.: match contract + escrow contract + reputation contract

### 2. Proxy Pattern
Use a proxy contract to:
- Separate data and logic
- Allow contract upgrades without losing data
- Route calls to the current implementation

### 3. Mix and Match
Mix and match the standardized traits in your contracts! e.g., a contract can be both `Ownable` and `Pausable`.
