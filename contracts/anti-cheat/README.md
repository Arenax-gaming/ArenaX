# ArenaX Anti-Cheat Contract

A sophisticated anti-cheat system that detects suspicious behavior, validates game actions, and enforces fair play penalties on-chain.

## Overview

The Anti-Cheat Contract implements a comprehensive system for:
- Reporting suspicious activity during matches
- Validating game actions in real-time
- Calculating cheat probability based on behavior patterns
- Applying sanctions to confirmed cheaters
- Managing the appeal process for sanctions
- Tracking player trust scores

## Features

### Core Functions

- **`initialize(env, admin, reputation_contract)`** - Initialize the anti-cheat contract
- **`report_suspicious_activity(env, reporter, player, match_id, pattern, evidence, severity)`** - Report suspicious behavior
- **`validate_game_action(env, player, action, game_state)`** - Validate game actions
- **`calculate_cheat_probability(env, player, behavior_data)`** - Calculate cheat probability
- **`apply_sanction(env, player, sanction_type, reason, duration)`** - Apply sanctions (admin only)
- **`appeal_sanction(env, player, sanction_id, reason, evidence)`** - Appeal a sanction
- **`review_appeal(env, appeal_id, approved)`** - Review an appeal (admin only)
- **`get_player_trust_score(env, player)`** - Get player trust score
- **`verify_activity(env, caller, report_id, verified)`** - Verify suspicious activity (admin only)
- **`update_anticheat_params(env, caller, params)`** - Update anti-cheat parameters (admin only)

### Sanction Types

- **Warning** - Warning with no gameplay restrictions
- **TemporaryBan** - Temporary ban for specified duration
- **PermanentBan** - Permanent ban from the platform
- **ReputationPenalty** - Penalty to reputation score
- **PrizeForfeiture** - Forfeit of prize winnings

### Sanction Status

- **Active** - Sanction is currently active
- **Appealed** - Sanction has been appealed
- **Upheld** - Appeal was denied, sanction upheld
- **Overturned** - Appeal was approved, sanction removed
- **Expired** - Temporary sanction has expired

### Behavior Patterns

- **AbnormalReactionTime** - Unusual reaction times
- **ImpossibleMovement** - Movement that violates game physics
- **StatisticalAnomaly** - Statistical deviations from normal play
- **NetworkManipulation** - Manipulation of network connections
- **ExploitUsage** - Usage of game exploits
- **Other** - Other suspicious behavior

### Trust Score System

Trust scores range from 0-100:
- **100** - Perfect trust (new players)
- **70-99** - High trust
- **40-69** - Medium trust
- **0-39** - Low trust (triggers additional validation)

Trust score impacts:
- Below threshold triggers deep validation for actions
- Higher cheat probability calculation
- More severe sanctions for confirmed cheats

## Anti-Cheat Parameters

Default parameters set on initialization:

- **trust_threshold**: 30 (below this triggers review)
- **report_cooldown**: 3600 seconds (1 hour between reports)
- **appeal_window**: 604800 seconds (7 days to appeal)
- **severity_multiplier**: 2 (multiplier for repeated offenses)
- **max_reports_per_match**: 5 (maximum reports per match)

## Data Structures

### SuspiciousActivity
```rust
pub struct SuspiciousActivity {
    pub report_id: u64,
    pub reporter: Address,
    pub player: Address,
    pub match_id: u64,
    pub pattern: BehaviorPattern,
    pub evidence: Bytes,
    pub severity: u32, // 1-10
    pub timestamp: u64,
    pub verified: bool,
}
```

### Sanction
```rust
pub struct Sanction {
    pub sanction_id: u64,
    pub player: Address,
    pub sanction_type: SanctionType,
    pub status: SanctionStatus,
    pub reason: String,
    pub duration: u64, // 0 for permanent
    pub start_time: u64,
    pub end_time: u64,
    pub appeal_deadline: u64,
}
```

### Appeal
```rust
pub struct Appeal {
    pub appeal_id: u64,
    pub sanction_id: u64,
    pub player: Address,
    pub reason: String,
    pub evidence: Bytes,
    pub submitted_at: u64,
    pub reviewed: bool,
    pub approved: bool,
}
```

### TrustScore
```rust
pub struct TrustScore {
    pub player: Address,
    pub score: u32, // 0-100
    pub total_reports: u32,
    pub confirmed_cheats: u32,
    pub false_reports: u32,
    pub last_updated: u64,
}
```

### AntiCheatParams
```rust
pub struct AntiCheatParams {
    pub trust_threshold: u32,
    pub report_cooldown: u64,
    pub appeal_window: u64,
    pub severity_multiplier: u32,
    pub max_reports_per_match: u32,
}
```

## Security Features

### False Positive Prevention
- Report cooldown prevents spam reporting
- Max reports per match limits abuse
- Verification process before automatic sanctions
- Appeal process for contested sanctions

### Evidence Verification
- Evidence must be provided with reports
- Admin verification required for confirmed cheats
- Evidence can be submitted with appeals

### Whistleblower Protection
- Reporter identity is stored but not publicly exposed
- False reports penalize reporter's trust score
- System tracks false reports to identify abuse

### Emergency Controls
- Admin can verify activity and apply sanctions
- Admin can review appeals
- Parameters can be updated by admin
- Integration with reputation contract for penalties

## Events

The contract emits the following events:

- **SuspiciousActivityReported** - When suspicious activity is reported
- **SanctionApplied** - When a sanction is applied
- **SanctionAppealed** - When a sanction is appealed
- **AppealReviewed** - When an appeal is reviewed
- **TrustScoreUpdated** - When trust score is updated

## Testing

Run tests with:

```bash
cargo test
```

## Building

Build the contract for deployment:

```bash
cargo build --target wasm32-unknown-unknown --release
```

## Integration

The Anti-Cheat Contract integrates with:
- **Reputation Contract** - For applying reputation penalties
- **Anti-Cheat Oracle** - For external cheat detection systems

## Future Enhancements

- [ ] Integrate ML models for behavior analysis
- [ ] Implement real-time action validation hooks
- [ ] Add cross-match behavior tracking
- [ ] Implement automated sanction escalation
- [ ] Add whistleblower reward system
- [ ] Implement governance for anti-cheat parameters
- [ ] Add privacy features for reporter anonymity
- [ ] Implement emergency cheat response mechanisms
