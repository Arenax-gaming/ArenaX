# ArenaX Reputation Contract

A comprehensive reputation management system for ArenaX built on Stellar's Soroban smart contract platform. This contract tracks player fairness, skill progression, and tournament behavior on the Stellar blockchain.

## Features

### Core Functionality
- **Reputation Token System**: Issue and track reputation points for players
- **Dynamic Reputation Updates**: Update reputation based on match results, tournament participation, and behavior
- **Penalty and Reward System**: Apply penalties for cheating/bad behavior and rewards for fair play
- **Reputation History**: Complete audit trail of all reputation changes
- **Reputation-Based Access Control**: Check if players meet requirements for tournaments
- **Tier System**: Six reputation tiers from Beginner to Master
- **Event Emission**: Comprehensive event logging for off-chain monitoring

### Analytics Functions
- **Reputation Statistics**: Get detailed player statistics
- **Win/Penalty Rates**: Calculate performance metrics
- **Reputation Trends**: Track reputation changes over time
- **Health Score**: Calculate overall reputation health
- **Volatility Analysis**: Measure reputation stability
- **Leaderboards**: Top performers by tier and category

## Contract Architecture

### Data Structures

#### ReputationInfo
```rust
pub struct ReputationInfo {
    pub player: Address,
    pub total_reputation: i128,
    pub current_reputation: i128,
    pub reputation_tier: ReputationTier,
    pub last_updated: u64,
    pub total_matches: u32,
    pub wins: u32,
    pub losses: u32,
    pub disputes: u32,
    pub penalties: u32,
}
```

#### ReputationTier
- **Beginner**: 0-100 points
- **Novice**: 101-500 points
- **Intermediate**: 501-1000 points
- **Advanced**: 1001-2000 points
- **Expert**: 2001-5000 points
- **Master**: 5001+ points

#### ReputationEventType
- `MatchWin`: Reputation gain for winning matches
- `MatchLoss`: Small reputation loss for losing matches
- `TournamentWin`: Bonus reputation for tournament victories
- `TournamentParticipation`: Reputation for participating in tournaments
- `DisputeResolution`: Reputation loss for disputes
- `CheatingPenalty`: Significant reputation loss for cheating
- `FairPlayReward`: Bonus reputation for fair play
- `LongStreakBonus`: Bonus for winning streaks
- `CommunityContribution`: Reputation for community contributions

## Core Functions

### Initialization
```rust
pub fn initialize(env: Env, admin: Address) -> Result<(), Error>
```

### Reputation Management
```rust
pub fn issue_reputation(env: Env, player: Address, initial_amount: Option<i128>) -> Result<(), Error>
pub fn update_reputation(env: Env, player: Address, change: i128, reason: String, event_type: ReputationEventType, tournament_id: Option<u64>, match_id: Option<u64>) -> Result<(), Error>
pub fn apply_penalty(env: Env, player: Address, penalty_amount: i128, reason: String, severity: PenaltySeverity) -> Result<(), Error>
```

### Query Functions
```rust
pub fn get_reputation(env: Env, player: Address) -> Result<i128, Error>
pub fn get_reputation_info(env: Env, player: Address) -> Result<ReputationInfo, Error>
pub fn get_reputation_history(env: Env, player: Address, limit: Option<u32>) -> Result<Vec<ReputationEvent>, Error>
```

### Access Control
```rust
pub fn check_reputation_requirement(env: Env, player: Address, requirement: ReputationRequirement) -> Result<bool, Error>
```

### Admin Functions
```rust
pub fn transfer_reputation(env: Env, from: Address, to: Address, amount: i128, reason: String) -> Result<(), Error>
pub fn reset_reputation(env: Env, player: Address, reason: String) -> Result<(), Error>
pub fn pause_contract(env: Env) -> Result<(), Error>
pub fn unpause_contract(env: Env) -> Result<(), Error>
pub fn change_admin(env: Env, new_admin: Address) -> Result<(), Error>
```

### Analytics Functions
```rust
pub fn get_reputation_stats(env: Env, player: Address) -> Result<(i128, i128, u32, u32, u32, u32), Error>
pub fn get_win_rate(env: Env, player: Address) -> Result<f64, Error>
pub fn get_penalty_rate(env: Env, player: Address) -> Result<f64, Error>
pub fn get_reputation_trend(env: Env, player: Address, days: u32) -> Result<i128, Error>
pub fn get_reputation_health_score(env: Env, player: Address) -> Result<f64, Error>
pub fn get_reputation_volatility(env: Env, player: Address, days: u32) -> Result<f64, Error>
```

## Reputation Calculation

### Base Reputation Changes
- **Match Win**: +50 points (base)
- **Match Loss**: -5 points (base)
- **Tournament Win**: +100 points (base)
- **Tournament Participation**: +25 points (base)
- **Dispute Resolution**: -15 points (base)
- **Cheating Penalty**: -250 points (base)
- **Fair Play Reward**: +75 points (base)
- **Long Streak Bonus**: +150 points (base)
- **Community Contribution**: +125 points (base)

### Tier-Based Multipliers
Reputation changes can be modified based on player tier and other factors.

## Events

The contract emits the following events for off-chain monitoring:

- `reputation_issued`: When initial reputation is issued
- `reputation_updated`: When reputation is updated
- `penalty_applied`: When penalties are applied
- `tier_changed`: When player tier changes
- `reputation_transferred`: When reputation is transferred

## Error Handling

The contract includes comprehensive error handling:

- `Unauthorized`: Access denied for admin functions
- `ContractPaused`: Contract is paused
- `InvalidParameter`: Invalid input parameters
- `PlayerNotFound`: Player doesn't exist
- `PlayerAlreadyExists`: Player already has reputation
- `InvalidReputationAmount`: Reputation amount out of bounds
- `InsufficientReputation`: Not enough reputation for operation
- `ReputationUpdateFailed`: Failed to update reputation
- `InvalidReputationTier`: Invalid reputation tier
- `InvalidEventType`: Invalid event type
- `EventRecordingFailed`: Failed to record event
- `RequirementNotMet`: Player doesn't meet requirements
- `InvalidRequirement`: Invalid requirement specification

## Security Features

- **Admin Protection**: All admin functions require proper authorization
- **Atomic Operations**: Reputation updates are atomic
- **Bounds Checking**: Reputation amounts are validated
- **Pause Mechanism**: Contract can be paused for emergencies
- **Audit Trail**: Complete history of all operations
- **Event Logging**: All operations emit events for monitoring

## Performance Considerations

- **Gas Optimization**: Efficient storage patterns
- **History Limits**: Reputation history is limited to prevent storage bloat
- **Batch Operations**: Multiple updates can be batched
- **Caching**: Frequently accessed data is cached

## Usage Examples

### Initialize Contract
```rust
let admin = Address::generate(&env);
contract.initialize(&admin);
```

### Issue Reputation to New Player
```rust
let player = Address::generate(&env);
contract.issue_reputation(&player, &Some(100));
```

### Update Reputation After Match
```rust
contract.update_reputation(
    &player,
    &50,
    &String::from_str(&env, "Won match"),
    &ReputationEventType::MatchWin,
    &None,
    &Some(match_id),
);
```

### Apply Penalty
```rust
contract.apply_penalty(
    &player,
    &-100,
    &String::from_str(&env, "Cheating detected"),
    &PenaltySeverity::Moderate,
);
```

### Check Tournament Requirements
```rust
let requirement = ReputationRequirement {
    min_reputation: 500,
    min_tier: ReputationTier::Novice,
    max_penalties: 2,
    min_matches: 10,
};

let meets_requirement = contract.check_reputation_requirement(&player, &requirement);
```

## Testing

The contract includes comprehensive unit and integration tests covering:

- Contract initialization
- Reputation issuance and updates
- Penalty application
- Access control
- Error handling
- Event emission
- Analytics functions

Run tests with:
```bash
cargo test
```

## Deployment

1. Build the contract:
```bash
cargo build --target wasm32-unknown-unknown --release
```

2. Deploy to Stellar network:
```bash
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/reputation.wasm
```

3. Initialize the contract:
```bash
soroban contract invoke --id <CONTRACT_ID> -- initialize --admin <ADMIN_ADDRESS>
```

## Integration

This reputation contract is designed to integrate with:

- **Match Contract**: Update reputation after matches
- **Tournament Contract**: Check requirements and update reputation
- **Dispute Contract**: Apply penalties for disputes
- **Frontend**: Display reputation information and analytics
- **Backend**: Monitor events and maintain off-chain indexes

## Future Enhancements

- **Reputation Marketplace**: Allow trading of reputation
- **Advanced Analytics**: Machine learning-based reputation analysis
- **Cross-Chain Integration**: Multi-chain reputation tracking
- **Governance**: Community-driven reputation rules
- **NFT Integration**: Reputation-based NFT rewards
