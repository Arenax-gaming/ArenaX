# ArenaX Token Contract

A SEP-41 compliant token implementation for the ArenaX gaming platform built on Stellar's Soroban smart contract platform.

## Overview

The ArenaX Token is the native utility token for the ArenaX platform, enabling:
- In-platform rewards and payments
- Tournament prize distributions
- Staking rewards
- Governance participation (via voting power based on staked tokens)

## Features

### Token Standards
- **SEP-41 Compliant**: Implements the standard Soroban token interface
- **Compatible**: Works with all Soroban-based applications and wallets
- **Events**: Emits standard token events for transparency

### Core Functionality

#### Minting (Admin Only)
```rust
pub fn mint(env: Env, to: Address, amount: i128)
```
- Creates new tokens and sends them to a specified address
- Only callable by the contract admin
- Emits a `MintEvent`

#### Burning
```rust
pub fn burn(env: Env, from: Address, amount: i128)
pub fn burn_from(env: Env, spender: Address, from: Address, amount: i128)
```
- Destroys tokens permanently
- `burn`: Requires authorization from token owner
- `burn_from`: Uses allowance mechanism
- Emits a `BurnEvent`

#### Transfers
```rust
pub fn transfer(env: Env, from: Address, to: Address, amount: i128)
pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128)
```
- Transfers tokens between addresses
- `transfer_from` uses the allowance mechanism
- Emits a `TransferEvent`

#### Approvals
```rust
pub fn approve(env: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32)
pub fn allowance(env: Env, from: Address, spender: Address) -> i128
```
- Grants spending permission to another address
- Supports expiration via ledger number
- Expired allowances automatically return 0
- Emits an `ApproveEvent`

#### Metadata
```rust
pub fn name(env: Env) -> String
pub fn symbol(env: Env) -> String
pub fn decimals(env: Env) -> u32
```
- Returns token name, symbol, and decimal precision
- Set during initialization (immutable)

#### Administration
```rust
pub fn admin(env: Env) -> Address
pub fn set_admin(env: Env, new_admin: Address)
```
- View and update contract admin
- Only current admin can transfer admin rights
- Emits a `SetAdminEvent`

## Token Specification

- **Name**: ArenaX Token
- **Symbol**: ARENA
- **Decimals**: 7 (configurable, max 18)
- **Initial Supply**: Determined by admin minting
- **Max Supply**: Unlimited (controlled by admin)

## Contract Architecture

The contract is organized into modular components:

```
arenax-token/
├── src/
│   ├── lib.rs           # Main entry point
│   ├── contract.rs      # Core contract logic
│   ├── admin.rs         # Admin management
│   ├── balance.rs       # Balance tracking
│   ├── allowance.rs     # Allowance management
│   ├── metadata.rs      # Token metadata
│   ├── event.rs         # Event emissions
│   ├── storage_types.rs # Storage data structures
│   └── test.rs          # Comprehensive test suite
└── Cargo.toml
```

## Testing

The contract includes comprehensive tests covering:
- Initialization
- Minting
- Transfers (success and failure cases)
- Allowance and approval mechanisms
- Burning (with and without allowance)
- Admin management
- Decimal validation
- Allowance expiration
- Negative amount validation

Run tests with:
```bash
cargo test
```

## Usage Example

### Initialization
```rust
let token = ArenaXTokenClient::new(&env, &contract_id);
token.initialize(
    &admin,
    &7,                                    // decimals
    &String::from_str(&env, "ArenaX Token"),
    &String::from_str(&env, "ARENA"),
);
```

### Minting Tokens
```rust
// Admin mints 1000 tokens to user
token.mint(&user, &1_000_0000000); // 1000 * 10^7
```

### Transferring Tokens
```rust
// Direct transfer
token.transfer(&from, &to, &500_0000000);

// Approve and transfer from
token.approve(&owner, &spender, &1000_0000000, &expiration_ledger);
token.transfer_from(&spender, &owner, &recipient, &500_0000000);
```

### Burning Tokens
```rust
// Burn own tokens
token.burn(&owner, &100_0000000);

// Burn using allowance
token.burn_from(&spender, &owner, &50_0000000);
```

## Integration

### With Escrow Contract
The ArenaX token can be used with the escrow contract for tournament prize pools and secure payments.

### With Staking Contract
Users can stake ArenaX tokens to earn rewards and gain voting power.

### With Tournament Manager
Tokens are used for entry fees and prize distributions.

## Security Features

- **Authorization**: All sensitive operations require proper authentication
- **Validation**: Amounts and parameters are validated before execution
- **Allowance Expiration**: Prevents stale approvals from being exploited
- **Balance Checks**: Ensures sufficient balance before transfers/burns
- **Admin Controls**: Minting restricted to admin only
- **Storage Lifetime**: Proper TTL management for persistent data

## Events

All major operations emit events for transparency:
- `TransferEvent`: Token transfers
- `MintEvent`: Token creation
- `BurnEvent`: Token destruction
- `ApproveEvent`: Allowance approvals
- `SetAdminEvent`: Admin changes
