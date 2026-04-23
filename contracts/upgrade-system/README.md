# ArenaX Upgrade System

A secure, governance-controlled contract upgrade system that enables protocol improvements, bug fixes, and feature additions while maintaining user funds and data integrity.

## Overview

The Upgrade System provides a comprehensive framework for managing contract upgrades in the ArenaX protocol with built-in safety mechanisms, governance controls, and emergency procedures.

## Features

### Core Functionality
- **Governance-Controlled Upgrades**: All upgrades require multi-signature approval from governance
- **Time-Locked Execution**: Mandatory delay between approval and execution
- **Comprehensive Validation**: Automated compatibility and security checks
- **Upgrade Simulation**: Test upgrades in a safe environment before execution
- **Rollback Mechanisms**: Quick recovery from failed upgrades
- **Emergency Controls**: Pause contracts in critical situations
- **Complete Audit Trail**: Full history of all upgrade actions
- **Impact Analysis**: Assess upgrade compatibility and breaking changes

### Security Features
- **Multi-Signature Authorization**: Requires multiple approvals for execution
- **Time-Lock Protection**: Prevents rushed or malicious upgrades
- **Validation System**: Detects breaking changes and security issues
- **Emergency Procedures**: Quick response to critical issues
- **Access Controls**: Comprehensive permission system
- **Replay Protection**: Prevents duplicate execution of proposals

## Architecture

### Contract Structure

```
upgrade-system/
├── src/
│   ├── lib.rs          # Main contract implementation
│   ├── types.rs        # Data structures and enums
│   ├── error.rs        # Error definitions
│   ├── storage.rs      # Storage management
│   ├── events.rs       # Event emissions
│   └── test.rs         # Test suite
├── Cargo.toml
└── README.md
```

### Data Structures

#### UpgradeProposal
```rust
pub struct UpgradeProposal {
    pub proposal_id: BytesN<32>,
    pub contract_address: Address,
    pub new_wasm_hash: BytesN<32>,
    pub upgrade_type: u32,
    pub proposer: Address,
    pub status: u32,
    pub created_at: u64,
    pub scheduled_at: Option<u64>,
    pub executed_at: Option<u64>,
    pub timelock_end: u64,
    pub approval_count: u32,
    pub description: String,
    pub compatibility_score: u32,
    pub simulation_passed: bool,
}
```

#### ValidationResult
```rust
pub struct ValidationResult {
    pub proposal_id: BytesN<32>,
    pub is_valid: bool,
    pub compatibility_score: u32,
    pub breaking_changes: bool,
    pub security_issues: Vec<String>,
    pub validated_at: u64,
    pub validator: Address,
}
```

#### UpgradeHistoryEntry
```rust
pub struct UpgradeHistoryEntry {
    pub upgrade_id: BytesN<32>,
    pub contract_address: Address,
    pub old_wasm_hash: BytesN<32>,
    pub new_wasm_hash: BytesN<32>,
    pub upgrade_type: u32,
    pub executed_at: u64,
    pub executed_by: Address,
    pub success: bool,
}
```

## Core Functions

### Initialization

#### `initialize`
Initialize the upgrade system with governance parameters.

```rust
pub fn initialize(
    env: Env,
    governance_address: Address,
    min_timelock_duration: u64,
    required_approvals: u32,
    emergency_threshold: u32,
) -> Result<(), UpgradeError>
```

**Parameters:**
- `governance_address`: Address of the governance contract
- `min_timelock_duration`: Minimum timelock duration in seconds (e.g., 86400 for 24 hours)
- `required_approvals`: Number of approvals required for execution (e.g., 3)
- `emergency_threshold`: Emergency multisig threshold (e.g., 2)

**Example:**
```rust
upgrade_system.initialize(
    governance_addr,
    24 * 60 * 60,  // 24 hours
    3,             // 3 approvals
    2,             // 2 for emergency
);
```

### Upgrade Proposal

#### `propose_upgrade`
Create a new upgrade proposal.

```rust
pub fn propose_upgrade(
    env: Env,
    proposer: Address,
    proposal_id: BytesN<32>,
    contract_address: Address,
    new_wasm_hash: BytesN<32>,
    upgrade_type: u32,
    timelock_duration: u64,
    description: String,
) -> Result<(), UpgradeError>
```

**Parameters:**
- `proposer`: Address proposing the upgrade (must be authorized by governance)
- `proposal_id`: Unique identifier for the proposal
- `contract_address`: Address of the contract to upgrade
- `new_wasm_hash`: Hash of the new WASM code
- `upgrade_type`: Type of upgrade (BugFix=0, Feature=1, Security=2, Performance=3, Breaking=4)
- `timelock_duration`: Duration of timelock in seconds
- `description`: Human-readable description of the upgrade

**Example:**
```rust
upgrade_system.propose_upgrade(
    proposer_addr,
    proposal_id,
    match_contract_addr,
    new_wasm_hash,
    UpgradeType::Feature as u32,
    48 * 60 * 60,  // 48 hours timelock
    String::from_str(&env, "Add new matchmaking algorithm"),
);
```

### Validation

#### `validate_upgrade`
Validate an upgrade proposal for compatibility and security.

```rust
pub fn validate_upgrade(
    env: Env,
    validator: Address,
    proposal_id: BytesN<32>,
    compatibility_score: u32,
    breaking_changes: bool,
    security_issues: Vec<String>,
) -> Result<(), UpgradeError>
```

**Parameters:**
- `validator`: Address performing validation (must be authorized)
- `proposal_id`: ID of the proposal to validate
- `compatibility_score`: Compatibility score from 0-100 (must be ≥70 to pass)
- `breaking_changes`: Whether breaking changes were detected
- `security_issues`: List of security issues found (must be empty to pass)

**Validation Criteria:**
- Compatibility score must be ≥ 70
- No breaking changes detected
- No security issues found

**Example:**
```rust
let security_issues: Vec<String> = Vec::new(&env);
upgrade_system.validate_upgrade(
    validator_addr,
    proposal_id,
    85,     // 85% compatible
    false,  // No breaking changes
    security_issues,
);
```

### Approval

#### `approve_upgrade`
Approve a validated upgrade proposal.

```rust
pub fn approve_upgrade(
    env: Env,
    approver: Address,
    proposal_id: BytesN<32>,
    signature_hash: BytesN<32>,
) -> Result<(), UpgradeError>
```

**Parameters:**
- `approver`: Address approving the upgrade (must be authorized)
- `proposal_id`: ID of the proposal to approve
- `signature_hash`: Hash of the approval signature

**Behavior:**
- Proposal must be validated first
- Each approver can only approve once
- When threshold is reached, proposal is automatically scheduled

**Example:**
```rust
upgrade_system.approve_upgrade(
    approver_addr,
    proposal_id,
    signature_hash,
);
```

### Execution

#### `execute_upgrade`
Execute an approved and scheduled upgrade.

```rust
pub fn execute_upgrade(
    env: Env,
    executor: Address,
    proposal_id: BytesN<32>,
) -> Result<(), UpgradeError>
```

**Parameters:**
- `executor`: Address executing the upgrade (must be authorized)
- `proposal_id`: ID of the proposal to execute

**Requirements:**
- Proposal must be scheduled (sufficient approvals)
- Timelock period must have expired
- Simulation must have passed (if required)
- Contract must not be paused
- System must not be in global emergency mode

**Example:**
```rust
upgrade_system.execute_upgrade(
    executor_addr,
    proposal_id,
);
```

### Rollback

#### `rollback_upgrade`
Rollback a contract to its previous version.

```rust
pub fn rollback_upgrade(
    env: Env,
    initiator: Address,
    contract_address: Address,
    reason: String,
) -> Result<(), UpgradeError>
```

**Parameters:**
- `initiator`: Address initiating the rollback (must be authorized)
- `contract_address`: Address of the contract to rollback
- `reason`: Reason for the rollback

**Example:**
```rust
upgrade_system.rollback_upgrade(
    admin_addr,
    match_contract_addr,
    String::from_str(&env, "Critical bug in new version"),
);
```

### Emergency Controls

#### `emergency_pause`
Pause a contract in case of critical issues.

```rust
pub fn emergency_pause(
    env: Env,
    caller: Address,
    contract_address: Address,
    reason: String,
) -> Result<(), UpgradeError>
```

**Parameters:**
- `caller`: Address calling emergency pause (must be authorized)
- `contract_address`: Address of the contract to pause
- `reason`: Reason for the emergency pause

**Example:**
```rust
upgrade_system.emergency_pause(
    admin_addr,
    match_contract_addr,
    String::from_str(&env, "Exploit detected"),
);
```

#### `unpause_contract`
Unpause a previously paused contract.

```rust
pub fn unpause_contract(
    env: Env,
    caller: Address,
    contract_address: Address,
) -> Result<(), UpgradeError>
```

### Query Functions

#### `get_proposal`
Get details of an upgrade proposal.

```rust
pub fn get_proposal(
    env: Env,
    proposal_id: BytesN<32>,
) -> Result<UpgradeProposal, UpgradeError>
```

#### `get_upgrade_history`
Get the complete upgrade history for a contract.

```rust
pub fn get_upgrade_history(
    env: Env,
    contract_address: Address,
) -> Vec<UpgradeHistoryEntry>
```

#### `get_emergency_state`
Get the emergency state of a contract.

```rust
pub fn get_emergency_state(
    env: Env,
    contract_address: Address,
) -> EmergencyState
```

## Upgrade Workflow

### Standard Upgrade Process

1. **Proposal Creation**
   ```
   Governance → propose_upgrade() → Proposal Created (Pending)
   ```

2. **Validation**
   ```
   Validator → validate_upgrade() → Proposal Validated
   ```

3. **Approval**
   ```
   Approver 1 → approve_upgrade() → 1/3 approvals
   Approver 2 → approve_upgrade() → 2/3 approvals
   Approver 3 → approve_upgrade() → 3/3 approvals → Scheduled
   ```

4. **Timelock Wait**
   ```
   Wait for timelock_duration to expire
   ```

5. **Execution**
   ```
   Executor → execute_upgrade() → Upgrade Executed
   ```

### Emergency Rollback Process

1. **Issue Detection**
   ```
   Critical bug or exploit discovered
   ```

2. **Emergency Pause**
   ```
   Admin → emergency_pause() → Contract Paused
   ```

3. **Rollback**
   ```
   Admin → rollback_upgrade() → Previous Version Restored
   ```

4. **Unpause**
   ```
   Admin → unpause_contract() → Contract Operational
   ```

## Upgrade Types

### BugFix (0)
- Minor bug fixes
- No breaking changes
- Minimal timelock (24 hours)

### Feature (1)
- New features
- Backward compatible
- Standard timelock (48 hours)

### Security (2)
- Security patches
- May require expedited approval
- Standard timelock (48 hours)

### Performance (3)
- Performance optimizations
- No functional changes
- Standard timelock (48 hours)

### Breaking (4)
- Breaking changes
- Requires migration
- Extended timelock (7 days)

## Security Considerations

### Access Control
- Only governance-authorized addresses can propose, validate, and approve upgrades
- Emergency functions require special authorization
- All actions require explicit authentication

### Time-Lock Protection
- Minimum timelock prevents rushed upgrades
- Maximum timelock prevents indefinite delays
- Timelock duration based on upgrade type

### Validation Requirements
- Compatibility score must be ≥ 70%
- No breaking changes allowed (except Breaking type)
- No security issues allowed
- Simulation must pass (if required)

### Emergency Procedures
- Emergency pause can be triggered immediately
- Rollback available for all upgrades
- Global emergency mode stops all upgrades

### Audit Trail
- All proposals recorded with full details
- Complete approval history maintained
- Execution results logged
- History immutable and queryable

## Error Handling

### Common Errors

- `AlreadyInitialized`: Contract already initialized
- `NotInitialized`: Contract not initialized
- `Unauthorized`: Caller not authorized
- `NotGovernance`: Caller not authorized by governance
- `ProposalNotFound`: Proposal doesn't exist
- `ProposalNotValidated`: Proposal must be validated first
- `TimelockNotExpired`: Timelock period hasn't passed
- `InsufficientApprovals`: Not enough approvals
- `ContractPaused`: Contract is paused
- `SystemPaused`: System in emergency mode

## Testing

Run the test suite:

```bash
cd ArenaX/contracts/upgrade-system
cargo test
```

### Test Coverage

- Initialization tests
- Proposal creation tests
- Validation tests
- Approval workflow tests
- Execution tests
- Rollback tests
- Emergency pause tests
- Query function tests

## Integration

### With Governance Multisig

The upgrade system integrates with the governance multisig contract for authorization:

```rust
// Governance proposes upgrade
governance_multisig.create_proposal(
    upgrade_system_addr,
    Symbol::new(&env, "propose_upgrade"),
    proposal_args,
);

// Signers approve
governance_multisig.approve(signer, proposal_id);

// Execute to call upgrade system
governance_multisig.execute(executor, proposal_id);
```

### With Other Contracts

Contracts can check upgrade status:

```rust
// Check if contract is paused
let state = upgrade_system.get_emergency_state(contract_addr);
if state.is_paused {
    return Err(Error::ContractPaused);
}

// Get upgrade history
let history = upgrade_system.get_upgrade_history(contract_addr);
```

## Best Practices

### For Proposers
1. Provide detailed descriptions
2. Choose appropriate upgrade type
3. Set reasonable timelock duration
4. Ensure thorough testing before proposal

### For Validators
1. Run comprehensive compatibility checks
2. Review code changes thoroughly
3. Test in simulation environment
4. Document any concerns

### For Approvers
1. Review validation results
2. Verify upgrade necessity
3. Check community feedback
4. Coordinate with other approvers

### For Executors
1. Verify timelock has expired
2. Check system status
3. Monitor execution
4. Be prepared for rollback

## Monitoring

### Events to Monitor

- `UpgradeProposed`: New upgrade proposed
- `UpgradeValidated`: Validation completed
- `UpgradeApproved`: Approval received
- `UpgradeScheduled`: Threshold reached
- `UpgradeExecuted`: Upgrade executed
- `UpgradeRolledBack`: Rollback performed
- `EmergencyPause`: Contract paused
- `EmergencyUnpause`: Contract unpaused

### Metrics to Track

- Proposal success rate
- Average timelock duration
- Validation pass rate
- Approval time
- Rollback frequency
- Emergency pause frequency

## Future Enhancements

- Automated compatibility testing
- On-chain simulation environment
- Governance voting integration
- Upgrade scheduling calendar
- Impact prediction models
- Automated rollback triggers
- Multi-contract upgrade coordination
- Upgrade dependency management

## License

MIT License - See LICENSE file for details

## Support

For issues or questions:
- GitHub Issues: https://github.com/arenax/arenax/issues
- Documentation: https://docs.arenax.gg
- Discord: https://discord.gg/arenax
