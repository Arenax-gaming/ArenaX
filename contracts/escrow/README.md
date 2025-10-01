# ArenaX Escrow Smart Contract

A sophisticated escrow contract for ArenaX tournament funds, providing secure fund holding, dispute resolution, and automatic release mechanisms using the Stellar blockchain.

## Features

### Core Functionality
- **Multi-signature Fund Holding**: Secure escrow with depositor, beneficiary, and arbitrator roles
- **Dispute Resolution System**: Comprehensive arbitration mechanism with multiple resolution options
- **Automatic Release Conditions**: Time-locked transactions with configurable release conditions
- **Fund Recovery Mechanisms**: Emergency recovery functions for edge cases
- **Event Emission**: Comprehensive event logging for transparency and monitoring

### Security Features
- **Role-based Access Control**: Strict authorization for all operations
- **State Management**: Robust state transitions with validation
- **Arbitrator Validation**: Only pre-approved arbitrators can resolve disputes
- **Emergency Recovery**: Admin-controlled recovery mechanism for exceptional cases

## Contract Architecture

### States
- `Created` (0): Escrow created, waiting for deposits
- `Funded` (1): Funds deposited, waiting for conditions
- `Disputed` (2): Dispute has been raised
- `Released` (3): Funds released to beneficiary
- `Refunded` (4): Funds refunded to depositor
- `Cancelled` (5): Escrow cancelled

### Dispute Resolution
- `None` (0): No dispute
- `Pending` (1): Dispute raised, waiting for arbitration
- `Resolved` (2): Dispute resolved

### Arbitration Decisions
- `Pending` (0): Decision pending
- `FavorDepositor` (1): Full refund to depositor
- `FavorBeneficiary` (2): Full release to beneficiary
- `PartialSplit` (3): Split funds between parties
- `RejectDispute` (4): Dispute rejected, return to funded state

## Usage

### Initialization
```rust
// Initialize contract with admin
escrow_client.initialize(&admin);

// Add arbitrators
escrow_client.add_arbitrator(&admin, &arbitrator);
```

### Creating Escrow
```rust
let escrow_id = escrow_client.create_escrow(
    &depositor,
    &beneficiary,
    &arbitrator,
    &amount,
    &token_address,
    &release_conditions,
    &dispute_timeout,
    &auto_release_time,
);
```

### Depositing Funds
```rust
escrow_client.deposit_funds(&escrow_id, &depositor);
```

### Releasing Funds
```rust
// Manual release by depositor or arbitrator
escrow_client.release_funds(&escrow_id, &releaser);

// Auto-release when conditions are met
escrow_client.check_auto_release(&escrow_id);
```

### Refunding Funds
```rust
escrow_client.refund_funds(&escrow_id, &refunder);
```

### Dispute Resolution
```rust
// Raise dispute
escrow_client.raise_dispute(&escrow_id, &disputer, &reason);

// Resolve dispute (arbitrator only)
escrow_client.resolve_dispute(
    &escrow_id,
    &arbitrator,
    &decision,
    &depositor_amount,
    &beneficiary_amount,
    &reason,
);
```

## Events

The contract emits comprehensive events for all major operations:

- `EscrowCreated`: New escrow created
- `FundsDeposited`: Funds deposited into escrow
- `FundsReleased`: Funds released to beneficiary
- `FundsRefunded`: Funds refunded to depositor
- `DisputeRaised`: Dispute raised
- `DisputeResolved`: Dispute resolved by arbitrator
- `AutoReleased`: Funds auto-released
- `EmergencyRecovery`: Emergency recovery executed
- `ArbitratorAdded`: New arbitrator added
- `ArbitratorRemoved`: Arbitrator removed

## Security Considerations

### Access Control
- Only designated depositor can deposit funds
- Only depositor or arbitrator can release/refund funds
- Only depositor or beneficiary can raise disputes
- Only designated arbitrator can resolve disputes
- Only admin can perform emergency recovery

### Validation
- All state transitions are validated
- Arbitrators must be pre-approved
- Amounts must be positive
- Time constraints are enforced
- Dispute resolution requires proper authorization

### Gas Optimization
- Efficient storage patterns
- Minimal state reads/writes
- Event emission optimized
- Batch operations where possible

## Integration with Tournaments

The escrow contract is designed to integrate seamlessly with the ArenaX tournament system:

1. **Tournament Registration**: Entry fees held in escrow
2. **Prize Distribution**: Automatic release to winners
3. **Dispute Handling**: Tournament-related disputes resolved by arbitrators
4. **Cancellation Handling**: Automatic refunds when tournaments are cancelled

## Testing

Comprehensive test suite covering:
- Contract initialization and configuration
- Escrow creation and funding
- Fund release and refund scenarios
- Dispute resolution workflows
- Auto-release mechanisms
- Emergency recovery procedures
- Edge cases and error conditions

Run tests with:
```bash
cargo test
```

## Deployment

1. Build the contract:
```bash
cargo build --target wasm32-unknown-unknown --release
```

2. Deploy to Stellar network using Soroban CLI

3. Initialize with admin address

4. Add trusted arbitrators

## License

MIT License - see LICENSE file for details.

## Support

For support and questions, contact the ArenaX development team.
