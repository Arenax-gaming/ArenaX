# ArenaX Token (AX) - Phase 1 Complete ✅

The native utility and governance token for the ArenaX gaming platform.

## 🎯 Overview

The AX Token is a Soroban smart contract implementing a standard token with:
- **Controlled Supply**: Maximum supply cap enforced at contract level
- **Standard Token Interface**: Mint, burn, transfer, approve/transferFrom
- **Role-Based Access**: Admin-controlled minting with treasury management
- **Security**: Overflow protection, authorization checks, comprehensive events

## 📊 Token Specifications

| Property | Value |
|----------|-------|
| **Name** | ArenaX Token |
| **Symbol** | AX |
| **Decimals** | 7 (Stellar standard) |
| **Max Supply** | 1,000,000,000 AX (configurable) |
| **Initial Supply** | 0 (minted as needed) |

## 🏗️ Architecture

### Storage Structure

```rust
DataKey::Admin              // Contract administrator (governance multisig)
DataKey::Balance(Address)   // Token balance per address
DataKey::Allowance(owner, spender)  // Spending allowances
DataKey::TotalSupply        // Current circulating supply
DataKey::MaxSupply          // Maximum supply cap (immutable)
DataKey::Treasury           // Treasury address for fees/slashing
DataKey::TokenInfo          // Token metadata (name, symbol, decimals)
```

### Core Functions

#### Initialization
```rust
initialize(admin: Address, max_supply: i128, treasury: Address)
```
- Sets up the token contract with admin and treasury
- Defines maximum supply cap
- Can only be called once

#### Minting (Admin Only)
```rust
mint(to: Address, amount: i128)
```
- Creates new tokens up to max supply
- Requires admin authorization
- Emits `Minted` event

#### Burning
```rust
burn(from: Address, amount: i128)
```
- Destroys tokens, reducing total supply
- Requires authorization from token holder
- Emits `Burned` event

#### Transfer
```rust
transfer(from: Address, to: Address, amount: i128)
```
- Transfers tokens between addresses
- Requires authorization from sender
- Emits `Transferred` event

#### Approve/TransferFrom
```rust
approve(owner: Address, spender: Address, amount: i128)
transfer_from(spender: Address, from: Address, to: Address, amount: i128)
```
- Standard allowance pattern for third-party transfers
- Used by StakingManager for tournament entry fees
- Emits `Approved` and `Transferred` events

### Query Functions (View Only)

```rust
balance(addr: Address) -> i128
allowance(owner: Address, spender: Address) -> i128
total_supply() -> i128
max_supply() -> i128
token_info() -> TokenInfo
admin() -> Address
treasury() -> Address
```

## 🧪 Testing

### Run Unit Tests
```bash
cargo test --manifest-path contracts/ax-token/Cargo.toml
```

### Test Results
✅ **29 tests passed**
- Initialization tests (3)
- Minting tests (5)
- Burning tests (4)
- Transfer tests (5)
- Approve/TransferFrom tests (3)
- Admin tests (2)
- Query tests (2)
- Complex scenario tests (5)

### Test Coverage
- ✅ Positive cases (normal operations)
- ✅ Negative cases (insufficient balance, unauthorized access)
- ✅ Edge cases (zero amounts, self-transfers, max supply)
- ✅ Complex flows (multi-step operations)

## 🚀 Deployment

### Prerequisites
```bash
# Install Soroban CLI
cargo install --locked soroban-cli

# Configure Stellar testnet
soroban network add testnet \
  --rpc-url https://soroban-testnet.stellar.org:443 \
  --network-passphrase "Test SDF Network ; September 2015"

# Create or import identity
soroban keys generate default
```

### Deploy to Testnet
```bash
cd contracts/ax-token

# Deploy and initialize
./deploy.sh

# Or with custom parameters
MAX_SUPPLY=5000000000000000 TREASURY_ADDRESS=GXXX... ./deploy.sh
```

### Test Deployment
```bash
# Test minting
./test-mint.sh

# Test transfers
TO_ADDRESS=GXXX... ./test-transfer.sh
```

## 📝 Deployment Output

After successful deployment, you'll get:
- Contract ID (save this for backend integration)
- Admin address
- Treasury address
- Deployment info saved to `deployment-testnet.json`

Example:
```json
{
  "network": "testnet",
  "contract_id": "CAXXX...",
  "admin": "GXXX...",
  "treasury": "GXXX...",
  "max_supply": "10000000000000000",
  "deployed_at": "2024-03-25T14:30:00Z"
}
```

## 🔐 Security Features

### Authorization Checks
- ✅ Admin-only minting
- ✅ Sender authorization for transfers
- ✅ Owner authorization for approvals
- ✅ Spender authorization for transferFrom

### Overflow Protection
- ✅ Checked arithmetic operations
- ✅ Balance overflow prevention
- ✅ Supply overflow prevention
- ✅ Max supply enforcement

### Input Validation
- ✅ Positive amount checks
- ✅ Self-transfer prevention
- ✅ Sufficient balance checks
- ✅ Sufficient allowance checks

### Event Emission
All state changes emit events for transparency:
- `Minted(to, amount, new_total_supply)`
- `Burned(from, amount, new_total_supply)`
- `Transferred(from, to, amount)`
- `Approved(owner, spender, amount)`
- `AdminChanged(old_admin, new_admin)`
- `TreasurySet(treasury)`

## 🔗 Integration with StakingManager

The AX Token is designed to work seamlessly with the StakingManager contract:

1. **Tournament Entry**: Players approve StakingManager to spend tokens
2. **Staking**: StakingManager calls `transfer_from` to lock tokens
3. **Unlocking**: StakingManager transfers tokens back to players
4. **Slashing**: StakingManager transfers slashed tokens to treasury

Example flow:
```rust
// Player approves StakingManager
ax_token.approve(player, staking_manager, entry_fee);

// StakingManager locks tokens
ax_token.transfer_from(staking_manager, player, staking_manager, entry_fee);

// After tournament: unlock or slash
ax_token.transfer(staking_manager, player, amount); // unlock
ax_token.transfer(staking_manager, treasury, amount); // slash
```

## 📊 Token Economics

### Supply Management
- **Initial Supply**: 0 tokens
- **Max Supply**: 1 billion AX (configurable)
- **Minting**: Controlled by governance multisig
- **Burning**: Any holder can burn their tokens

### Use Cases
1. **Tournament Entry Fees**: Stake AX to enter tournaments
2. **Prize Pools**: Winners receive AX tokens
3. **Platform Fees**: Small percentage for platform operations
4. **Governance**: Future voting rights (Phase 3)
5. **Staking Rewards**: Incentivize platform participation

## 🛠️ Development

### Build Contract
```bash
cargo build --manifest-path contracts/ax-token/Cargo.toml \
  --target wasm32-unknown-unknown --release
```

### Run Tests
```bash
cargo test --manifest-path contracts/ax-token/Cargo.toml
```

### Check Code
```bash
cargo clippy --manifest-path contracts/ax-token/Cargo.toml
cargo fmt --manifest-path contracts/ax-token/Cargo.toml
```

## 📋 Phase 1 Checklist ✅

- [x] Token storage and data structures
- [x] Mint/burn/transfer functions
- [x] Approve/transferFrom (allowance pattern)
- [x] Authorization checks
- [x] Max supply enforcement
- [x] Comprehensive unit tests (29 tests)
- [x] Deployment scripts
- [x] Test scripts (mint, transfer)
- [x] Documentation

## 🔜 Next Steps (Phase 2)

1. **StakingManager Contract**
   - Lock tokens for tournament entry
   - Implement unlock conditions
   - Add slashing mechanism
   - Role-based access control

2. **Backend Integration**
   - Add AX token contract address to config
   - Implement token balance queries
   - Handle minting for rewards
   - Monitor token events

3. **Testing**
   - Integration tests with StakingManager
   - End-to-end tournament flow
   - Load testing for concurrent operations

## 📚 Resources

- [Soroban Documentation](https://soroban.stellar.org/docs)
- [Stellar Network](https://stellar.org)
- [ArenaX Documentation](../../README.md)

## 🤝 Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development guidelines.

---

**Phase 1 Status**: ✅ Complete
**Contract Version**: 0.1.0
**Last Updated**: March 25, 2024
