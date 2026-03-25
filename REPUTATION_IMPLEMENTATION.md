# Player Reputation Index & Anti-Cheat Oracle Implementation

## Issue #134: [CONTRACTS] Player Reputation Index & Anti-Cheat Oracle Integration

### Overview

This implementation establishes an on-chain reputation system that tracks player behavior and integrates with external anti-cheat signals. The system provides gas-efficient reputation tracking, bounded penalties for cheating, and matchmaking integration to filter bad actors.

### Key Components

#### 1. Smart Contracts (Already Implemented)

**ReputationIndex Contract** (`contracts/reputation-index/`)
- Tracks `skill` and `fair_play` scores for each player
- Implements time-based decay mechanism (resets reputation towards baseline)
- Provides bounded penalty application to prevent underflows
- Only authorized contracts can update reputation

**Anti-Cheat Oracle Contract** (`contracts/anti-cheat-oracle/`)
- Accepts signed confirmations from external anti-cheat services
- Severity levels: low (5), medium (15), high (30) penalties
- Only authorized oracles can submit flags
- Automatically applies penalties via ReputationIndex contract

#### 2. Backend Implementation

##### Database Schema (`backend/migrations/20260325000001_reputation_system.up.sql`)

New columns in `users` table:
- `skill_score` (INTEGER): On-chain skill reputation (default: 1000)
- `fair_play_score` (INTEGER): On-chain fair play score (default: 100)
- `reputation_last_updated` (TIMESTAMPTZ): Last sync timestamp
- `anticheat_flags_count` (INTEGER): Total flags received
- `is_bad_actor` (BOOLEAN): Filter flag for matchmaking

New tables:
- `reputation_events`: Audit trail of all reputation changes
- `soroban_contracts`: Registry of deployed Soroban contracts

##### Reputation Service (`backend/src/service/reputation_service.rs`)

Core functionality:
- `get_player_reputation()`: Fetch cached reputation data
- `sync_reputation_from_chain()`: Sync with Soroban contract (TODO: implement actual RPC call)
- `update_reputation_on_match()`: Update scores after match completion
- `apply_anticheat_penalty()`: Apply bounded penalties from oracle
- `filter_bad_actors()`: Filter players for matchmaking
- `apply_decay()`: Apply time-based decay

Reputation Tiers:
- **Elite**: skill ≥ 1500, fair_play ≥ 90
- **Good**: skill ≥ 1200, fair_play ≥ 70
- **Average**: fair_play ≥ 50
- **Poor**: fair_play < 50

##### Match Service Integration (`backend/src/service/match_service.rs`)

Bad Actor Filtering:
1. **Join Queue Check**: Players with fair_play < 30 are blocked
2. **Candidate Filtering**: Remove players with fair_play < 50 from match candidates
3. **Match Completion**: Update reputation scores (+skill delta based on outcome, +1 fair_play completion bonus)
4. **Auto-flagging**: Players with fair_play < 30 automatically flagged as bad actors

##### HTTP API Endpoints (`backend/src/http/reputation_handler.rs`)

Public Endpoints:
- `GET /api/reputation/player/{user_id}`: Get player reputation scores
- `GET /api/reputation/history/{user_id}`: Get reputation change history

Authenticated Endpoints:
- `GET /api/reputation/me`: Get current user's reputation

Admin Endpoints:
- `GET /api/reputation/bad-actors`: List all flagged bad actors
- `POST /api/reputation/bad-actors/{user_id}/remove`: Approve appeal, remove flag
- `GET /api/reputation/stats`: Get system-wide reputation statistics

### Acceptance Criteria Compliance

✅ **Only authorized oracles can submit anti-cheat flags**
- Anti-cheat oracle contract validates oracle authorization
- Backend verifies contract address before applying penalties

✅ **Reputation updates are gas-efficient**
- Bounded penalties prevent excessive computation
- Time-based decay applied lazily (on-demand, not periodic)
- Local caching reduces on-chain queries

✅ **Slashing logic is strictly bounded to prevent negative underflows**
- All reputation scores use `.max(0)` to prevent underflow
- Penalty caps: MAX_PENALTY_PER_FLAG = 100 per call
- Severity-based penalties: 5/15/30 points

### Integration Points

#### Matchmaking Flow
```rust
// 1. Player joins queue
join_matchmaking() {
    // Check reputation
    if reputation.should_filter(30) {
        return Err("Account restricted");
    }
    
    // Add to queue
}

// 2. Matchmaking tries to find opponent
try_matchmaking() {
    // Get candidates
    let candidates = get_waiting_players();
    
    // Filter bad actors
    let filtered = rep_service.filter_bad_actors(candidates, 50);
    
    // Match remaining players by Elo
}

// 3. Match completes
process_match_completion() {
    // Update Elo
    update_elo_ratings();
    
    // Update reputation
    rep_service.update_reputation_on_match(players, skill_deltas);
}
```

#### Anti-Cheat Flow
```rust
// External anti-cheat service → Oracle Contract → Backend
oracle.submit_flag(player, match_id, severity) {
    // Validate oracle authorization
    // Calculate penalty (5/15/30)
    // Call reputation_index.apply_anticheat_penalty()
    
    // Backend listens to events and syncs
}
```

### Configuration

Add to `.env`:
```bash
# Soroban Contract Addresses
SOROBAN_CONTRACT_REPUTATION=CDZ...REPUTATION_CONTRACT_ADDRESS
SOROBAN_CONTRACT_ANTICHEAT_ORACLE=CDZ...ANTICHEAT_ORACLE_ADDRESS
```

### Testing

Unit Tests:
```bash
cd backend
cargo test reputation_service::tests
```

Integration Tests (TODO):
- Test full matchmaking flow with reputation filtering
- Test anti-cheat penalty application
- Test reputation decay mechanism

### Future Enhancements

1. **On-Chain Sync**: Implement actual Soroban RPC calls to fetch real-time reputation data
2. **Event Listening**: Set up Stellar/Soroban event listener to auto-sync reputation events
3. **Decay Automation**: Cron job to apply periodic decay to inactive players
4. **Leaderboards**: Reputation-based leaderboards (separate from Elo)
5. **Appeals Process**: Formal appeals workflow with evidence submission
6. **Multi-Game Support**: Game-specific reputation scores

### Monitoring

Key Metrics:
- Number of bad actors in system
- Average skill/fair_play scores
- Anti-cheat flags per day
- Reputation distribution by tier

SQL Queries for Monitoring:
```sql
-- Bad actor count
SELECT COUNT(*) FROM users WHERE is_bad_actor = true;

-- Reputation distribution
SELECT 
    CASE 
        WHEN fair_play_score >= 90 THEN 'elite'
        WHEN fair_play_score >= 70 THEN 'good'
        WHEN fair_play_score >= 50 THEN 'average'
        ELSE 'poor'
    END as tier,
    COUNT(*)
FROM users
GROUP BY tier;

-- Recent penalties
SELECT * FROM reputation_events 
WHERE event_type = 'anticheat_penalty'
ORDER BY created_at DESC
LIMIT 10;
```

### Security Considerations

1. **Authorization**: Only admin can modify contract addresses
2. **Bounded Penalties**: Capped at 100 per flag to prevent abuse
3. **Audit Trail**: All reputation changes logged in `reputation_events`
4. **Graceful Degradation**: System works without on-chain sync (uses cached values)
5. **Privacy**: Reputation data is public (blockchain transparency)

### Deployment Checklist

- [ ] Deploy ReputationIndex contract to testnet
- [ ] Deploy Anti-Cheat Oracle contract to testnet
- [ ] Run database migration: `20260325000001_reputation_system.up.sql`
- [ ] Update `.env` with contract addresses
- [ ] Initialize reputation service in application startup
- [ ] Test matchmaking filtering with test accounts
- [ ] Verify API endpoints return correct data
- [ ] Monitor logs for errors

### References

- Issue: https://github.com/Arenax-gaming/ArenaX/issues/134
- ReputationIndex Contract: `contracts/reputation-index/src/lib.rs`
- Anti-Cheat Oracle: `contracts/anti-cheat-oracle/src/lib.rs`
- Backend Service: `backend/src/service/reputation_service.rs`
