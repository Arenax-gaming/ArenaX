# ArenaX Escrow Contract Integration Guide

This guide provides comprehensive instructions for integrating the ArenaX Escrow Contract with the tournament system and other ArenaX components.

## Overview

The ArenaX Escrow Contract provides secure fund holding, dispute resolution, and automatic release mechanisms for tournament funds. It integrates seamlessly with the ArenaX tournament system to ensure fair and transparent handling of entry fees, prizes, and disputes.

## Architecture Integration

### Core Components

1. **Escrow Contract**: Main smart contract handling fund escrow
2. **Tournament Manager**: Manages tournament lifecycle and participant registration
3. **Token System**: Handles Stellar asset transfers
4. **Arbitration System**: Provides dispute resolution capabilities

### Integration Points

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Tournament    │───▶│   Escrow         │───▶│   Token         │
│   Manager       │    │   Contract       │    │   System        │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Participant   │    │   Arbitrator     │    │   Prize Pool    │
│   Registration  │    │   Resolution     │    │   Distribution  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Integration Workflows

### 1. Tournament Registration with Escrow

#### Backend Integration

```rust
// Tournament registration with escrow creation
pub async fn register_participant_with_escrow(
    tournament_id: u64,
    participant_address: String,
    entry_fee: i128,
) -> Result<u64, ApiError> {
    // 1. Validate tournament and participant
    let tournament = get_tournament(tournament_id).await?;
    validate_participant_registration(&tournament, &participant_address).await?;
    
    // 2. Create escrow for entry fee
    let escrow_id = escrow_client.create_escrow(
        &participant_address,
        &tournament.prize_pool_address,
        &tournament.arbitrator_address,
        &entry_fee,
        &tournament.token_address,
        &format!("Tournament {} entry fee", tournament_id),
        &tournament.dispute_timeout,
        &tournament.auto_release_time,
    ).await?;
    
    // 3. Update tournament with escrow reference
    update_tournament_escrow(tournament_id, escrow_id).await?;
    
    Ok(escrow_id)
}
```

#### Frontend Integration

```typescript
// Frontend escrow creation
export const createTournamentEscrow = async (
  tournamentId: number,
  entryFee: number
): Promise<{ escrowId: number; depositTx: string }> => {
  try {
    // 1. Get tournament details
    const tournament = await getTournament(tournamentId);
    
    // 2. Create escrow contract call
    const escrowTx = await escrowContract.create_escrow({
      depositor: userWallet.address,
      beneficiary: tournament.prizePoolAddress,
      arbitrator: tournament.arbitratorAddress,
      amount: entryFee,
      token_address: tournament.tokenAddress,
      release_conditions: `Tournament ${tournamentId} completion`,
      dispute_timeout: tournament.disputeTimeout,
      auto_release_time: tournament.autoReleaseTime,
    });
    
    // 3. Submit transaction
    const depositTx = await escrowContract.deposit_funds({
      escrow_id: escrowTx.escrowId,
    });
    
    return {
      escrowId: escrowTx.escrowId,
      depositTx: depositTx.hash,
    };
  } catch (error) {
    throw new Error(`Escrow creation failed: ${error.message}`);
  }
};
```

### 2. Tournament Completion and Prize Distribution

#### Automated Prize Distribution

```rust
// Tournament completion with automatic prize distribution
pub async fn complete_tournament_with_escrow(
    tournament_id: u64,
    winners: Vec<TournamentWinner>,
) -> Result<(), ApiError> {
    let tournament = get_tournament(tournament_id).await?;
    let escrow_ids = get_tournament_escrows(tournament_id).await?;
    
    // Release all escrows to enable prize distribution
    for escrow_id in escrow_ids {
        escrow_client.release_funds(&escrow_id, &tournament.arbitrator_address).await?;
    }
    
    // Distribute prizes from released funds
    distribute_prizes(tournament_id, winners).await?;
    
    Ok(())
}
```

### 3. Dispute Resolution Integration

#### Dispute Creation

```rust
// Create dispute for tournament-related issues
pub async fn create_tournament_dispute(
    tournament_id: u64,
    escrow_id: u64,
    disputer_address: String,
    dispute_type: DisputeType,
    evidence: String,
) -> Result<(), ApiError> {
    let reason = format!(
        "Tournament {} dispute: {} - Evidence: {}",
        tournament_id, dispute_type, evidence
    );
    
    escrow_client.raise_dispute(&escrow_id, &disputer_address, &reason).await?;
    
    // Notify arbitrators
    notify_arbitrators(tournament_id, escrow_id, dispute_type).await?;
    
    Ok(())
}
```

#### Arbitration Resolution

```rust
// Resolve dispute with tournament context
pub async fn resolve_tournament_dispute(
    tournament_id: u64,
    escrow_id: u64,
    arbitrator_address: String,
    decision: ArbitrationDecision,
    evidence_review: String,
) -> Result<(), ApiError> {
    let (arbitration_decision, depositor_amount, beneficiary_amount) = 
        match decision {
            ArbitrationDecision::FavorDepositor => (1, get_escrow_amount(escrow_id), 0),
            ArbitrationDecision::FavorBeneficiary => (2, 0, get_escrow_amount(escrow_id)),
            ArbitrationDecision::PartialSplit(depositor_share) => {
                let total = get_escrow_amount(escrow_id);
                (3, depositor_share, total - depositor_share)
            },
            ArbitrationDecision::RejectDispute => (4, 0, 0),
        };
    
    escrow_client.resolve_dispute(
        &escrow_id,
        &arbitrator_address,
        &arbitration_decision,
        &depositor_amount,
        &beneficiary_amount,
        &evidence_review,
    ).await?;
    
    // Update tournament dispute records
    update_tournament_dispute_record(tournament_id, escrow_id, decision).await?;
    
    Ok(())
}
```

### 4. Event Monitoring and Notifications

#### Event Listener Setup

```typescript
// Event monitoring for escrow activities
export class EscrowEventMonitor {
  private escrowContract: EscrowContract;
  
  constructor(escrowContract: EscrowContract) {
    this.escrowContract = escrowContract;
    this.setupEventListeners();
  }
  
  private setupEventListeners() {
    // Monitor escrow creation
    this.escrowContract.addEventListener('EscrowCreated', (event) => {
      this.handleEscrowCreated(event);
    });
    
    // Monitor fund deposits
    this.escrowContract.addEventListener('FundsDeposited', (event) => {
      this.handleFundsDeposited(event);
    });
    
    // Monitor disputes
    this.escrowContract.addEventListener('DisputeRaised', (event) => {
      this.handleDisputeRaised(event);
    });
    
    // Monitor resolutions
    this.escrowContract.addEventListener('DisputeResolved', (event) => {
      this.handleDisputeResolved(event);
    });
  }
  
  private async handleEscrowCreated(event: EscrowCreatedEvent) {
    // Update tournament registration status
    await updateTournamentRegistration(event.escrow_id, 'escrow_created');
    
    // Send notification to participant
    await sendNotification({
      type: 'escrow_created',
      escrowId: event.escrow_id,
      amount: event.amount,
      participant: event.depositor,
    });
  }
  
  private async handleDisputeRaised(event: DisputeRaisedEvent) {
    // Alert arbitrators
    await notifyArbitrators(event.escrow_id, event.reason);
    
    // Update tournament dispute status
    await updateTournamentDisputeStatus(event.escrow_id, 'pending');
    
    // Send notifications to relevant parties
    await sendDisputeNotifications(event);
  }
}
```

### 5. Auto-Release Integration

#### Automated Tournament Completion

```rust
// Automated escrow processing for completed tournaments
pub async fn process_completed_tournaments() -> Result<(), ApiError> {
    let completed_tournaments = get_completed_tournaments().await?;
    
    for tournament in completed_tournaments {
        let escrow_ids = get_tournament_escrows(tournament.id).await?;
        
        // Check if auto-release time has passed
        if tournament.completion_time + tournament.auto_release_buffer 
           <= current_timestamp() {
            
            // Auto-release all escrows
            for escrow_id in escrow_ids {
                if escrow_client.is_eligible_for_auto_release(escrow_id).await? {
                    escrow_client.check_auto_release(&escrow_id).await?;
                }
            }
            
            // Mark tournament as processed
            mark_tournament_processed(tournament.id).await?;
        }
    }
    
    Ok(())
}
```

## Database Schema Integration

### Tournament Escrow Tracking

```sql
-- Tournament escrow tracking table
CREATE TABLE tournament_escrows (
    id BIGSERIAL PRIMARY KEY,
    tournament_id BIGINT NOT NULL REFERENCES tournaments(id),
    escrow_id BIGINT NOT NULL UNIQUE,
    participant_address VARCHAR(56) NOT NULL,
    entry_fee_amount BIGINT NOT NULL,
    token_address VARCHAR(56) NOT NULL,
    escrow_state INTEGER NOT NULL DEFAULT 0,
    dispute_status INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    deposited_at TIMESTAMP,
    released_at TIMESTAMP,
    dispute_raised_at TIMESTAMP,
    dispute_resolved_at TIMESTAMP,
    
    INDEX idx_tournament_escrows_tournament_id (tournament_id),
    INDEX idx_tournament_escrows_escrow_id (escrow_id),
    INDEX idx_tournament_escrows_participant (participant_address),
    INDEX idx_tournament_escrows_state (escrow_state)
);

-- Tournament dispute tracking
CREATE TABLE tournament_disputes (
    id BIGSERIAL PRIMARY KEY,
    tournament_id BIGINT NOT NULL REFERENCES tournaments(id),
    escrow_id BIGINT NOT NULL REFERENCES tournament_escrows(escrow_id),
    dispute_type VARCHAR(50) NOT NULL,
    raised_by VARCHAR(56) NOT NULL,
    reason TEXT NOT NULL,
    evidence TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    arbitrator_address VARCHAR(56),
    resolution_decision INTEGER,
    depositor_amount BIGINT,
    beneficiary_amount BIGINT,
    resolution_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMP,
    
    INDEX idx_tournament_disputes_tournament_id (tournament_id),
    INDEX idx_tournament_disputes_escrow_id (escrow_id),
    INDEX idx_tournament_disputes_status (status)
);
```

## API Endpoints Integration

### REST API Endpoints

```rust
// Tournament escrow API endpoints
#[derive(Serialize, Deserialize)]
pub struct EscrowResponse {
    pub escrow_id: u64,
    pub state: u32,
    pub amount: i128,
    pub participant: String,
    pub created_at: u64,
}

#[derive(Serialize, Deserialize)]
pub struct DisputeResponse {
    pub dispute_id: u64,
    pub escrow_id: u64,
    pub dispute_type: String,
    pub status: String,
    pub raised_by: String,
    pub reason: String,
}

// Get tournament escrows
#[get("/tournaments/{tournament_id}/escrows")]
pub async fn get_tournament_escrows(
    tournament_id: Path<u64>,
    state: Option<Query<u32>>,
) -> Result<Json<Vec<EscrowResponse>>, ApiError> {
    let escrows = get_tournament_escrows_by_state(tournament_id.into_inner(), state).await?;
    Ok(Json(escrows))
}

// Create dispute
#[post("/tournaments/{tournament_id}/escrows/{escrow_id}/disputes")]
pub async fn create_dispute(
    tournament_id: Path<u64>,
    escrow_id: Path<u64>,
    dispute_request: Json<CreateDisputeRequest>,
) -> Result<Json<DisputeResponse>, ApiError> {
    let dispute = create_tournament_dispute(
        tournament_id.into_inner(),
        escrow_id.into_inner(),
        dispute_request.disputer_address.clone(),
        dispute_request.dispute_type.clone(),
        dispute_request.evidence.clone(),
    ).await?;
    
    Ok(Json(dispute))
}

// Resolve dispute
#[post("/tournaments/{tournament_id}/escrows/{escrow_id}/disputes/{dispute_id}/resolve")]
pub async fn resolve_dispute(
    tournament_id: Path<u64>,
    escrow_id: Path<u64>,
    dispute_id: Path<u64>,
    resolution_request: Json<ResolveDisputeRequest>,
) -> Result<Json<DisputeResponse>, ApiError> {
    let dispute = resolve_tournament_dispute(
        tournament_id.into_inner(),
        escrow_id.into_inner(),
        resolution_request.arbitrator_address.clone(),
        resolution_request.decision.clone(),
        resolution_request.evidence_review.clone(),
    ).await?;
    
    Ok(Json(dispute))
}
```

## Security Considerations

### Access Control

1. **Role-based Authorization**: Ensure proper role validation for all escrow operations
2. **Arbitrator Validation**: Only pre-approved arbitrators can resolve disputes
3. **Admin Controls**: Emergency recovery restricted to contract admin
4. **State Validation**: All state transitions properly validated

### Audit Trail

1. **Event Logging**: All escrow activities logged as events
2. **Database Tracking**: Complete audit trail in database
3. **Dispute Documentation**: All disputes and resolutions documented
4. **Emergency Recovery Logging**: All emergency actions logged

### Testing Integration

```rust
// Integration tests for tournament escrow
#[tokio::test]
async fn test_tournament_escrow_integration() {
    // Setup test environment
    let test_env = setup_test_environment().await;
    
    // Create test tournament
    let tournament = create_test_tournament(&test_env).await;
    
    // Register participants with escrow
    let escrow_ids = register_participants_with_escrow(&test_env, &tournament).await;
    
    // Simulate tournament completion
    complete_tournament(&test_env, &tournament, escrow_ids).await;
    
    // Verify all escrows released
    verify_escrows_released(&test_env, &escrow_ids).await;
    
    // Cleanup
    cleanup_test_environment(&test_env).await;
}
```

## Deployment Checklist

### Pre-deployment

- [ ] Contract compiled and tested
- [ ] Integration tests passing
- [ ] Database schema updated
- [ ] API endpoints implemented
- [ ] Event monitoring configured
- [ ] Security audit completed

### Deployment

- [ ] Deploy escrow contract to Stellar network
- [ ] Initialize contract with admin address
- [ ] Add trusted arbitrators
- [ ] Update tournament manager with escrow address
- [ ] Configure event monitoring
- [ ] Test end-to-end integration

### Post-deployment

- [ ] Monitor contract events
- [ ] Verify dispute resolution workflow
- [ ] Test emergency recovery procedures
- [ ] Performance monitoring
- [ ] User acceptance testing

## Monitoring and Maintenance

### Key Metrics

1. **Escrow Volume**: Total amount held in escrow
2. **Dispute Rate**: Percentage of escrows with disputes
3. **Resolution Time**: Average time to resolve disputes
4. **Auto-release Success**: Percentage of successful auto-releases
5. **Emergency Recovery**: Number of emergency recoveries

### Maintenance Tasks

1. **Regular Audits**: Periodic security and functionality audits
2. **Arbitrator Management**: Add/remove arbitrators as needed
3. **Performance Optimization**: Monitor and optimize gas usage
4. **Event Monitoring**: Ensure all events are properly captured
5. **Backup Procedures**: Regular backup of escrow state

## Support and Troubleshooting

### Common Issues

1. **Escrow Creation Failures**: Check arbitrator validation and parameters
2. **Dispute Resolution Errors**: Verify arbitrator authorization
3. **Auto-release Issues**: Check time configurations
4. **Emergency Recovery**: Ensure admin authorization

### Contact Information

- **Technical Support**: dev@arenax.gg
- **Documentation**: https://docs.arenax.gg/escrow
- **GitHub Issues**: https://github.com/arenax/arenax/issues

This integration guide provides comprehensive instructions for implementing the ArenaX Escrow Contract within the tournament system. Follow the provided patterns and examples to ensure secure and efficient integration.
