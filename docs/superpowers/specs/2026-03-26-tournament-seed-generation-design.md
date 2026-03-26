# Tournament Seed Generation & Round Advancement Orchestrator

**Issue:** #139 — [SERVER] Tournament Seed Generation & Round Advancement Orchestrator
**Date:** 2026-03-26
**Status:** Design Approved

## Summary

Automate the full lifecycle of a single-elimination tournament: Elo-based seeding, bracket generation, round advancement, idempotent payouts, and cleanup. Built as a dedicated orchestrator module that coordinates with existing tournament, match, wallet, and Soroban services.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Bracket format | SingleElimination only | Matches acceptance criteria (power-of-2 brackets). Other formats are separate issues. |
| Advancement trigger | Hybrid (event-driven + polling fallback) | Responsive on the happy path, resilient if events are missed. |
| Payout strategy | Off-chain wallet update + async on-chain finalization | Decouples tournament flow from blockchain availability. Instant UX. |
| Bye handling | Byes in round 1 for top seeds | Standard competitive format. Top Elo earns the bye advantage. |
| Archival | Soft archive (status + cleanup timestamp) | Schema already supports it. Hard archive is premature. |
| Architecture | Dedicated orchestrator module with focused components | Keeps concerns separated and testable in isolation. |

## 1. Seeding Engine

**File:** `backend/src/orchestrator/seeding_engine.rs`

**Purpose:** Generate Elo-based seeds and create the initial bracket (round 1 matches).

**Algorithm:**

1. Fetch all `Active` participants for the tournament, joined with `user_elo` for the tournament's game.
2. Sort descending by Elo. Ties broken by registration time (earlier = higher seed).
3. Assign `seed_number` 1..N on `tournament_participants`.
4. Compute `bracket_size` = next power of 2 >= N (e.g., 12 participants = 16 slots).
5. Calculate `num_byes` = bracket_size - N.
6. Assign byes to top-seeded players (seeds 1 through `num_byes`).
7. Generate round 1 matchups using standard tournament seeding so top seeds are on opposite sides of the bracket. Uses recursive bracket fill: for bracket size B, pair seed 1 vs seed B, seed 2 vs seed B-1, etc., folded so 1 and 2 can only meet in the final.
8. Create `tournament_rounds` record for round 1 (type = `Elimination`, or `Final` if only 2 participants).
9. Create `tournament_matches` records. Matches where one side is a bye auto-complete immediately with the seeded player as winner.
10. Update tournament status to `InProgress`.

**Validation:**
- Minimum 4 participants.
- Maximum 64 participants.
- Tournament must be in `RegistrationClosed` status.

**Standard seeding placement (example for 8-player bracket):**

```
Match 1: Seed 1 vs Seed 8
Match 2: Seed 4 vs Seed 5
Match 3: Seed 2 vs Seed 7
Match 4: Seed 3 vs Seed 6
```

Top half: matches 1, 2. Bottom half: matches 3, 4. Seeds 1 and 2 can only meet in the final.

## 2. Round Advancement Worker

**File:** `backend/src/orchestrator/round_advancement.rs`

**Purpose:** Detect round completion and generate the next round's matches until a winner emerges.

### Event-Driven Path

1. Match completion handler (in `match_service`) calls `RoundAdvancementWorker::on_match_completed(tournament_id, round_id)`.
2. Worker checks: are all `tournament_matches` in this round either `Completed` or `Cancelled`?
3. If yes, generate next round. If no, do nothing.

### Next Round Generation

1. Collect winners from completed matches in the current round, ordered by match sequence number (the positional index within the round, preserving bracket structure).
2. Pair sequentially: winner of match 1 vs winner of match 2, winner of match 3 vs winner of match 4, etc.
3. Create new `tournament_rounds` record with appropriate type:
   - 2 players remaining: `Final`
   - 4 players remaining: `Semifinal`
   - More than 4: `Elimination`
4. Create `tournament_matches` for the new round.
5. If only 1 player remains: tournament is complete, trigger finalization via `PayoutSettler`.

### Polling Fallback

- Background `tokio::spawn` task runs every 60 seconds.
- Queries for tournaments in `InProgress` status where the current round has all matches completed but no next round exists.
- Triggers the same advancement logic.
- Idempotent: if the event-driven path already handled it, the polling worker finds nothing to do.

### Edge Cases

- **Match cancelled (player no-show):** The opponent advances automatically as if they won.
- **Both players disqualified:** That bracket slot propagates as a bye to the next round.

## 3. Payout Settlement

**File:** `backend/src/orchestrator/payout_settler.rs`

**Purpose:** Pay winners exactly once when the tournament finalizes. Off-chain wallet updates for speed, on-chain finalization for auditability.

### Finalization Flow

1. **Compute final rankings.** Walk the bracket bottom-up:
   - Winner of final = rank 1
   - Loser of final = rank 2
   - Losers of semifinals = rank 3 (tied)
   - Losers of quarterfinals = rank 5 (tied)
   - And so on.

2. **Update `tournament_participants`** with `final_rank` for all players.

3. **Calculate prize amounts** using `prize_pools.distribution_percentages` (default `[50, 30, 20]`). Multiply each percentage by `prize_pool` total.

4. **Idempotency check.** Query `transactions` for existing `Prize` type transactions with this `tournament_id`. If they exist, skip. This is the core "pay once" guarantee.

5. **Off-chain settlement** (within a database transaction):
   - For each prize recipient, call `wallet_service.add_balance()` with the prize amount.
   - Create a `Transaction` record with type `Prize`, status `Completed`, and the tournament_id as reference.
   - Update `tournament_participants.prize_amount` for each winner.

6. **On-chain finalization** (async, outside the DB transaction):
   - Create a `RewardSettlement` record with status `Pending`.
   - Call `tournament_finalizer.finalize_tournament()` via `soroban_service` with rankings and prize allocations.
   - On success: update settlement status to `Confirmed`, store tx_hash.
   - On failure: update to `Failed`, retry via the polling worker (max 3 retries with exponential backoff).

7. **Update tournament status** to `Completed`.

### Idempotency Guarantees

- Database transaction wraps steps 4-5. If anything fails, nothing commits.
- The `transactions` table check in step 4 prevents double-pay even if the handler runs twice.
- The `tournament_finalizer` contract itself prevents duplicate finalization (already built into the contract).

## 4. Tournament Cleanup Service

**File:** `backend/src/orchestrator/tournament_cleanup.rs`

**Purpose:** Ensure completed tournaments have consistent state and release held resources.

### When It Runs

- Triggered after payout settlement completes (event-driven).
- Also runs on the polling worker for tournaments in `Completed` status without `cleaned_up_at` set.

### Cleanup Steps

1. **Verify all matches finalized.** Every `tournament_match` should be `Completed` or `Cancelled`. If any are stuck in `InProgress` or `Pending` for longer than 24 hours (configurable), force-cancel and advance the opponent.
2. **Verify all payouts settled.** Check that `Prize` transactions exist for all eligible participants. If missing, re-trigger `PayoutSettler`.
3. **Release escrow.** If any funds remain in escrow (e.g., from cancelled matches), refund to original players via `wallet_service`. Create `Refund` type transactions.
4. **Mark participants final.** Ensure all participants have `final_rank` and appropriate status (`Eliminated` for losers, `Active` for the winner with rank 1).
5. **Set cleanup timestamp.** Write `cleaned_up_at` on the `tournaments` row. Polling worker skips tournaments with this set.

### Stale Tournament Handling

Tournaments in `InProgress` for longer than 7 days (configurable) with no match activity get flagged for admin review. Not auto-cancelled, since that could lose player funds.

## 5. Module Structure

### New Files

```
backend/src/
├── orchestrator/
│   ├── mod.rs                      # Module exports
│   ├── seeding_engine.rs           # Elo-based seeding + bracket generation
│   ├── round_advancement.rs        # Event-driven + polling round advancement
│   ├── payout_settler.rs           # Idempotent prize distribution
│   ├── tournament_cleanup.rs       # State consistency + resource release
│   └── tournament_orchestrator.rs  # Coordinates all components, owns the polling worker
```

### New Migration

```sql
-- backend/migrations/YYYYMMDD_tournament_orchestrator.up.sql
ALTER TABLE tournaments ADD COLUMN cleaned_up_at TIMESTAMPTZ;
CREATE INDEX idx_tournaments_status_cleanup ON tournaments(status, cleaned_up_at);
```

### Integration Points

| Existing code | Change |
|---|---|
| `tournament_service.rs` | Add `start_tournament()` that validates preconditions and calls `SeedingEngine::seed_and_generate_bracket()` |
| `match_service.rs` | After match completion, call `RoundAdvancementWorker::on_match_completed()` |
| `reward_settlement_service.rs` | Replace stub implementation with delegation to `PayoutSettler`. Keep the same public API. |
| `main.rs` | Spawn the polling worker background task on startup |
| `wallet_service.rs` | No changes. Used as-is by `PayoutSettler`. |
| `soroban_service.rs` | No changes. Used as-is for on-chain finalization. |

### Component Dependencies

```
TournamentOrchestrator
  ├── SeedingEngine       (sqlx::PgPool)
  ├── RoundAdvancementWorker (sqlx::PgPool, SeedingEngine for bye propagation)
  ├── PayoutSettler       (sqlx::PgPool, wallet_service, soroban_service)
  └── TournamentCleanup   (sqlx::PgPool, PayoutSettler, wallet_service)
```

All components take a shared `sqlx::PgPool` and service references. No new external dependencies needed.

## 6. Data Flow

```
Tournament in RegistrationClosed
  │
  ▼
SeedingEngine.seed_and_generate_bracket()
  ├── Assign seed numbers by Elo
  ├── Compute byes for top seeds
  ├── Create round 1 matches (auto-complete byes)
  └── Set tournament status → InProgress
  │
  ▼
Matches play out (existing match flow)
  │
  ▼
Match completes → RoundAdvancementWorker.on_match_completed()
  ├── All matches in round done?
  │   ├── No → do nothing
  │   └── Yes → generate next round matches
  │           ├── More than 1 player? → create matches, loop back
  │           └── 1 player left? → trigger finalization
  │
  ▼
PayoutSettler.finalize_tournament()
  ├── Compute final rankings from bracket
  ├── Idempotency check (skip if already paid)
  ├── DB transaction: update wallets + create Prize transactions
  ├── Async: call tournament_finalizer contract
  └── Set tournament status → Completed
  │
  ▼
TournamentCleanup.cleanup()
  ├── Verify all matches finalized
  ├── Verify all payouts settled
  ├── Release any remaining escrow
  ├── Mark all participants with final state
  └── Set cleaned_up_at timestamp
```

## 7. Acceptance Criteria Mapping

| Criteria | Covered by |
|---|---|
| Tournaments progress automatically without manual intervention | RoundAdvancementWorker (event-driven + polling fallback) |
| Brackets generated correctly for 4, 8, 16, 32, 64 participants | SeedingEngine with standard seeding algorithm + bye handling for non-power-of-2 |
| Payouts triggered exactly once upon tournament finalization | PayoutSettler with DB transaction idempotency check + contract-level duplicate prevention |
