# Slashing & Penalty Enforcement Engine

A Soroban smart contract responsible for enforcing penalties and slashing actions against players, referees, or system actors who violate ArenaX rules.

## Overview

This contract provides credible, irreversible consequences for:
- Cheating
- Collusion
- Match fixing
- Referee misconduct
- Protocol abuse

The Slashing Contract is triggered only by authorized actors (backend authority, dispute resolution workflow, or governance multisig) and executes deterministic penalties such as stake slashing, reward confiscation, temporary suspension, or permanent bans.

## Features

- **Deterministic Penalty Enforcement**: Stake slashing, reward confiscation, suspensions, and bans
- **Role-Based Access Control**: Integration with Identity Contract for authorization
- **Irreversible Permanent Bans**: Once executed, permanent bans cannot be reversed
- **Evidence-Based Case Management**: All cases linked to off-chain evidence via hash
- **Integration with Escrow Vault**: Financial penalties reference escrowed funds
- **Comprehensive Event Emission**: All actions emit events for transparency and auditability
- **Double Execution Protection**: Each case can only be executed once
- **Adversarial Design**: Assumes hostile inputs and enforces strict validation

## Data Types

### SlashCase
```rust
pub struct SlashCase {
    pub case_id: BytesN<32>,        // Unique case identifier
    pub subject: Address,            // Accused party
    pub initiator: Address,          // Who opened the case
    pub reason_code: u32,            // Violation type code
    pub evidence_hash: BytesN<32>,   // Hash of off-chain evidence
    pub status: u32,                 // Case status (Proposed/Approved/Executed/Cancelled)
    pub created_at: u64,             // Timestamp of case creation
    pub resolved_at: Option<u64>,    // Timestamp of resolution
}
```

### Penalty
```rust
pub struct Penalty {
    pub penalty_type: u32,           // Type of penalty (0-3)
    pub amount: Option<i128>,        // Amount for financial penalties
    pub asset: Option<Address>,      // Asset address for financial penalties
    pub duration: Option<u64>,       // Duration for temporary suspensions
}
```

### BanRecord
```rust
pub struct BanRecord {
    pub subject: Address,            // Banned address
    pub case_id: BytesN<32>,         // Associated case ID
    pub banned_at: u64,              // Ban timestamp
    pub is_permanent: bool,          // Whether ban is permanent
    pub expires_at: Option<u64>,     // Expiration for temporary bans
}
```

## Enums

### PenaltyType
- `0` = StakeSlash - Slash staked funds
- `1` = RewardConfiscation - Confiscate earned rewards
- `2` = TemporarySuspension - Temporary ban with expiration
- `3` = PermanentBan - Irreversible permanent ban

### SlashStatus
- `0` = Proposed - Case opened, awaiting approval
- `1` = Approved - Case approved, ready for execution
- `2` = Executed - Penalty has been executed
- `3` = Cancelled - Case cancelled before execution

## Core Functions

### Initialization

#### `initialize(admin: Address)`
Initialize the contract with an admin address.

**Requirements:**
- Contract must not be already initialized
- Caller must provide authentication

### Configuration

#### `set_identity_contract(identity_contract: Address)`
Set the Identity Contract address for role verification.

**Requirements:**
- Caller must be admin

#### `set_escrow_contract(escrow_contract: Address)`
Set the Escrow Contract address for fund slashing.

**Requirements:**
- Caller must be admin

### Case Management

#### `open_case(case_id: BytesN<32>, subject: Address, reason_code: u32, evidence_hash: BytesN<32>)`
Open a new slashing case against a subject.

**Requirements:**
- Caller must have Admin or System role
- Case ID must be unique
- Subject must not be permanently banned

**Events:** `CaseOpened`

#### `approve_case(case_id: BytesN<32>)`
Approve a slashing case for execution.

**Requirements:**
- Caller must have Admin or System role
- Case must exist and be in Proposed status

**Events:** `CaseApproved`

#### `execute_penalty(case_id: BytesN<32>, penalty_type: u32, amount: Option<i128>, asset: Option<Address>, duration: Option<u64>)`
Execute a penalty against the subject of an approved case.

**Requirements:**
- Caller must have Admin or System role
- Case must be approved
- Case must not have been executed already
- Penalty parameters must be valid for the penalty type

**Events:** `PenaltyExecuted`

**Penalty-Specific Requirements:**
- **StakeSlash (0)**: Requires `amount` and `asset`, calls escrow contract
- **RewardConfiscation (1)**: Requires `amount` and `asset`, calls escrow contract
- **TemporarySuspension (2)**: Requires `duration` > 0
- **PermanentBan (3)**: No additional parameters required

#### `cancel_case(case_id: BytesN<32>)`
Cancel a proposed case before approval.

**Requirements:**
- Caller must be admin
- Case must be in Proposed status

**Events:** `CaseCancelled`

### Query Functions

#### `get_case(case_id: BytesN<32>) -> SlashCase`
Get case details by case ID.

#### `is_banned(subject: Address) -> bool`
Check if an address is currently banned (temporary or permanent).

#### `is_case_executed(case_id: BytesN<32>) -> bool`
Check if a case has been executed.

#### `get_ban_record(subject: Address) -> Option<BanRecord>`
Get ban record for a subject if they are banned.

## Core Invariants

1. **No slashing without approved case**: Cases must be approved before execution
2. **Each case executed once**: Double execution protection prevents re-execution
3. **Permanent bans are irreversible**: Once executed, permanent bans cannot be undone
4. **Financial penalties reference escrowed funds**: Stake slashing and reward confiscation integrate with Escrow Contract
5. **All actions emit events**: Complete audit trail through event emission

## Security Considerations

### Adversarial Design
This contract assumes hostile inputs and enforces strict validation:
- All inputs are validated before processing
- Authorization checks on every privileged operation
- State transitions are strictly controlled
- Financial operations require escrow contract integration

### Access Control
- **Admin**: Full control over contract configuration and case cancellation
- **System Role**: Can open and approve cases (via Identity Contract)
- **Governance**: Can approve cases (via Identity Contract)

### Irreversibility
- Permanent bans cannot be reversed
- Executed cases cannot be re-executed
- Evidence hashes provide verifiable linkage to off-chain forensic data

## Integration

### Identity Contract
The contract integrates with the Identity Contract to verify roles:
```rust
get_role(user: Address) -> u32
```

Expected roles:
- `0` = Player
- `1` = Referee
- `2` = Admin
- `3` = System

### Escrow Contract
The contract integrates with the Escrow Vault Contract for financial penalties:
```rust
slash_stake(subject: Address, amount: i128, asset: Address)
confiscate_reward(subject: Address, amount: i128, asset: Address)
```

## Events

All events are emitted for transparency and auditability:

- `init` - Contract initialized
- `id_set` - Identity contract set
- `esc_set` - Escrow contract set
- `case_open` - Case opened
- `approved` - Case approved
- `executed` - Penalty executed
- `canceled` - Case cancelled
- `slashed` - Stake slashed
- `confisct` - Reward confiscated
- `suspend` - Temporary suspension applied
- `perma_bn` - Permanent ban applied

## Testing

The contract includes comprehensive tests covering:

### Initialization Tests
- Successful initialization
- Double initialization prevention
- Contract configuration

### Case Management Tests
- Opening cases
- Duplicate case prevention
- Case approval
- Case cancellation
- Invalid state transitions

### Penalty Execution Tests
- Permanent ban execution
- Temporary suspension execution
- Financial penalty execution
- Invalid penalty type handling
- Double execution protection

### Ban Status Tests
- Ban status queries
- Ban record retrieval
- Temporary ban expiration

### Edge Case Tests
- Multiple cases for different users
- Complete case workflow
- Reason code preservation
- Banned user case prevention

## Build & Deploy

### Build
```bash
cargo build --package slashing_contract --target wasm32-unknown-unknown --release
```

### Test
```bash
cargo test --package slashing_contract
```

### Format
```bash
cargo fmt --package slashing_contract
```

### Output
The optimized WASM binary is approximately 18KB.

## Example Usage

```rust
// Initialize contract
contract.initialize(&admin);

// Set dependencies
contract.set_identity_contract(&identity_contract_addr);
contract.set_escrow_contract(&escrow_contract_addr);

// Open a case for cheating
let case_id = BytesN::from_array(&env, &[1u8; 32]);
let evidence_hash = BytesN::from_array(&env, &[2u8; 32]);
contract.open_case(&case_id, &cheater_addr, &100, &evidence_hash);

// Approve the case
contract.approve_case(&case_id);

// Execute permanent ban
contract.execute_penalty(
    &case_id,
    &3, // PermanentBan
    &None,
    &None,
    &None,
);

// Check if user is banned
let is_banned = contract.is_banned(&cheater_addr); // true
```

## Reason Codes

Suggested reason codes (can be customized):
- `100` - Cheating
- `200` - Collusion
- `300` - Match fixing
- `400` - Referee misconduct
- `500` - Protocol abuse

## License

MIT

## Authors

ArenaX Team <dev@arenax.gg>
