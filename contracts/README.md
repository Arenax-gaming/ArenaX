<<<<<<< HEAD
# 🌟 ArenaX Stellar Smart Contracts

## Overview

The ArenaX contracts workspace contains **Soroban smart contracts** for the ArenaX gaming platform. Currently includes a working example contract and documentation for planned contract implementations.

## Current Implementation

### 📝 Example Contract
A simple demonstration contract showing basic Soroban functionality:
- Contract initialization with admin setup
- Basic storage operations
- Simple greeting function
- Unit tests for all functions

**Location**: `src/example.rs`

## Planned Contract Implementations

### 🏆 Prize Distribution Contract (To Be Implemented)

**Purpose**: Automated tournament prize pool management and distribution

**Planned Functionality**:
- Create and manage tournament prize pools
- Escrow entry fees in XLM or ArenaX Tokens
- Automatically distribute prizes to winners
- Handle refunds for cancelled tournaments
- Multi-signature security for large prize pools

**Planned Functions**:
```rust
// Create a new tournament prize pool
pub fn create_prize_pool(tournament_id: u64, entry_fee: i128, max_participants: u32)

// Add entry fee to prize pool
pub fn add_entry_fee(tournament_id: u64, participant: Address, amount: i128)

// Distribute prizes to winners
pub fn distribute_prizes(tournament_id: u64, winners: Vec<Address>, amounts: Vec<i128>)

// Refund entry fees
pub fn refund_entry_fees(tournament_id: u64)
```

### 🏅 Reputation Management Contract (To Be Implemented)

**Purpose**: Track player reputation and fairness on-chain

**Planned Functionality**:
- Issue Reputation Tokens to players
- Update reputation based on match outcomes
- Apply penalties for disputes and cheating
- Track reputation history on-chain
- Enable reputation-based tournament access

**Planned Functions**:
```rust
// Issue initial reputation to new player
pub fn issue_reputation(player: Address, initial_amount: i128)

// Update reputation after match
pub fn update_reputation(player: Address, change: i128, reason: String)

// Apply penalty for cheating
pub fn apply_penalty(player: Address, penalty_amount: i128, reason: String)

// Get current reputation balance
pub fn get_reputation(player: Address) -> i128
```

### 💰 ArenaX Token Contract (To Be Implemented)

**Purpose**: In-platform reward and payment token

**Planned Functionality**:
- Issue ArenaX Tokens for platform rewards
- Enable token transfers and payments
- Integrate with Stellar DEX for conversions
- Implement token burning and minting
- Support tournament entry fees

**Planned Functions**:
```rust
// Mint new ArenaX Tokens
pub fn mint(to: Address, amount: i128)

// Burn ArenaX Tokens
pub fn burn(from: Address, amount: i128)

// Transfer tokens
pub fn transfer(from: Address, to: Address, amount: i128)

// Approve token spending
pub fn approve(from: Address, spender: Address, amount: i128)
```

### 🏟️ Tournament Manager Contract (To Be Implemented)

**Purpose**: Tournament lifecycle and state management

**Planned Functionality**:
- Create and manage tournament instances
- Handle tournament state transitions (upcoming → ongoing → completed)
- Manage participant registration and validation
- Track tournament metadata and settings
- Integrate with prize distribution and reputation contracts

**Planned Functions**:
```rust
// Create a new tournament
pub fn create_tournament(admin: Address, config: TournamentConfig) -> u64

// Register participant in tournament
pub fn register_participant(tournament_id: u64, participant: Address, entry_fee: i128)

// Update tournament state
pub fn update_tournament_state(tournament_id: u64, new_state: TournamentState)

// Get tournament details
pub fn get_tournament(tournament_id: u64) -> TournamentInfo

// Validate tournament completion
pub fn complete_tournament(tournament_id: u64, winners: Vec<Address>)
```

### 🔧 Shared Utilities Contract (To Be Implemented)

**Purpose**: Common utilities and data types shared across contracts

**Planned Functionality**:
- Common data structures and enums
- Utility functions for address validation
- Shared error types and constants
- Helper functions for Stellar operations
- Cross-contract communication utilities

**Planned Functions**:
```rust
// Validate Stellar address
pub fn validate_address(address: Address) -> bool

// Common error types
pub enum ArenaXError { ... }

// Shared data structures
pub struct TournamentConfig { ... }
pub struct MatchResult { ... }
pub struct PrizeDistribution { ... }
```

## Project Structure

```
contracts/
├── example/                # Example contract (working implementation)
│   ├── src/
│   │   ├── lib.rs         # Example contract implementation
│   │   └── test.rs        # Example contract tests
│   └── Cargo.toml         # Example contract dependencies
├── prize-distribution/     # Prize pool and payout automation (to be implemented)
│   ├── src/
│   │   ├── lib.rs         # Prize distribution contract
│   │   └── test.rs        # Prize distribution tests
│   └── Cargo.toml         # Prize distribution dependencies
├── reputation/             # Player reputation tracking (to be implemented)
│   ├── src/
│   │   ├── lib.rs         # Reputation management contract
│   │   └── test.rs        # Reputation tests
│   └── Cargo.toml         # Reputation dependencies
├── arenax-token/           # ArenaX Token management (to be implemented)
│   ├── src/
│   │   ├── lib.rs         # ArenaX Token contract
│   │   └── test.rs        # Token tests
│   └── Cargo.toml         # Token dependencies
├── tournament-manager/     # Tournament lifecycle management (to be implemented)
│   ├── src/
│   │   ├── lib.rs         # Tournament manager contract
│   │   └── test.rs        # Tournament manager tests
│   └── Cargo.toml         # Tournament manager dependencies
├── shared/                 # Shared utilities and types (to be implemented)
│   ├── src/
│   │   ├── lib.rs         # Shared utilities
│   │   └── types.rs       # Common data types
│   └── Cargo.toml         # Shared dependencies
├── Cargo.toml              # Workspace configuration
└── README.md               # This documentation
```

## Tech Stack

- **Smart Contract Language**: Rust (Soroban)
- **Stellar Network**: Stellar blockchain
- **Contract Framework**: Soroban SDK
- **Testing**: Stellar testnet
- **Deployment**: Stellar CLI

## Setup & Development

### Prerequisites
- Rust toolchain
- Stellar CLI
- Soroban SDK
- Stellar testnet account

### Installation

```bash
# Clone the repository
git clone https://github.com/arenax/arenax.git
cd contracts

# Install Soroban CLI
cargo install --locked soroban-cli

# Install dependencies
cargo build

# Set up Stellar testnet
soroban config network add testnet \
  --rpc-url https://soroban-testnet.stellar.org:443 \
  --network-passphrase "Test SDF Network ; September 2015"
```

### Development Commands

```bash
# Build all contracts in the workspace
cargo build --target wasm32-unknown-unknown --release

# Build specific contract
cargo build --target wasm32-unknown-unknown --release --package example
cargo build --target wasm32-unknown-unknown --release --package prize-distribution
cargo build --target wasm32-unknown-unknown --release --package reputation
cargo build --target wasm32-unknown-unknown --release --package arenax-token
cargo build --target wasm32-unknown-unknown --release --package tournament-manager
cargo build --target wasm32-unknown-unknown --release --package shared

# Run all tests
cargo test

# Run tests for specific contract
cargo test --package example
cargo test --package prize-distribution
cargo test --package reputation
cargo test --package arenax-token
cargo test --package tournament-manager
cargo test --package shared

# Run specific test
cargo test --package example test_greet

# Check code formatting
cargo fmt

# Run linter
cargo clippy
```

### Testing Individual Contracts

```bash
# Example contract (working implementation)
cargo test --package example
cargo test --package example test_initialize
cargo test --package example test_greet

# Prize distribution contract (to be implemented)
cargo test --package prize-distribution

# Reputation contract (to be implemented)
cargo test --package reputation

# ArenaX Token contract (to be implemented)
cargo test --package arenax-token

# Tournament manager contract (to be implemented)
cargo test --package tournament-manager

# Shared utilities contract (to be implemented)
cargo test --package shared
```

## Environment Configuration

```bash
# Set Stellar network
export STELLAR_NETWORK=testnet
export STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# Set contract admin keys
export ADMIN_SECRET_KEY=SBXXX...
export ADMIN_PUBLIC_KEY=GXXX...
```

## Development Workflow

### Building Contracts
```bash
# Build all contracts
cargo build --target wasm32-unknown-unknown --release

# Build with optimizations for deployment
cargo build --target wasm32-unknown-unknown --release --profile release
```

### Testing
```bash
# Run unit tests
cargo test

# Run tests with output
cargo test -- --nocapture

# Test specific module
cargo test example
```

### Deployment

```bash
# Deploy example contract to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/example.wasm \
  --source-account admin \
  --network testnet

# Deploy prize distribution contract to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/prize_distribution.wasm \
  --source-account admin \
  --network testnet

# Deploy reputation contract to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/reputation.wasm \
  --source-account admin \
  --network testnet

# Deploy ArenaX token contract to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/arenax_token.wasm \
  --source-account admin \
  --network testnet

# Deploy tournament manager contract to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/tournament_manager.wasm \
  --source-account admin \
  --network testnet

# Deploy shared utilities contract to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/shared.wasm \
  --source-account admin \
  --network testnet
```

## Integration with Backend

The ArenaX backend will integrate with these contracts through the Stellar Rust SDK:

### Contract Interaction Flow

```rust
// 1. Initialize shared utilities and token contracts
let shared_client = ContractClient::new(&stellar_client, &shared_contract_id);
let token_client = ContractClient::new(&stellar_client, &arenax_token_contract_id);

// 2. Create tournament with tournament manager
let tournament_client = ContractClient::new(&stellar_client, &tournament_contract_id);
let tournament_id = tournament_client.call(
    "create_tournament",
    &[admin_address, tournament_config]
).await?;

// 3. Register participants and collect entry fees
tournament_client.call(
    "register_participant",
    &[tournament_id, participant_address, entry_fee]
).await?;

// 4. Create prize pool with prize distribution contract
let prize_client = ContractClient::new(&stellar_client, &prize_contract_id);
prize_client.call(
    "create_prize_pool",
    &[tournament_id, total_entry_fees, participant_count]
).await?;

// 5. Update reputation after match completion
let reputation_client = ContractClient::new(&stellar_client, &reputation_contract_id);
reputation_client.call(
    "update_reputation",
    &[player_address, reputation_change, "match_won"]
).await?;

// 6. Distribute prizes to winners
prize_client.call(
    "distribute_prizes",
    &[tournament_id, winners_list, prize_amounts]
).await?;
```

### Cross-Contract Communication

The contracts are designed to work together:
- **Tournament Manager** coordinates tournament lifecycle
- **Prize Distribution** manages prize pools and payouts
- **Reputation** tracks player fairness and skill
- **ArenaX Token** handles in-platform rewards and payments
- **Shared Utilities** provides common functionality across all contracts

## Security Considerations

### Access Control
- Admin-only functions for critical operations
- Player-specific functions with proper authorization
- Role-based access control for contract functions

### Audit Trail
- All contract operations are logged on-chain
- Immutable transaction history
- Transparent operations

## Gas Optimization

### Efficient Storage
- Optimize data structures for minimal storage costs
- Use packed data types where possible
- Implement efficient data access patterns

### Batch Operations
- Group multiple operations in single transactions
- Minimize contract calls for better performance
- Optimize for Stellar network fees

## Contributing

### Development Guidelines
1. Follow Rust best practices
2. Write comprehensive tests
3. Document all public functions
4. Ensure security best practices
5. Optimize for gas efficiency

### Adding New Contracts
1. Create new module in `src/`
2. Add module to `lib.rs`
3. Write comprehensive tests
4. Update this README
5. Follow the example contract pattern

## Support

For Stellar smart contract development:
- Check Soroban documentation
- Review Stellar developer resources
- Contact the development team

---

**Note**: This workspace currently contains a working example contract. The planned contracts (Prize Distribution, Reputation Management, and ArenaX Token) are documented but not yet implemented.
=======
# ArenaX Smart Contracts

This directory contains the Stellar smart contracts for the ArenaX gaming platform.

## Contracts

### Example Contract

A basic smart contract demonstrating core Soroban SDK functionality:

- Contract initialization
- Persistent storage
- Event emission
- Authentication
- Unit testing

#### Features

- **Greeting System**: Store and retrieve personalized greeting messages
- **Counter**: Simple incrementing counter with persistence
- **Admin Management**: Contract administration functions
- **Events**: Proper event emission for all state changes

#### Development

```bash
# Build the contract
cd contracts
cargo build --target wasm32-unknown-unknown --release

# Run tests
cargo test
```

#### Deployment

The contract can be deployed to Stellar testnet using the Soroban CLI:

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/example_contract.wasm \
  --source <your-secret-key> \
  --network testnet
```

## Architecture

All contracts follow these principles:

- **Security First**: All functions include proper authorization checks
- **Event Driven**: State changes emit events for off-chain monitoring
- **Storage Efficient**: Optimized storage usage with proper data structures
- **Testable**: Comprehensive unit tests for all functionality
>>>>>>> upstream/main
