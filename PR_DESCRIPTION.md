# [CONTRACTS] Player Reputation Index & Anti-Cheat Oracle Integration

Closes #134

## Description

This PR implements a comprehensive on-chain reputation system that tracks player behavior and integrates with external anti-cheat signals. The system provides gas-efficient reputation tracking, bounded penalties for cheating, and matchmaking integration to filter bad actors.

## Key Changes

### Smart Contracts (Already Implemented)
- ✅ **ReputationIndex Contract**: Tracks skill and fair_play scores with time-based decay
- ✅ **Anti-Cheat Oracle**: Accepts signed confirmations from external anti-cheat services

### Backend Implementation

#### Database Schema
- New migration: `20260325000001_reputation_system.up.sql`
- Adds reputation tracking columns to users table
- Creates `reputation_events` table for audit trail
- Creates `soroban_contracts` registry table

#### Services
- **New**: `ReputationService` (`backend/src/service/reputation_service.rs`)
  - Query player reputation scores
  - Sync with Soroban contracts (framework ready)
  - Apply bounded anti-cheat penalties
  - Filter bad actors for matchmaking
  - Reputation tier system (Elite/Good/Average/Poor)

- **Updated**: `MatchService` (`backend/src/service/match_service.rs`)
  - Bad actor filtering in matchmaking queue (fair_play < 30 blocked)
  - Candidate filtering during match creation (fair_play < 50 filtered)
  - Automatic reputation updates on match completion
  - Auto-flagging players with very low fair_play

#### API Endpoints
- **New**: `reputation_handler` (`backend/src/http/reputation_handler.rs`)
  - `GET /api/reputation/player/{user_id}` - Get player reputation
  - `GET /api/reputation/me` - Get current user's reputation (auth required)
  - `GET /api/reputation/history/{user_id}` - Get reputation history
  - `GET /api/reputation/bad-actors` - Admin: List flagged accounts
  - `POST /api/reputation/bad-actors/{user_id}/remove` - Admin: Remove flag (appeal)
  - `GET /api/reputation/stats` - Admin: System-wide statistics

#### Models
- Updated `UserProfile` to include reputation fields (skill_score, fair_play_score, is_bad_actor)

## Acceptance Criteria

✅ **Only authorized oracles can submit anti-cheat flags**
- Validated at smart contract level
- Backend verifies contract authorization

✅ **Reputation updates are gas-efficient**
- Bounded penalties (max 100 per flag)
- Lazy decay application
- Local caching reduces on-chain queries

✅ **Slashing logic is strictly bounded to prevent negative underflows**
- All scores use `.max(0)` to prevent underflow
- Severity-based penalties: 5 (low), 15 (medium), 30 (high)

## Technical Details

### Reputation Tiers
- **Elite**: skill ≥ 1500, fair_play ≥ 90
- **Good**: skill ≥ 1200, fair_play ≥ 70
- **Average**: fair_play ≥ 50
- **Poor**: fair_play < 50

### Matchmaking Integration
1. Players with fair_play < 30 cannot join queue
2. Candidates with fair_play < 50 filtered from matching
3. Match completion triggers reputation update (+skill delta, +1 fair_play bonus)
4. Auto-flagging when fair_play drops below 30

### Anti-Cheat Flow
External Service → Oracle Contract → ReputationIndex Contract → Backend Sync

## Testing

Unit tests included for:
- Player reputation filtering logic
- Reputation tier classification
- Should_filter threshold checks

Run tests:
```bash
cd backend
cargo test reputation_service::tests
```

## Configuration

Add to `.env`:
```bash
SOROBAN_CONTRACT_REPUTATION=<reputation_contract_address>
SOROBAN_CONTRACT_ANTICHEAT_ORACLE=<anticheat_oracle_address>
```

## Migration

Run database migration:
```bash
sqlx migrate run --database-url <DATABASE_URL>
```

## Future Enhancements (TODO)

1. Implement actual Soroban RPC calls for real-time on-chain sync
2. Set up Stellar event listener for automatic reputation event syncing
3. Cron job for periodic decay application
4. Reputation-based leaderboards
5. Formal appeals workflow with evidence submission

## Documentation

See `REPUTATION_IMPLEMENTATION.md` for comprehensive implementation details, security considerations, monitoring queries, and deployment checklist.

## Breaking Changes

None - backward compatible. Existing users will have default reputation scores (skill: 1000, fair_play: 100).

## Checklist

- [x] Database migration created
- [x] Reputation service implemented
- [x] Matchmaking integration complete
- [x] API endpoints added
- [x] User profile updated
- [x] Tests added
- [x] Documentation created
- [x] Code follows project standards
- [ ] Reviewer approval
- [ ] QA testing complete

## Related Issues

- Closes #134
