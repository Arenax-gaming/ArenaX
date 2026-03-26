# Tournament Seed Generation & Round Advancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate single-elimination tournament lifecycle: Elo-based seeding, bracket generation, round advancement, idempotent payouts, and cleanup.

**Architecture:** New `orchestrator` module with four focused components (SeedingEngine, RoundAdvancementWorker, PayoutSettler, TournamentCleanup) coordinated by a TournamentOrchestrator. Event-driven round advancement with a 60-second polling fallback. Off-chain wallet payouts with async on-chain finalization.

**Tech Stack:** Rust, sqlx (Postgres), tokio (async runtime), existing WalletService/SorobanService/TournamentService.

**Spec:** `docs/superpowers/specs/2026-03-26-tournament-seed-generation-design.md`

**Out of scope (follow-up):** On-chain finalization via `tournament_finalizer` contract + `soroban_service`. The off-chain wallet payout is the core deliverable. On-chain finalization requires contract deployment and Stellar account setup that are independent concerns.

---

## File Structure

```
backend/src/
├── orchestrator/
│   ├── mod.rs                      # Module declaration + re-exports
│   ├── seeding_engine.rs           # Elo-based seeding + bracket generation (~250 lines)
│   ├── round_advancement.rs        # Event-driven + polling round advancement (~200 lines)
│   ├── payout_settler.rs           # Idempotent prize distribution (~250 lines)
│   ├── tournament_cleanup.rs       # State consistency + resource release (~150 lines)
│   └── tournament_orchestrator.rs  # Coordinates components, owns polling worker (~150 lines)
├── main.rs                         # Modified: add `mod orchestrator`, spawn polling worker
├── service/
│   ├── mod.rs                      # Modified: re-export orchestrator
│   ├── tournament_service.rs       # Modified: call SeedingEngine from start_tournament
│   └── match_service.rs            # Modified: call RoundAdvancementWorker on match completion

backend/migrations/
└── 20260326000001_tournament_orchestrator.up.sql   # Add cleaned_up_at column + index
└── 20260326000001_tournament_orchestrator.down.sql # Rollback migration

backend/tests/
└── orchestrator/
    ├── mod.rs
    ├── seeding_engine_test.rs
    ├── round_advancement_test.rs
    ├── payout_settler_test.rs
    └── tournament_cleanup_test.rs
```

---

## Task 1: Database Migration

**Files:**
- Create: `backend/migrations/20260326000001_tournament_orchestrator.up.sql`
- Create: `backend/migrations/20260326000001_tournament_orchestrator.down.sql`

- [ ] **Step 1: Create the up migration**

```sql
-- backend/migrations/20260326000001_tournament_orchestrator.up.sql
-- Add cleanup tracking to tournaments table
ALTER TABLE tournaments ADD COLUMN cleaned_up_at TIMESTAMPTZ;

-- Index for polling worker to find tournaments needing cleanup
CREATE INDEX idx_tournaments_status_cleanup ON tournaments(status, cleaned_up_at);

-- Index for finding current round of a tournament efficiently
CREATE INDEX idx_tournament_rounds_tournament_status ON tournament_rounds(tournament_id, status);

-- Index for finding matches in a round efficiently
CREATE INDEX idx_tournament_matches_round_status ON tournament_matches(round_id, status);
```

- [ ] **Step 2: Create the down migration**

```sql
-- backend/migrations/20260326000001_tournament_orchestrator.down.sql
DROP INDEX IF EXISTS idx_tournament_matches_round_status;
DROP INDEX IF EXISTS idx_tournament_rounds_tournament_status;
DROP INDEX IF EXISTS idx_tournaments_status_cleanup;
ALTER TABLE tournaments DROP COLUMN IF EXISTS cleaned_up_at;
```

- [ ] **Step 3: Commit**

```bash
git add backend/migrations/20260326000001_tournament_orchestrator.up.sql backend/migrations/20260326000001_tournament_orchestrator.down.sql
git commit -m "feat(orchestrator): add migration for tournament cleanup tracking"
```

---

## Task 2: Orchestrator Module Skeleton + SeedingEngine

**Files:**
- Create: `backend/src/orchestrator/mod.rs`
- Create: `backend/src/orchestrator/seeding_engine.rs`
- Modify: `backend/src/main.rs:6` (add `mod orchestrator`)

- [ ] **Step 1: Create the orchestrator module file**

```rust
// backend/src/orchestrator/mod.rs
pub mod seeding_engine;

pub use seeding_engine::SeedingEngine;
```

- [ ] **Step 2: Register the module in main.rs**

Add `mod orchestrator;` after the existing module declarations in `backend/src/main.rs` (after line 12, before the `use` statements):

```rust
mod orchestrator;
```

- [ ] **Step 3: Write the SeedingEngine with bracket generation**

```rust
// backend/src/orchestrator/seeding_engine.rs
use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::{
    MatchStatus, ParticipantStatus, RoundStatus, RoundType, TournamentMatch, TournamentParticipant,
    TournamentRound, TournamentStatus,
};
use chrono::Utc;
use uuid::Uuid;

pub struct SeedingEngine {
    db_pool: DbPool,
}

impl SeedingEngine {
    pub fn new(db_pool: DbPool) -> Self {
        Self { db_pool }
    }

    /// Seeds participants by Elo and generates the initial single-elimination bracket.
    /// Tournament must be in RegistrationClosed status with 4-64 participants.
    pub async fn seed_and_generate_bracket(
        &self,
        tournament_id: Uuid,
    ) -> Result<(), ApiError> {
        // Validate tournament status
        let tournament = sqlx::query!(
            "SELECT status, game, bracket_type FROM tournaments WHERE id = $1",
            tournament_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .ok_or_else(|| ApiError::not_found("Tournament not found"))?;

        let status: String = tournament.status;
        if status != "RegistrationClosed" {
            return Err(ApiError::bad_request(
                "Tournament must be in RegistrationClosed status to seed",
            ));
        }

        let game: String = tournament.game;

        // Fetch active participants with their Elo ratings
        let participants = sqlx::query_as!(
            ParticipantWithElo,
            r#"
            SELECT tp.id, tp.user_id, tp.registered_at,
                   COALESCE(ue.current_rating, 1200) as elo
            FROM tournament_participants tp
            LEFT JOIN user_elo ue ON ue.user_id = tp.user_id AND ue.game = $2
            WHERE tp.tournament_id = $1
              AND (tp.status = 'Active' OR tp.status = 'Paid')
            ORDER BY COALESCE(ue.current_rating, 1200) DESC, tp.registered_at ASC
            "#,
            tournament_id,
            game
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let n = participants.len();
        if n < 4 {
            return Err(ApiError::bad_request(
                "Minimum 4 participants required for seeding",
            ));
        }
        if n > 64 {
            return Err(ApiError::bad_request(
                "Maximum 64 participants allowed",
            ));
        }

        // Assign seed numbers (1 = highest Elo)
        for (idx, p) in participants.iter().enumerate() {
            let seed = (idx + 1) as i32;
            sqlx::query!(
                "UPDATE tournament_participants SET seed_number = $1, status = 'Active' WHERE id = $2",
                seed,
                p.id
            )
            .execute(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;
        }

        // Compute bracket size (next power of 2)
        let bracket_size = n.next_power_of_two();
        let num_byes = bracket_size - n;

        // Generate standard seeding order for the bracket
        let seeding_order = generate_bracket_order(bracket_size);

        // Create round 1
        let round_type = if bracket_size == 2 { "Final" } else { "Elimination" };
        let round = sqlx::query!(
            r#"
            INSERT INTO tournament_rounds (
                id, tournament_id, round_number, round_type, status, created_at, updated_at
            ) VALUES ($1, $2, 1, $3, $4, $5, $5)
            RETURNING id
            "#,
            Uuid::new_v4(),
            tournament_id,
            round_type,
            "InProgress",
            Utc::now()
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let round_id = round.id;
        let num_matches = bracket_size / 2;

        for match_idx in 0..num_matches {
            let seed_a = seeding_order[match_idx * 2];       // 1-indexed seed
            let seed_b = seeding_order[match_idx * 2 + 1];   // 1-indexed seed

            // Seeds beyond participant count are byes
            let player_a_id = if seed_a <= n {
                Some(participants[seed_a - 1].user_id)
            } else {
                None
            };
            let player_b_id = if seed_b <= n {
                Some(participants[seed_b - 1].user_id)
            } else {
                None
            };

            let is_bye = player_a_id.is_none() || player_b_id.is_none();
            let winner_id = if is_bye {
                player_a_id.or(player_b_id)
            } else {
                None
            };
            let match_status = if is_bye { "Completed" } else { "Pending" };

            let match_number = (match_idx + 1) as i32;

            // For byes, we need the actual player as player1
            let (p1, p2) = if player_a_id.is_some() && player_b_id.is_some() {
                (player_a_id.unwrap(), player_b_id)
            } else if player_a_id.is_some() {
                (player_a_id.unwrap(), None)
            } else {
                (player_b_id.unwrap(), None)
            };

            sqlx::query!(
                r#"
                INSERT INTO tournament_matches (
                    id, tournament_id, round_id, match_number, player1_id, player2_id,
                    winner_id, status, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
                "#,
                Uuid::new_v4(),
                tournament_id,
                round_id,
                match_number,
                p1,
                p2,
                winner_id,
                match_status,
                Utc::now()
            )
            .execute(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;
        }

        // Update tournament status to InProgress
        sqlx::query!(
            "UPDATE tournaments SET status = 'InProgress', updated_at = $2 WHERE id = $1",
            tournament_id,
            Utc::now()
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }
}

/// Helper struct for the seeding query
struct ParticipantWithElo {
    pub id: Uuid,
    pub user_id: Uuid,
    pub registered_at: chrono::DateTime<Utc>,
    pub elo: Option<i32>,
}

/// Generates standard tournament bracket seeding order.
/// For bracket_size=8: returns [1, 8, 4, 5, 2, 7, 3, 6]
/// This ensures seed 1 and 2 can only meet in the final.
fn generate_bracket_order(bracket_size: usize) -> Vec<usize> {
    if bracket_size == 1 {
        return vec![1];
    }

    let mut order = vec![1, 2];

    while order.len() < bracket_size {
        let current_size = order.len();
        let next_sum = current_size * 2 + 1; // sum of paired seeds
        let mut next_order = Vec::with_capacity(current_size * 2);
        for &seed in &order {
            next_order.push(seed);
            next_order.push(next_sum - seed);
        }
        order = next_order;
    }

    order
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bracket_order_4() {
        let order = generate_bracket_order(4);
        // Seed 1 vs 4, Seed 2 vs 3 — but placed so 1 and 2 are on opposite sides
        assert_eq!(order, vec![1, 4, 2, 3]);
    }

    #[test]
    fn test_bracket_order_8() {
        let order = generate_bracket_order(8);
        // Match 1: 1v8, Match 2: 4v5, Match 3: 2v7, Match 4: 3v6
        assert_eq!(order, vec![1, 8, 4, 5, 2, 7, 3, 6]);
    }

    #[test]
    fn test_bracket_order_16() {
        let order = generate_bracket_order(16);
        assert_eq!(order.len(), 16);
        assert_eq!(order[0], 1);
        assert_eq!(order[1], 16);
        // 1 and 2 should be in different halves
        let first_half: Vec<_> = order[..8].to_vec();
        let second_half: Vec<_> = order[8..].to_vec();
        assert!(first_half.contains(&1));
        assert!(second_half.contains(&2));
    }

    #[test]
    fn test_bracket_order_pairs_sum() {
        // In a correct bracket, each pair sums to bracket_size + 1
        for size in [4, 8, 16, 32, 64] {
            let order = generate_bracket_order(size);
            for pair in order.chunks(2) {
                assert_eq!(pair[0] + pair[1], size + 1);
            }
        }
    }
}
```

- [ ] **Step 4: Run the unit tests**

Run: `cd backend && cargo test orchestrator::seeding_engine::tests -- --nocapture`
Expected: All 4 tests PASS (bracket_order_4, bracket_order_8, bracket_order_16, bracket_order_pairs_sum)

- [ ] **Step 5: Commit**

```bash
git add backend/src/orchestrator/ backend/src/main.rs
git commit -m "feat(orchestrator): add SeedingEngine with Elo-based seeding and bracket generation"
```

---

## Task 3: Round Advancement Worker

**Files:**
- Create: `backend/src/orchestrator/round_advancement.rs`
- Modify: `backend/src/orchestrator/mod.rs`

- [ ] **Step 1: Update mod.rs to include round_advancement**

```rust
// backend/src/orchestrator/mod.rs
pub mod round_advancement;
pub mod seeding_engine;

pub use round_advancement::RoundAdvancementWorker;
pub use seeding_engine::SeedingEngine;
```

- [ ] **Step 2: Write the RoundAdvancementWorker**

```rust
// backend/src/orchestrator/round_advancement.rs
use crate::api_error::ApiError;
use crate::db::DbPool;
use chrono::Utc;
use uuid::Uuid;

pub struct RoundAdvancementWorker {
    db_pool: DbPool,
}

impl RoundAdvancementWorker {
    pub fn new(db_pool: DbPool) -> Self {
        Self { db_pool }
    }

    /// Called when a tournament match completes. Checks if the round is done
    /// and generates the next round if so.
    pub async fn on_match_completed(
        &self,
        tournament_id: Uuid,
        round_id: Uuid,
    ) -> Result<(), ApiError> {
        // Check if all matches in this round are done (Completed or Cancelled)
        let pending_count = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*) as "count!"
            FROM tournament_matches
            WHERE round_id = $1
              AND status NOT IN ('Completed', 'Cancelled')
            "#,
            round_id
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        if pending_count > 0 {
            return Ok(()); // Round not complete yet
        }

        // Check if next round already exists (idempotency)
        let current_round = sqlx::query!(
            "SELECT round_number FROM tournament_rounds WHERE id = $1",
            round_id
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let next_round_number = current_round.round_number + 1;

        let next_round_exists = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*) as "count!"
            FROM tournament_rounds
            WHERE tournament_id = $1 AND round_number = $2
            "#,
            tournament_id,
            next_round_number
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        if next_round_exists > 0 {
            return Ok(()); // Already advanced
        }

        // Mark current round as completed
        sqlx::query!(
            "UPDATE tournament_rounds SET status = 'Completed', completed_at = $2, updated_at = $2 WHERE id = $1",
            round_id,
            Utc::now()
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Collect winners from completed matches, ordered by match_number to preserve bracket structure
        let winners = sqlx::query!(
            r#"
            SELECT winner_id, match_number
            FROM tournament_matches
            WHERE round_id = $1 AND status = 'Completed' AND winner_id IS NOT NULL
            ORDER BY match_number ASC
            "#,
            round_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Also handle cancelled matches where opponent advances
        let cancelled_advances = sqlx::query!(
            r#"
            SELECT player1_id, player2_id, match_number
            FROM tournament_matches
            WHERE round_id = $1 AND status = 'Cancelled'
            ORDER BY match_number ASC
            "#,
            round_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Build ordered list of advancing players
        let mut advancers: Vec<(i32, Uuid)> = Vec::new();

        for w in &winners {
            if let Some(winner_id) = w.winner_id {
                advancers.push((w.match_number, winner_id));
            }
        }

        // For cancelled matches, pick whoever is still available
        // (both disqualified = no advancer for that slot)
        for m in &cancelled_advances {
            // If only one player exists, they advance
            if m.player2_id.is_none() {
                advancers.push((m.match_number, m.player1_id));
            }
            // If both exist but match is cancelled, neither advances (both disqualified)
            // The next round will have a bye in that slot
        }

        advancers.sort_by_key(|(match_num, _)| *match_num);
        let advancing_players: Vec<Uuid> = advancers.into_iter().map(|(_, id)| id).collect();

        if advancing_players.len() <= 1 {
            // Tournament is complete - the single remaining player is the winner
            // Mark tournament for finalization (PayoutSettler will handle this)
            sqlx::query!(
                "UPDATE tournaments SET status = 'Completed', end_time = $2, updated_at = $2 WHERE id = $1",
                tournament_id,
                Utc::now()
            )
            .execute(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;

            return Ok(());
        }

        // Determine round type
        let round_type = match advancing_players.len() {
            2 => "Final",
            4 => "Semifinal",
            _ => "Elimination",
        };

        // Create next round
        let next_round = sqlx::query!(
            r#"
            INSERT INTO tournament_rounds (
                id, tournament_id, round_number, round_type, status, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, 'InProgress', $5, $5)
            RETURNING id
            "#,
            Uuid::new_v4(),
            tournament_id,
            next_round_number,
            round_type,
            Utc::now()
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Pair advancing players sequentially: 0v1, 2v3, 4v5, etc.
        let num_matches = advancing_players.len() / 2;
        for match_idx in 0..num_matches {
            let player1 = advancing_players[match_idx * 2];
            let player2 = if match_idx * 2 + 1 < advancing_players.len() {
                Some(advancing_players[match_idx * 2 + 1])
            } else {
                None // Bye
            };

            let is_bye = player2.is_none();
            let winner_id = if is_bye { Some(player1) } else { None };
            let match_status = if is_bye { "Completed" } else { "Pending" };

            sqlx::query!(
                r#"
                INSERT INTO tournament_matches (
                    id, tournament_id, round_id, match_number, player1_id, player2_id,
                    winner_id, status, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
                "#,
                Uuid::new_v4(),
                tournament_id,
                next_round.id,
                (match_idx + 1) as i32,
                player1,
                player2,
                winner_id,
                match_status,
                Utc::now()
            )
            .execute(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;
        }

        // Handle odd number of advancing players - last player gets a bye
        if advancing_players.len() % 2 != 0 {
            let bye_player = *advancing_players.last().unwrap();
            sqlx::query!(
                r#"
                INSERT INTO tournament_matches (
                    id, tournament_id, round_id, match_number, player1_id, player2_id,
                    winner_id, status, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, NULL, $5, 'Completed', $6, $6)
                "#,
                Uuid::new_v4(),
                tournament_id,
                next_round.id,
                (num_matches + 1) as i32,
                bye_player,
                Utc::now()
            )
            .execute(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;
        }

        Ok(())
    }

    /// Polling fallback: finds tournaments with completed rounds that haven't advanced.
    /// Called periodically (every 60 seconds) by the orchestrator.
    pub async fn poll_for_stale_rounds(&self) -> Result<(), ApiError> {
        // Find in-progress tournaments where the latest round has all matches done
        // but no subsequent round exists
        let stale = sqlx::query!(
            r#"
            SELECT DISTINCT tr.tournament_id, tr.id as round_id, tr.round_number
            FROM tournament_rounds tr
            JOIN tournaments t ON t.id = tr.tournament_id AND t.status = 'InProgress'
            WHERE tr.status = 'InProgress'
              AND NOT EXISTS (
                  SELECT 1 FROM tournament_matches tm
                  WHERE tm.round_id = tr.id
                    AND tm.status NOT IN ('Completed', 'Cancelled')
              )
              AND NOT EXISTS (
                  SELECT 1 FROM tournament_rounds tr2
                  WHERE tr2.tournament_id = tr.tournament_id
                    AND tr2.round_number > tr.round_number
              )
            "#
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        for row in stale {
            tracing::info!(
                "Polling worker: advancing tournament {} round {}",
                row.tournament_id,
                row.round_number
            );
            if let Err(e) = self.on_match_completed(row.tournament_id, row.round_id).await {
                tracing::error!(
                    "Polling worker failed to advance tournament {}: {}",
                    row.tournament_id,
                    e
                );
            }
        }

        Ok(())
    }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd backend && cargo check 2>&1 | head -30`
Expected: No errors in the orchestrator module (pre-existing errors in other modules are expected)

- [ ] **Step 4: Commit**

```bash
git add backend/src/orchestrator/
git commit -m "feat(orchestrator): add RoundAdvancementWorker with event-driven and polling advancement"
```

---

## Task 4: Payout Settler

**Files:**
- Create: `backend/src/orchestrator/payout_settler.rs`
- Modify: `backend/src/orchestrator/mod.rs`

- [ ] **Step 1: Update mod.rs**

```rust
// backend/src/orchestrator/mod.rs
pub mod payout_settler;
pub mod round_advancement;
pub mod seeding_engine;

pub use payout_settler::PayoutSettler;
pub use round_advancement::RoundAdvancementWorker;
pub use seeding_engine::SeedingEngine;
```

- [ ] **Step 2: Write the PayoutSettler**

```rust
// backend/src/orchestrator/payout_settler.rs
use crate::api_error::ApiError;
use crate::db::DbPool;
use chrono::Utc;
use uuid::Uuid;

pub struct PayoutSettler {
    db_pool: DbPool,
}

impl PayoutSettler {
    pub fn new(db_pool: DbPool) -> Self {
        Self { db_pool }
    }

    /// Finalizes a completed tournament: computes rankings, distributes prizes idempotently.
    pub async fn finalize_tournament(
        &self,
        tournament_id: Uuid,
    ) -> Result<(), ApiError> {
        // Verify tournament is completed
        let tournament = sqlx::query!(
            "SELECT status, prize_pool, prize_pool_currency FROM tournaments WHERE id = $1",
            tournament_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .ok_or_else(|| ApiError::not_found("Tournament not found"))?;

        if tournament.status != "Completed" {
            return Err(ApiError::bad_request(
                "Tournament must be in Completed status to finalize",
            ));
        }

        // Idempotency check: skip if prizes already distributed
        let existing_payouts = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*) as "count!"
            FROM transactions
            WHERE description LIKE '%tournament:' || $1::text || '%'
              AND transaction_type = 'Prize'
            "#,
            tournament_id
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        if existing_payouts > 0 {
            tracing::info!(
                "Tournament {} already has payouts, skipping",
                tournament_id
            );
            return Ok(());
        }

        // Compute final rankings from bracket
        self.compute_rankings(tournament_id).await?;

        // Get prize pool info
        let prize_pool = sqlx::query!(
            "SELECT total_amount, currency, distribution_percentages FROM prize_pools WHERE tournament_id = $1",
            tournament_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let prize_pool = match prize_pool {
            Some(pp) => pp,
            None => {
                tracing::warn!("No prize pool found for tournament {}", tournament_id);
                return Ok(());
            }
        };

        // Parse distribution percentages
        let percentages: Vec<f64> =
            serde_json::from_str(&prize_pool.distribution_percentages).map_err(|e| {
                ApiError::internal_error(format!("Invalid distribution percentages: {}", e))
            })?;

        // Get ranked participants (only those with final_rank)
        let ranked = sqlx::query!(
            r#"
            SELECT id, user_id, final_rank
            FROM tournament_participants
            WHERE tournament_id = $1 AND final_rank IS NOT NULL
            ORDER BY final_rank ASC
            "#,
            tournament_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Distribute prizes within a transaction for atomicity
        let mut tx = self
            .db_pool
            .begin()
            .await
            .map_err(|e| ApiError::database_error(e))?;

        for participant in &ranked {
            let rank = participant.final_rank.unwrap_or(0);
            if rank < 1 || rank as usize > percentages.len() {
                continue;
            }

            let percentage = percentages[(rank - 1) as usize];
            let prize_amount = (prize_pool.total_amount as f64 * percentage / 100.0) as i64;

            if prize_amount <= 0 {
                continue;
            }

            // Update participant with prize amount
            sqlx::query!(
                "UPDATE tournament_participants SET prize_amount = $1, prize_currency = $2 WHERE id = $3",
                prize_amount,
                prize_pool.currency,
                participant.id
            )
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::database_error(e))?;

            // Credit wallet balance
            sqlx::query!(
                r#"
                UPDATE wallets SET balance_ngn = COALESCE(balance_ngn, 0) + $2, updated_at = $3
                WHERE user_id = $1
                "#,
                participant.user_id,
                prize_amount,
                Utc::now()
            )
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::database_error(e))?;

            // Create prize transaction record
            sqlx::query!(
                r#"
                INSERT INTO transactions (
                    id, user_id, transaction_type, amount, currency, status,
                    reference, description, created_at, updated_at
                ) VALUES ($1, $2, 'Prize', $3, $4, 'Completed', $5, $6, $7, $7)
                "#,
                Uuid::new_v4(),
                participant.user_id,
                rust_decimal::Decimal::from(prize_amount),
                prize_pool.currency,
                format!("prize-{}-{}", tournament_id, participant.user_id),
                format!("Tournament prize payout tournament:{} rank:{}", tournament_id, rank),
                Utc::now()
            )
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::database_error(e))?;

            tracing::info!(
                "Prize: {} {} to user {} (rank {})",
                prize_amount,
                prize_pool.currency,
                participant.user_id,
                rank
            );
        }

        tx.commit()
            .await
            .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }

    /// Computes final rankings by walking the bracket bottom-up.
    /// Winner of final = rank 1, loser = rank 2, semifinal losers = rank 3, etc.
    async fn compute_rankings(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        // Get all rounds ordered by round_number descending (final first)
        let rounds = sqlx::query!(
            r#"
            SELECT id, round_number
            FROM tournament_rounds
            WHERE tournament_id = $1
            ORDER BY round_number DESC
            "#,
            tournament_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let mut current_rank = 1;

        for round in &rounds {
            let matches = sqlx::query!(
                r#"
                SELECT winner_id, player1_id, player2_id, status
                FROM tournament_matches
                WHERE round_id = $1
                ORDER BY match_number ASC
                "#,
                round.id
            )
            .fetch_all(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;

            // For the final round, assign rank 1 to winner, rank 2 to loser
            // For other rounds, losers get the current_rank
            if current_rank == 1 {
                // Final round
                for m in &matches {
                    if let Some(winner_id) = m.winner_id {
                        self.set_participant_rank(tournament_id, winner_id, 1)
                            .await?;

                        // Loser is the other player
                        let loser_id = if m.player1_id == winner_id {
                            m.player2_id
                        } else {
                            Some(m.player1_id)
                        };
                        if let Some(loser) = loser_id {
                            self.set_participant_rank(tournament_id, loser, 2).await?;
                        }
                    }
                }
                current_rank = 3;
            } else {
                // Earlier rounds: losers share the current rank
                let mut losers = Vec::new();
                for m in &matches {
                    if m.status == "Completed" {
                        if let Some(winner_id) = m.winner_id {
                            let loser_id = if m.player1_id == winner_id {
                                m.player2_id
                            } else {
                                Some(m.player1_id)
                            };
                            if let Some(loser) = loser_id {
                                losers.push(loser);
                            }
                        }
                    }
                }

                for loser in &losers {
                    self.set_participant_rank(tournament_id, *loser, current_rank)
                        .await?;
                }

                // Next group of losers starts at current_rank + count_of_losers
                current_rank += losers.len() as i32;
            }
        }

        // Mark eliminated participants
        sqlx::query!(
            r#"
            UPDATE tournament_participants
            SET status = 'Eliminated', eliminated_at = $2
            WHERE tournament_id = $1 AND final_rank IS NOT NULL AND final_rank > 1
            "#,
            tournament_id,
            Utc::now()
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }

    async fn set_participant_rank(
        &self,
        tournament_id: Uuid,
        user_id: Uuid,
        rank: i32,
    ) -> Result<(), ApiError> {
        sqlx::query!(
            "UPDATE tournament_participants SET final_rank = $3 WHERE tournament_id = $1 AND user_id = $2",
            tournament_id,
            user_id,
            rank
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;
        Ok(())
    }

    /// Polling helper: find completed tournaments that haven't been finalized yet.
    pub async fn poll_for_unfinalized(&self) -> Result<(), ApiError> {
        let unfinalized = sqlx::query!(
            r#"
            SELECT t.id
            FROM tournaments t
            WHERE t.status = 'Completed'
              AND t.cleaned_up_at IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM transactions tx
                  WHERE tx.description LIKE '%tournament:' || t.id::text || '%'
                    AND tx.transaction_type = 'Prize'
              )
            "#
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        for row in unfinalized {
            tracing::info!("Polling worker: finalizing tournament {}", row.id);
            if let Err(e) = self.finalize_tournament(row.id).await {
                tracing::error!(
                    "Polling worker failed to finalize tournament {}: {}",
                    row.id,
                    e
                );
            }
        }

        Ok(())
    }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd backend && cargo check 2>&1 | head -30`
Expected: No new errors in the orchestrator module

- [ ] **Step 4: Commit**

```bash
git add backend/src/orchestrator/
git commit -m "feat(orchestrator): add PayoutSettler with idempotent prize distribution and ranking computation"
```

---

## Task 5: Tournament Cleanup Service

**Files:**
- Create: `backend/src/orchestrator/tournament_cleanup.rs`
- Modify: `backend/src/orchestrator/mod.rs`

- [ ] **Step 1: Update mod.rs**

```rust
// backend/src/orchestrator/mod.rs
pub mod payout_settler;
pub mod round_advancement;
pub mod seeding_engine;
pub mod tournament_cleanup;

pub use payout_settler::PayoutSettler;
pub use round_advancement::RoundAdvancementWorker;
pub use seeding_engine::SeedingEngine;
pub use tournament_cleanup::TournamentCleanup;
```

- [ ] **Step 2: Write the TournamentCleanup service**

```rust
// backend/src/orchestrator/tournament_cleanup.rs
use crate::api_error::ApiError;
use crate::db::DbPool;
use chrono::{Duration, Utc};
use uuid::Uuid;

/// Configurable timeouts for cleanup behavior
pub struct CleanupConfig {
    /// How long a match can be stuck before force-cancelling (default: 24 hours)
    pub stuck_match_timeout_hours: i64,
    /// How long a tournament can be in-progress with no activity before flagging (default: 7 days)
    pub stale_tournament_days: i64,
}

impl Default for CleanupConfig {
    fn default() -> Self {
        Self {
            stuck_match_timeout_hours: 24,
            stale_tournament_days: 7,
        }
    }
}

pub struct TournamentCleanup {
    db_pool: DbPool,
    config: CleanupConfig,
}

impl TournamentCleanup {
    pub fn new(db_pool: DbPool) -> Self {
        Self {
            db_pool,
            config: CleanupConfig::default(),
        }
    }

    pub fn with_config(db_pool: DbPool, config: CleanupConfig) -> Self {
        Self { db_pool, config }
    }

    /// Run cleanup for a specific completed tournament.
    pub async fn cleanup_tournament(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        // 1. Force-cancel stuck matches
        let stuck_cutoff =
            Utc::now() - Duration::hours(self.config.stuck_match_timeout_hours);

        let stuck_matches = sqlx::query!(
            r#"
            UPDATE tournament_matches
            SET status = 'Cancelled', updated_at = $3
            WHERE tournament_id = $1
              AND status IN ('Pending', 'InProgress')
              AND created_at < $2
            RETURNING id, player1_id, player2_id
            "#,
            tournament_id,
            stuck_cutoff,
            Utc::now()
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        if !stuck_matches.is_empty() {
            tracing::warn!(
                "Force-cancelled {} stuck matches in tournament {}",
                stuck_matches.len(),
                tournament_id
            );
        }

        // 2. Ensure all participants have final status
        sqlx::query!(
            r#"
            UPDATE tournament_participants
            SET status = 'Eliminated', eliminated_at = COALESCE(eliminated_at, $2)
            WHERE tournament_id = $1
              AND final_rank IS NOT NULL
              AND final_rank > 1
              AND status NOT IN ('Eliminated', 'Disqualified', 'Withdrawn')
            "#,
            tournament_id,
            Utc::now()
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // 3. Release any remaining escrow back to users
        let escrow_holders = sqlx::query!(
            r#"
            SELECT w.user_id, w.escrow_balance
            FROM wallets w
            JOIN tournament_participants tp ON tp.user_id = w.user_id
            WHERE tp.tournament_id = $1
              AND w.escrow_balance > 0
            "#,
            tournament_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        for holder in &escrow_holders {
            let escrow_amount = holder.escrow_balance;
            sqlx::query!(
                r#"
                UPDATE wallets
                SET balance = balance + $2,
                    escrow_balance = escrow_balance - $2,
                    updated_at = $3
                WHERE user_id = $1
                "#,
                holder.user_id,
                escrow_amount,
                Utc::now()
            )
            .execute(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;

            // Record refund transaction
            sqlx::query!(
                r#"
                INSERT INTO transactions (
                    id, user_id, transaction_type, amount, currency, status,
                    reference, description, created_at, updated_at
                ) VALUES ($1, $2, 'Refund', $3, 'NGN', 'Completed', $4, $5, $6, $6)
                "#,
                Uuid::new_v4(),
                holder.user_id,
                escrow_amount,
                format!("escrow-release-{}-{}", tournament_id, holder.user_id),
                format!("Escrow release for tournament:{}", tournament_id),
                Utc::now()
            )
            .execute(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;

            tracing::info!(
                "Released {} escrow for user {} in tournament {}",
                escrow_amount,
                holder.user_id,
                tournament_id
            );
        }

        // 4. Set cleanup timestamp
        sqlx::query!(
            "UPDATE tournaments SET cleaned_up_at = $2, updated_at = $2 WHERE id = $1",
            tournament_id,
            Utc::now()
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        tracing::info!("Cleanup complete for tournament {}", tournament_id);
        Ok(())
    }

    /// Polling helper: find completed tournaments that need cleanup.
    pub async fn poll_for_cleanup(&self) -> Result<(), ApiError> {
        let needs_cleanup = sqlx::query!(
            r#"
            SELECT id FROM tournaments
            WHERE status = 'Completed' AND cleaned_up_at IS NULL
            "#
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        for row in needs_cleanup {
            if let Err(e) = self.cleanup_tournament(row.id).await {
                tracing::error!(
                    "Cleanup failed for tournament {}: {}",
                    row.id,
                    e
                );
            }
        }

        // Flag stale tournaments for admin review
        let stale_cutoff =
            Utc::now() - Duration::days(self.config.stale_tournament_days);

        let stale_count = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*) as "count!"
            FROM tournaments
            WHERE status = 'InProgress'
              AND updated_at < $1
            "#,
            stale_cutoff
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        if stale_count > 0 {
            tracing::warn!(
                "{} tournaments have been InProgress for over {} days — admin review needed",
                stale_count,
                self.config.stale_tournament_days
            );
        }

        Ok(())
    }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd backend && cargo check 2>&1 | head -30`
Expected: No new errors in the orchestrator module

- [ ] **Step 4: Commit**

```bash
git add backend/src/orchestrator/
git commit -m "feat(orchestrator): add TournamentCleanup service with escrow release and stale detection"
```

---

## Task 6: Tournament Orchestrator + Polling Worker

**Files:**
- Create: `backend/src/orchestrator/tournament_orchestrator.rs`
- Modify: `backend/src/orchestrator/mod.rs`
- Modify: `backend/src/main.rs`

- [ ] **Step 1: Update mod.rs**

```rust
// backend/src/orchestrator/mod.rs
pub mod payout_settler;
pub mod round_advancement;
pub mod seeding_engine;
pub mod tournament_cleanup;
pub mod tournament_orchestrator;

pub use payout_settler::PayoutSettler;
pub use round_advancement::RoundAdvancementWorker;
pub use seeding_engine::SeedingEngine;
pub use tournament_cleanup::TournamentCleanup;
pub use tournament_orchestrator::TournamentOrchestrator;
```

- [ ] **Step 2: Write the TournamentOrchestrator**

```rust
// backend/src/orchestrator/tournament_orchestrator.rs
use crate::db::DbPool;
use crate::orchestrator::{
    PayoutSettler, RoundAdvancementWorker, SeedingEngine, TournamentCleanup,
};
use std::sync::Arc;
use std::time::Duration;
use tokio::time;
use uuid::Uuid;

/// Coordinates all tournament lifecycle components and runs the polling worker.
pub struct TournamentOrchestrator {
    pub seeding: SeedingEngine,
    pub advancement: RoundAdvancementWorker,
    pub payout: PayoutSettler,
    pub cleanup: TournamentCleanup,
}

impl TournamentOrchestrator {
    pub fn new(db_pool: DbPool) -> Self {
        Self {
            seeding: SeedingEngine::new(db_pool.clone()),
            advancement: RoundAdvancementWorker::new(db_pool.clone()),
            payout: PayoutSettler::new(db_pool.clone()),
            cleanup: TournamentCleanup::new(db_pool),
        }
    }

    /// Start the background polling worker. Call this once at application startup.
    /// Returns a JoinHandle that runs until the application shuts down.
    pub fn spawn_polling_worker(db_pool: DbPool, interval_secs: u64) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let advancement = RoundAdvancementWorker::new(db_pool.clone());
            let payout = PayoutSettler::new(db_pool.clone());
            let cleanup = TournamentCleanup::new(db_pool);

            let mut interval = time::interval(Duration::from_secs(interval_secs));

            loop {
                interval.tick().await;

                tracing::debug!("Tournament polling worker running...");

                if let Err(e) = advancement.poll_for_stale_rounds().await {
                    tracing::error!("Polling: round advancement error: {}", e);
                }

                if let Err(e) = payout.poll_for_unfinalized().await {
                    tracing::error!("Polling: payout finalization error: {}", e);
                }

                if let Err(e) = cleanup.poll_for_cleanup().await {
                    tracing::error!("Polling: cleanup error: {}", e);
                }
            }
        })
    }
}
```

- [ ] **Step 3: Add the polling worker to main.rs**

Modify `backend/src/main.rs` to spawn the polling worker. Add the import and spawn call:

After `mod orchestrator;` (added in Task 2), and inside the `main` function after the db_pool is created (after line 30), add:

```rust
    // Spawn tournament orchestrator polling worker
    let _orchestrator_handle = crate::orchestrator::TournamentOrchestrator::spawn_polling_worker(
        db_pool.clone(),
        60, // poll every 60 seconds
    );
    tracing::info!("Tournament orchestrator polling worker started");
```

- [ ] **Step 4: Verify it compiles**

Run: `cd backend && cargo check 2>&1 | head -30`
Expected: No new errors in orchestrator module

- [ ] **Step 5: Commit**

```bash
git add backend/src/orchestrator/ backend/src/main.rs
git commit -m "feat(orchestrator): add TournamentOrchestrator with background polling worker"
```

---

## Task 7: Integration — Wire SeedingEngine into TournamentService

**Files:**
- Modify: `backend/src/service/tournament_service.rs:658-812` (replace `start_tournament` and `generate_single_elimination_bracket`)

- [ ] **Step 1: Replace the existing `start_tournament` method**

In `backend/src/service/tournament_service.rs`, replace the existing `start_tournament` method (lines 658-678) with:

```rust
    async fn start_tournament(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        // Use the orchestrator's SeedingEngine for bracket generation
        let seeding = crate::orchestrator::SeedingEngine::new(self.db_pool.clone());
        seeding.seed_and_generate_bracket(tournament_id).await?;
        Ok(())
    }
```

This replaces the old flow that called `generate_tournament_bracket` (which ordered by registration time, not Elo) with the new SeedingEngine (which orders by Elo with proper bracket placement and bye handling).

- [ ] **Step 2: Verify it compiles**

Run: `cd backend && cargo check 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/service/tournament_service.rs
git commit -m "feat(orchestrator): wire SeedingEngine into TournamentService.start_tournament"
```

---

## Task 8: Integration — Wire RoundAdvancementWorker into Match Completion

**Files:**
- Modify: `backend/src/service/match_service.rs` (add call to RoundAdvancementWorker in `process_match_completion`)

- [ ] **Step 1: Find and modify `process_match_completion` in match_service.rs**

Read the existing `process_match_completion` method first to find the exact insertion point. At the end of the method, after Elo ratings are updated and before the final `Ok(())`, add the tournament round advancement call:

```rust
        // If this was a tournament match, trigger round advancement
        if let Some(tournament_id) = match_record.tournament_id {
            if let Some(round_id) = match_record.round_id {
                let advancement = crate::orchestrator::RoundAdvancementWorker::new(self.db_pool.clone());
                if let Err(e) = advancement.on_match_completed(tournament_id, round_id).await {
                    tracing::error!(
                        "Round advancement failed for tournament {} round {}: {}",
                        tournament_id,
                        round_id,
                        e
                    );
                    // Don't fail the match completion — the polling worker will retry
                }
            }
        }
```

Note: The round advancement call is wrapped in error handling so match completion always succeeds. The polling fallback worker will catch any missed advancements.

- [ ] **Step 2: Verify it compiles**

Run: `cd backend && cargo check 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/service/match_service.rs
git commit -m "feat(orchestrator): wire RoundAdvancementWorker into match completion flow"
```

---

## Task 9: Integration — Wire PayoutSettler into Tournament Completion

**Files:**
- Modify: `backend/src/service/tournament_service.rs` (replace `complete_tournament` and `distribute_prizes`)

- [ ] **Step 1: Replace the `complete_tournament` method**

In `backend/src/service/tournament_service.rs`, replace the existing `complete_tournament` method (lines 680-688) with:

```rust
    async fn complete_tournament(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        let payout = crate::orchestrator::PayoutSettler::new(self.db_pool.clone());
        payout.finalize_tournament(tournament_id).await?;

        let cleanup = crate::orchestrator::TournamentCleanup::new(self.db_pool.clone());
        cleanup.cleanup_tournament(tournament_id).await?;

        Ok(())
    }
```

This replaces the old stub that only logged prizes with the full payout + cleanup flow.

- [ ] **Step 2: Verify it compiles**

Run: `cd backend && cargo check 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/service/tournament_service.rs
git commit -m "feat(orchestrator): wire PayoutSettler and TournamentCleanup into tournament completion"
```

---

## Task 10: Final Verification and Cleanup

**Files:**
- All orchestrator files

- [ ] **Step 1: Run all unit tests**

Run: `cd backend && cargo test orchestrator -- --nocapture`
Expected: All bracket order tests pass

- [ ] **Step 2: Run full cargo check**

Run: `cd backend && cargo check 2>&1 | grep "error\[E" | grep -c orchestrator`
Expected: Output `0` — no errors in orchestrator code

- [ ] **Step 3: Verify the module structure is correct**

Run: `find backend/src/orchestrator -type f | sort`
Expected output:
```
backend/src/orchestrator/mod.rs
backend/src/orchestrator/payout_settler.rs
backend/src/orchestrator/round_advancement.rs
backend/src/orchestrator/seeding_engine.rs
backend/src/orchestrator/tournament_cleanup.rs
backend/src/orchestrator/tournament_orchestrator.rs
```

- [ ] **Step 4: Verify migrations exist**

Run: `ls backend/migrations/*orchestrator*`
Expected:
```
backend/migrations/20260326000001_tournament_orchestrator.down.sql
backend/migrations/20260326000001_tournament_orchestrator.up.sql
```

- [ ] **Step 5: Final commit if any remaining changes**

```bash
git status
# If any unstaged changes:
git add -A backend/src/orchestrator/ backend/migrations/
git commit -m "chore(orchestrator): final verification and cleanup"
```
