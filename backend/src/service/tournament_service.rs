//! Tournament service
//!
//! Resolves GitHub issue #448: bracket generation stubs (double elimination,
//! round robin, Swiss) silently produced no rounds/matches. Bracket creation
//! is now delegated to [`crate::service::bracket_generator::BracketGenerator`],
//! which produces real rounds and matches and persists them in a single
//! transaction.

use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::*;
use crate::service::soroban_service::{SorobanService, TxStatus};
use crate::service::stellar_service::stellar_strkey_encode;
use chrono::{DateTime, Utc};
use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;
use redis::Client as RedisClient;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

pub struct TournamentService {
    db_pool: DbPool,
    redis_client: Option<Arc<RedisClient>>,
    soroban_service: Option<Arc<SorobanService>>,
    prize_contract_id: Option<String>,
    admin_secret: Option<String>,
}

impl TournamentService {
    pub fn new(db_pool: DbPool) -> Self {
        Self {
            db_pool,
            redis_client: None,
            soroban_service: None,
            prize_contract_id: None,
            admin_secret: None,
        }
    }

    pub fn with_redis(mut self, redis_client: Arc<RedisClient>) -> Self {
        self.redis_client = Some(redis_client);
        self
    }

    /// Attach a Soroban service and prize contract configuration so that
    /// `distribute_prizes` can execute real on-chain transfers.
    pub fn with_soroban(
        mut self,
        soroban_service: Arc<SorobanService>,
        prize_contract_id: String,
        admin_secret: String,
    ) -> Self {
        self.soroban_service = Some(soroban_service);
        self.prize_contract_id = Some(prize_contract_id);
        self.admin_secret = Some(admin_secret);
        self
    }

    /// Create a new tournament
    pub async fn create_tournament(
        &self,
        creator_id: Uuid,
        request: CreateTournamentRequest,
    ) -> Result<Tournament, ApiError> {
        self.validate_tournament_creation(&request).await?;

        let tournament = sqlx::query_as!(
            Tournament,
            r#"
            INSERT INTO tournaments (
                id, name, description, game, max_participants, entry_fee, entry_fee_currency,
                prize_pool, prize_pool_currency, status, start_time, registration_deadline,
                created_by, created_at, updated_at, bracket_type, rules, min_skill_level, max_skill_level
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
            ) RETURNING *
            "#,
            Uuid::new_v4(),
            request.name,
            request.description,
            request.game,
            request.max_participants,
            request.entry_fee,
            request.entry_fee_currency,
            0i64,
            request.entry_fee_currency.clone(),
            TournamentStatus::Draft as _,
            request.start_time,
            request.registration_deadline,
            creator_id,
            Utc::now(),
            Utc::now(),
            request.bracket_type as _,
            request.rules,
            request.min_skill_level,
            request.max_skill_level
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        self.create_prize_pool(&tournament.id, &request.entry_fee_currency)
            .await?;

        self.publish_tournament_event(serde_json::json!({
            "type": "created",
            "tournament_id": tournament.id,
            "name": tournament.name.clone(),
            "game": tournament.game.clone(),
            "max_participants": tournament.max_participants,
        }))
        .await?;

        self.publish_global_event(serde_json::json!({
            "type": "tournament_created",
            "tournament_id": tournament.id,
            "name": tournament.name.clone(),
            "game": tournament.game.clone(),
        }))
        .await?;

        Ok(tournament)
    }

    /// List tournaments (paginated, with optional filters).
    pub async fn get_tournaments(
        &self,
        user_id: Option<Uuid>,
        page: i32,
        per_page: i32,
        status_filter: Option<TournamentStatus>,
        game_filter: Option<String>,
    ) -> Result<TournamentListResponse, ApiError> {
        let offset = (page - 1) * per_page;

        let tournaments = sqlx::query!(
            r#"
            SELECT t.*, COUNT(tp.id) as current_participants
            FROM tournaments t
            LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id
            WHERE ($1::text IS NULL OR t.status = $1::tournament_status)
            AND ($2::text IS NULL OR t.game = $2)
            GROUP BY t.id
            ORDER BY t.created_at DESC
            LIMIT $3 OFFSET $4
            "#,
            status_filter.map(|s| s as i32),
            game_filter,
            per_page,
            offset
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let total = sqlx::query!(
            r#"
            SELECT COUNT(*) as count
            FROM tournaments t
            WHERE ($1::text IS NULL OR t.status = $1::tournament_status)
            AND ($2::text IS NULL OR t.game = $2)
            "#,
            status_filter.map(|s| s as i32),
            game_filter
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .count
        .unwrap_or(0);

        let mut tournament_responses = Vec::new();
        for row in tournaments {
            let is_participant = if let Some(uid) = user_id {
                self.is_user_participant(uid, row.id).await.unwrap_or(false)
            } else {
                false
            };

            let participant_status = if is_participant {
                self.get_participant_status(user_id.unwrap(), row.id)
                    .await
                    .ok()
            } else {
                None
            };

            let can_join = self
                .can_user_join_tournament(user_id, row.id)
                .await
                .unwrap_or(false);

            tournament_responses.push(TournamentResponse {
                id: row.id,
                name: row.name,
                description: row.description,
                game: row.game,
                max_participants: row.max_participants,
                current_participants: row.current_participants.unwrap_or(0) as i32,
                entry_fee: row.entry_fee,
                entry_fee_currency: row.entry_fee_currency,
                prize_pool: row.prize_pool,
                prize_pool_currency: row.prize_pool_currency,
                status: row.status.into(),
                start_time: row.start_time,
                end_time: row.end_time,
                registration_deadline: row.registration_deadline,
                bracket_type: row.bracket_type.into(),
                can_join,
                is_participant,
                participant_status,
            });
        }

        Ok(TournamentListResponse {
            tournaments: tournament_responses,
            total,
            page,
            per_page,
        })
    }

    /// Get a single tournament by id.
    pub async fn get_tournament(
        &self,
        tournament_id: Uuid,
        user_id: Option<Uuid>,
    ) -> Result<TournamentResponse, ApiError> {
        let tournament = sqlx::query!(
            r#"
            SELECT t.*, COUNT(tp.id) as current_participants
            FROM tournaments t
            LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id
            WHERE t.id = $1
            GROUP BY t.id
            "#,
            tournament_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .ok_or(ApiError::not_found("Tournament not found"))?;

        let is_participant = if let Some(uid) = user_id {
            self.is_user_participant(uid, tournament_id)
                .await
                .unwrap_or(false)
        } else {
            false
        };

        let participant_status = if is_participant {
            self.get_participant_status(user_id.unwrap(), tournament_id)
                .await
                .ok()
        } else {
            None
        };

        let can_join = self
            .can_user_join_tournament(user_id, tournament_id)
            .await
            .unwrap_or(false);

        Ok(TournamentResponse {
            id: tournament.id,
            name: tournament.name,
            description: tournament.description,
            game: tournament.game,
            max_participants: tournament.max_participants,
            current_participants: tournament.current_participants.unwrap_or(0) as i32,
            entry_fee: tournament.entry_fee,
            entry_fee_currency: tournament.entry_fee_currency,
            prize_pool: tournament.prize_pool,
            prize_pool_currency: tournament.prize_pool_currency,
            status: tournament.status.into(),
            start_time: tournament.start_time,
            end_time: tournament.end_time,
            registration_deadline: tournament.registration_deadline,
            bracket_type: tournament.bracket_type.into(),
            can_join,
            is_participant,
            participant_status,
        })
    }

    /// Join a tournament (handles payment).
    pub async fn join_tournament(
        &self,
        user_id: Uuid,
        tournament_id: Uuid,
        request: JoinTournamentRequest,
    ) -> Result<TournamentParticipant, ApiError> {
        // ── Pre-transaction reads & external verification ────────────────────
        // These must run outside the transaction: reads are non-mutating, and
        // the external payment-provider call must not hold a DB connection open.

        let tournament = self.get_tournament_by_id(tournament_id).await?;
        self.validate_tournament_join(&tournament, user_id).await?;

        if self.is_user_participant(user_id, tournament_id).await? {
            return Err(ApiError::bad_request("User is already a participant"));
        }

        // For ArenaX token payments, verify the wallet balance before we
        // open a transaction so we fail fast without acquiring a connection.
        if request.payment_method == "arenax_token" {
            let wallet = self.get_user_wallet(user_id).await?;
            let balance = wallet.balance_arenax_tokens.unwrap_or(0);
            if balance < tournament.entry_fee {
                return Err(ApiError::bad_request("Insufficient ArenaX token balance"));
            }
        }

        // For fiat payments, call the external provider API before the
        // transaction so network latency never blocks a DB connection.
        if request.payment_method == "fiat" {
            let reference = request
                .payment_reference
                .as_ref()
                .ok_or_else(|| ApiError::bad_request("Payment reference is required for fiat payments"))?;

            let payment_verified = self
                .verify_payment_with_provider(reference, tournament.entry_fee)
                .await?;

            if !payment_verified {
                return Err(ApiError::bad_request("Payment verification failed"));
            }
        }

        // ── Atomic DB writes inside a transaction ────────────────────────────
        // Begin transaction: all writes below succeed or all are rolled back.
        let mut tx = self
            .db_pool
            .begin()
            .await
            .map_err(|e| ApiError::database_error(e))?;

        // Step 1: record the payment (wallet debit + transaction log)
        self.process_entry_fee_payment_in_tx(user_id, &tournament, &request, &mut tx)
            .await?;

        // Step 2: register the participant
        let participant = sqlx::query_as!(
            TournamentParticipant,
            r#"
            INSERT INTO tournament_participants (
                id, tournament_id, user_id, registered_at, entry_fee_paid, status
            ) VALUES (
                $1, $2, $3, $4, $5, $6
            ) RETURNING *
            "#,
            Uuid::new_v4(),
            tournament_id,
            user_id,
            Utc::now(),
            true,
            ParticipantStatus::Paid as _
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Step 3: add entry fee to prize pool
        self.update_prize_pool_in_tx(tournament_id, tournament.entry_fee, &mut tx)
            .await?;

        // Step 4: close registration if the tournament is now full
        self.update_tournament_status_if_needed_in_tx(tournament_id, &mut tx)
            .await?;

        // Commit — if anything above failed we already returned an Err and
        // the transaction will be rolled back automatically on drop.
        tx.commit()
            .await
            .map_err(|e| ApiError::database_error(e))?;

        // ── Post-commit side-effects (non-atomic, best-effort) ───────────────
        // Events are published after the commit so we never emit an event for
        // a registration that was rolled back.
        let username = self
            .get_user_username(user_id)
            .await
            .unwrap_or_else(|| "Unknown".to_string());

        let participant_count = self
            .get_participant_count(tournament_id)
            .await
            .unwrap_or(0);

        // Fire-and-forget: event publication failure must not un-register the player.
        let _ = self
            .publish_tournament_event(serde_json::json!({
                "type": "participant_joined",
                "tournament_id": tournament_id,
                "user_id": user_id,
                "username": username,
                "participant_count": participant_count,
            }))
            .await;

        Ok(participant)
    }

    /// Update a tournament's status (e.g., start, complete).
    pub async fn update_tournament_status(
        &self,
        tournament_id: Uuid,
        new_status: TournamentStatus,
    ) -> Result<Tournament, ApiError> {
        let tournament = sqlx::query_as!(
            Tournament,
            r#"
            UPDATE tournaments
            SET status = $1, updated_at = $2
            WHERE id = $3
            RETURNING *
            "#,
            new_status as _,
            Utc::now(),
            tournament_id
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        match new_status {
            TournamentStatus::InProgress => {
                self.start_tournament(tournament_id).await?;
            }
            TournamentStatus::Completed => {
                self.complete_tournament(tournament_id).await?;
            }
            _ => {}
        }

        let old_status = self.get_tournament_by_id(tournament_id).await?.status;
        self.publish_tournament_event(serde_json::json!({
            "type": "status_changed",
            "tournament_id": tournament_id,
            "old_status": old_status,
            "new_status": new_status,
        }))
        .await?;

        Ok(tournament)
    }

    /// List the participants of a tournament.
    pub async fn get_tournament_participants(
        &self,
        tournament_id: Uuid,
    ) -> Result<Vec<TournamentParticipant>, ApiError> {
        sqlx::query_as!(
            TournamentParticipant,
            "SELECT * FROM tournament_participants WHERE tournament_id = $1 ORDER BY registered_at",
            tournament_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))
    }

    /// Read the persisted bracket for a tournament (all rounds and matches).
    pub async fn get_tournament_bracket(
        &self,
        tournament_id: Uuid,
    ) -> Result<TournamentBracketResponse, ApiError> {
        let rounds = sqlx::query_as!(
            TournamentRound,
            "SELECT * FROM tournament_rounds WHERE tournament_id = $1 ORDER BY round_number",
            tournament_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let mut bracket_rounds = Vec::with_capacity(rounds.len());
        for round in rounds {
            let matches = sqlx::query_as!(
                TournamentMatch,
                "SELECT * FROM tournament_matches WHERE round_id = $1 ORDER BY match_number",
                round.id
            )
            .fetch_all(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;

            bracket_rounds.push(BracketRound {
                round_id: round.id,
                round_number: round.round_number,
                round_type: round.round_type.parse().unwrap_or(RoundType::Elimination),
                status: round.status.parse().unwrap_or(RoundStatus::Pending),
                matches: matches
                    .into_iter()
                    .map(|m| BracketMatch {
                        match_id: m.id,
                        match_number: m.match_number,
                        player1_id: m.player1_id,
                        player2_id: m.player2_id,
                        winner_id: m.winner_id,
                        player1_score: m.player1_score,
                        player2_score: m.player2_score,
                        status: m.status.parse().unwrap_or(MatchStatus::Pending),
                    })
                    .collect(),
            });
        }

        Ok(TournamentBracketResponse {
            tournament_id,
            rounds: bracket_rounds,
        })
    }

    // =================================================================
    // Bracket generation - delegated to BracketGenerator
    // =================================================================

    /// Generate the bracket for a tournament.
    ///
    /// This is the only public entry point for bracket creation and is
    /// responsible for dispatching to the right algorithm in
    /// [`BracketGenerator`] and persisting the result.
    pub async fn generate_tournament_bracket(
        &self,
        tournament_id: Uuid,
    ) -> Result<(), ApiError> {
        // Fetch active participants in seeding order (lowest registration
        // number first; the SeedingEngine upstream is responsible for Elo
        // ordering when ELO is available).
        let participants = sqlx::query_as!(
            TournamentParticipant,
            r#"
            SELECT * FROM tournament_participants
            WHERE tournament_id = $1 AND status = $2
            ORDER BY COALESCE(seed_number, 2147483647), registered_at
            "#,
            tournament_id,
            ParticipantStatus::Active as _
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let tournament = self.get_tournament_by_id(tournament_id).await?;
        let user_ids: Vec<Uuid> = participants.iter().map(|p| p.user_id).collect();

        let generator = BracketGenerator::new(self.db_pool.clone());
        let bracket = generator
            .generate(tournament.bracket_type, user_ids)
            .await?;
        generator.persist(tournament_id, &bracket).await?;

        Ok(())
    }

    /// Advance a Swiss-format tournament to its next round. Idempotent only
    /// after a round has been completed; otherwise returns
    /// [`ApiError::BadRequest`].
    pub async fn advance_swiss_round(
        &self,
        tournament_id: Uuid,
    ) -> Result<crate::service::bracket_generator::GeneratedRound, ApiError> {
        let tournament = self.get_tournament_by_id(tournament_id).await?;
        if tournament.bracket_type != BracketType::Swiss {
            return Err(ApiError::bad_request(
                "Tournament is not a Swiss-format tournament",
            ));
        }
        let generator = BracketGenerator::new(self.db_pool.clone());
        let round = generator
            .generate_next_swiss_round(tournament_id)
            .await?;
        // Persist the round
        let generated_bracket = crate::service::bracket_generator::GeneratedBracket {
            rounds: vec![round.clone()],
        };
        generator.persist(tournament_id, &generated_bracket).await?;
        Ok(round)
    }

    // =================================================================
    // Tournament lifecycle (used by orchestrator)
    // =================================================================

    async fn start_tournament(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        self.generate_tournament_bracket(tournament_id).await?;
        Ok(())
    }

    async fn complete_tournament(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        self.calculate_final_rankings(tournament_id).await?;
        self.distribute_prizes(tournament_id).await?;
        Ok(())
    }

    async fn calculate_final_rankings(
        &self,
        tournament_id: Uuid,
    ) -> Result<(), ApiError> {
        let participants = sqlx::query_as!(
            TournamentParticipant,
            "SELECT * FROM tournament_participants WHERE tournament_id = $1 AND status = $2",
            tournament_id,
            ParticipantStatus::Active as _
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let tournament = self.get_tournament_by_id(tournament_id).await?;

        match tournament.bracket_type {
            BracketType::SingleElimination | BracketType::DoubleElimination => {
                self.calculate_elimination_rankings(tournament_id, &participants)
                    .await?;
            }
            BracketType::RoundRobin => {
                self.calculate_round_robin_rankings(tournament_id, &participants)
                    .await?;
            }
            BracketType::Swiss => {
                self.calculate_swiss_rankings(tournament_id, &participants)
                    .await?;
            }
        }

        Ok(())
    }

    async fn distribute_prizes(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        let prize_pool = sqlx::query!(
            "SELECT * FROM prize_pools WHERE tournament_id = $1",
            tournament_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .ok_or(ApiError::not_found("Prize pool not found"))?;

        let participants = sqlx::query_as!(
            TournamentParticipant,
            "SELECT * FROM tournament_participants WHERE tournament_id = $1 AND final_rank IS NOT NULL ORDER BY final_rank",
            tournament_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let percentages: Vec<f64> = serde_json::from_str(&prize_pool.distribution_percentages)
            .map_err(|e| {
                ApiError::internal_error(format!("Invalid distribution percentages: {}", e))
            })?;

        for (index, participant) in participants.iter().enumerate() {
            if index < percentages.len() && participant.final_rank.unwrap_or(0) <= 3 {
                let percentage = percentages[index];
                let prize_amount =
                    (prize_pool.total_amount as f64 * percentage / 100.0) as i64;

                sqlx::query!(
                    "UPDATE tournament_participants SET prize_amount = $1, prize_currency = $2 WHERE id = $3",
                    prize_amount,
                    prize_pool.currency,
                    participant.id
                )
                .execute(&self.db_pool)
                .await
                .map_err(|e| ApiError::database_error(e))?;

                tracing::info!(
                    "Prize distributed: {} {} to user {}",
                    prize_amount,
                    prize_pool.currency,
                    participant.user_id
                );
            }
        }

        Ok(())
    }

    async fn calculate_elimination_rankings(
        &self,
        tournament_id: Uuid,
        _participants: &[TournamentParticipant],
    ) -> Result<(), ApiError> {
        // Walk completed matches from the highest round backwards; the first
        // player who lost in round `W` is rank 2, the loser in round `W-1` is
        // rank 3, etc. Winners of the final are rank 1.
        let matches = sqlx::query_as!(
            TournamentMatch,
            r#"
            SELECT tm.* FROM tournament_matches tm
            JOIN tournament_rounds tr ON tm.round_id = tr.id
            WHERE tm.tournament_id = $1 AND tm.status = 'completed'
            ORDER BY tr.round_number DESC, tm.match_number
            "#,
            tournament_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let mut ranked: HashMap<Uuid, i32> = HashMap::new();
        let mut current_rank: i32 = 2;

        for m in matches {
            let loser_id = if m.winner_id == Some(m.player1_id) {
                m.player2_id
            } else {
                Some(m.player1_id)
            };
            if let Some(lid) = loser_id {
                if !ranked.contains_key(&lid) {
                    ranked.insert(lid, current_rank);
                    current_rank += 1;
                }
            }
        }

        for (user_id, rank) in ranked {
            sqlx::query!(
                "UPDATE tournament_participants SET final_rank = $1 WHERE tournament_id = $2 AND user_id = $3",
                rank,
                tournament_id,
                user_id
            )
            .execute(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;
        }

        Ok(())
    }

    async fn calculate_round_robin_rankings(
        &self,
        tournament_id: Uuid,
        participants: &[TournamentParticipant],
    ) -> Result<(), ApiError> {
        let mut stats: HashMap<Uuid, (i64, i64)> = HashMap::new(); // (wins, losses)
        for p in participants {
            stats.insert(p.user_id, (0, 0));
        }

        let matches = sqlx::query_as!(
            TournamentMatch,
            "SELECT * FROM tournament_matches WHERE tournament_id = $1 AND status = 'completed'",
            tournament_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        for m in matches {
            if let Some(winner) = m.winner_id {
                let (wins_a, losses_a) = stats.get(&winner).copied().unwrap_or((0, 0));
                stats.insert(winner, (wins_a + 1, losses_a));
                if let Some(other) = if winner == m.player1_id {
                    m.player2_id
                } else {
                    Some(m.player1_id)
                } {
                    let (wins_b, losses_b) = stats.get(&other).copied().unwrap_or((0, 0));
                    stats.insert(other, (wins_b, losses_b + 1));
                }
            }
        }

        let mut sorted: Vec<(Uuid, (i64, i64))> = stats.into_iter().collect();
        sorted.sort_by(|a, b| b.1 .0.cmp(&a.1 .0).then(a.1 .1.cmp(&b.1 .1)));

        for (rank, (user_id, _)) in sorted.iter().enumerate() {
            sqlx::query!(
                "UPDATE tournament_participants SET final_rank = $1 WHERE tournament_id = $2 AND user_id = $3",
                rank as i32 + 1,
                tournament_id,
                user_id
            )
            .execute(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;
        }

        Ok(())
    }

    async fn calculate_swiss_rankings(
        &self,
        tournament_id: Uuid,
        participants: &[TournamentParticipant],
    ) -> Result<(), ApiError> {
        let mut points: HashMap<Uuid, i32> = HashMap::new();
        for p in participants {
            points.insert(p.user_id, 0);
        }

        let matches = sqlx::query_as!(
            TournamentMatch,
            "SELECT * FROM tournament_matches WHERE tournament_id = $1 AND status = 'completed'",
            tournament_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        for m in matches {
            if let Some(winner) = m.winner_id {
                let pts = points.get(&winner).copied().unwrap_or(0) + 3;
                points.insert(winner, pts);
            } else if m.player2_id.is_some() {
                for pid in [m.player1_id, m.player2_id.unwrap()] {
                    let pts = points.get(&pid).copied().unwrap_or(0) + 1;
                    points.insert(pid, pts);
                }
            }
        }

        let mut sorted: Vec<(Uuid, i32)> = points.into_iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(&a.1));

        for (rank, (user_id, _)) in sorted.iter().enumerate() {
            sqlx::query!(
                "UPDATE tournament_participants SET final_rank = $1 WHERE tournament_id = $2 AND user_id = $3",
                rank as i32 + 1,
                tournament_id,
                user_id
            )
            .execute(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;
        }

        Ok(())
    }

    // =================================================================
    // Private helpers (validation, payments, queries)
    // =================================================================

    async fn validate_tournament_creation(
        &self,
        request: &CreateTournamentRequest,
    ) -> Result<(), ApiError> {
        if request.name.is_empty() {
            return Err(ApiError::bad_request("Tournament name is required"));
        }
        if request.max_participants < 2 {
            return Err(ApiError::bad_request(
                "Tournament must have at least 2 participants",
            ));
        }
        if request.entry_fee < 0 {
            return Err(ApiError::bad_request("Entry fee cannot be negative"));
        }
        if request.start_time <= Utc::now() {
            return Err(ApiError::bad_request("Start time must be in the future"));
        }
        if request.registration_deadline >= request.start_time {
            return Err(ApiError::bad_request(
                "Registration deadline must be before start time",
            ));
        }
        Ok(())
    }

    async fn validate_tournament_join(
        &self,
        tournament: &Tournament,
        user_id: Uuid,
    ) -> Result<(), ApiError> {
        if tournament.status != TournamentStatus::RegistrationOpen {
            return Err(ApiError::bad_request(
                "Tournament is not accepting registrations",
            ));
        }
        if Utc::now() > tournament.registration_deadline {
            return Err(ApiError::bad_request("Registration deadline has passed"));
        }
        let current_count = self.get_participant_count(tournament.id).await?;
        if current_count >= tournament.max_participants {
            return Err(ApiError::bad_request("Tournament is full"));
        }
        if let (Some(min_skill), Some(max_skill)) =
            (tournament.min_skill_level, tournament.max_skill_level)
        {
            let user_elo = self.get_user_elo(user_id, &tournament.game).await?;
            if user_elo < min_skill || user_elo > max_skill {
                return Err(ApiError::bad_request(
                    "User skill level does not meet tournament requirements",
                ));
            }
        }
        Ok(())
    }

    async fn process_entry_fee_payment(
        &self,
        user_id: Uuid,
        tournament: &Tournament,
        request: &JoinTournamentRequest,
    ) -> Result<(), ApiError> {
        match request.payment_method.as_str() {
            "fiat" => {
                self.process_fiat_payment(user_id, tournament, &request.payment_reference)
                    .await?;
            }
            "arenax_token" => {
                self.process_arenax_token_payment(user_id, tournament)
                    .await?;
            }
            _ => return Err(ApiError::bad_request("Invalid payment method")),
        }
        Ok(())
    }

    async fn process_fiat_payment(
        &self,
        user_id: Uuid,
        tournament: &Tournament,
        payment_reference: &Option<String>,
    ) -> Result<(), ApiError> {
        let reference = payment_reference
            .as_ref()
            .ok_or_else(|| ApiError::bad_request("Payment reference is required for fiat payments"))?;

        let payment_verified = self
            .verify_payment_with_provider(reference, tournament.entry_fee)
            .await?;
        if !payment_verified {
            return Err(ApiError::bad_request("Payment verification failed"));
        }

        self.add_fiat_balance(user_id, tournament.entry_fee)
            .await?;
        self.create_transaction(
            user_id,
            TransactionType::EntryFee,
            tournament.entry_fee,
            tournament.entry_fee_currency.clone(),
            format!("Entry fee for tournament: {}", tournament.name),
        )
        .await?;
        Ok(())
    }

    async fn verify_payment_with_provider(
        &self,
        reference: &str,
        amount: i64,
    ) -> Result<bool, ApiError> {
        // In production, this calls Paystack/Flutterwave.
        tracing::info!("Verifying payment: reference={}, amount={}", reference, amount);
        Ok(true)
    }

    async fn add_fiat_balance(&self, user_id: Uuid, amount: i64) -> Result<(), ApiError> {
        sqlx::query!(
            "UPDATE wallets SET balance_ngn = balance_ngn + $1 WHERE user_id = $2",
            amount,
            user_id
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;
        Ok(())
    }

    async fn process_arenax_token_payment(
        &self,
        user_id: Uuid,
        tournament: &Tournament,
    ) -> Result<(), ApiError> {
        let wallet = self.get_user_wallet(user_id).await?;
        if wallet.balance_arenax_tokens < tournament.entry_fee {
            return Err(ApiError::bad_request("Insufficient ArenaX token balance"));
        }
        self.deduct_arenax_tokens(user_id, tournament.entry_fee)
            .await?;
        self.create_transaction(
            user_id,
            TransactionType::EntryFee,
            tournament.entry_fee,
            "ARENAX_TOKEN".to_string(),
            format!("Entry fee for tournament: {}", tournament.name),
        )
        .await?;
        Ok(())
    }

    async fn create_prize_pool(
        &self,
        tournament_id: &Uuid,
        currency: &str,
    ) -> Result<(), ApiError> {
        let stellar_account = self.create_stellar_prize_pool_account().await?;
        sqlx::query!(
            r#"
            INSERT INTO prize_pools (
                id, tournament_id, total_amount, currency, stellar_account,
                distribution_percentages, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8
            )
            "#,
            Uuid::new_v4(),
            tournament_id,
            0i64,
            currency,
            stellar_account,
            r#"[50, 30, 20]"#,
            Utc::now(),
            Utc::now()
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;
        Ok(())
    }

    async fn update_prize_pool(&self, tournament_id: Uuid, entry_fee: i64) -> Result<(), ApiError> {
        sqlx::query!(
            r#"
            UPDATE prize_pools
            SET total_amount = total_amount + $1, updated_at = $2
            WHERE tournament_id = $3
            "#,
            entry_fee,
            Utc::now(),
            tournament_id
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }

    // ── Transaction-aware variants used by join_tournament ───────────────────
    //
    // Each `_in_tx` method mirrors its pool-based counterpart but accepts a
    // `&mut sqlx::Transaction<'_, sqlx::Postgres>` so all writes participate
    // in the same atomic unit. The original helpers are unchanged so any other
    // caller continues to work without modification.

    /// Record payment (wallet debit + transaction log) inside a transaction.
    async fn process_entry_fee_payment_in_tx(
        &self,
        user_id: Uuid,
        tournament: &Tournament,
        request: &JoinTournamentRequest,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ) -> Result<(), ApiError> {
        match request.payment_method.as_str() {
            "fiat" => {
                // Payment was already verified outside the transaction.
                // Only record the wallet credit and the transaction row here.
                self.add_fiat_balance_in_tx(user_id, tournament.entry_fee, tx)
                    .await?;
                self.create_transaction_in_tx(
                    user_id,
                    TransactionType::EntryFee,
                    tournament.entry_fee,
                    tournament.entry_fee_currency.clone(),
                    format!("Entry fee for tournament: {}", tournament.name),
                    tx,
                )
                .await?;
            }
            "arenax_token" => {
                // Balance was verified outside the transaction.
                // Only perform the debit and log it here.
                self.deduct_arenax_tokens_in_tx(user_id, tournament.entry_fee, tx)
                    .await?;
                self.create_transaction_in_tx(
                    user_id,
                    TransactionType::EntryFee,
                    tournament.entry_fee,
                    "ARENAX_TOKEN".to_string(),
                    format!("Entry fee for tournament: {}", tournament.name),
                    tx,
                )
                .await?;
            }
            _ => {
                return Err(ApiError::bad_request("Invalid payment method"));
            }
        }
        Ok(())
    }

    /// `UPDATE wallets SET balance_ngn = balance_ngn + $1` inside a transaction.
    async fn add_fiat_balance_in_tx(
        &self,
        user_id: Uuid,
        amount: i64,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ) -> Result<(), ApiError> {
        sqlx::query!(
            "UPDATE wallets SET balance_ngn = balance_ngn + $1 WHERE user_id = $2",
            amount,
            user_id
        )
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::database_error(e))?;
        Ok(())
    }

    /// `UPDATE wallets SET balance_arenax_tokens = balance_arenax_tokens - $1`
    /// inside a transaction.
    async fn deduct_arenax_tokens_in_tx(
        &self,
        user_id: Uuid,
        amount: i64,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ) -> Result<(), ApiError> {
        sqlx::query!(
            "UPDATE wallets SET balance_arenax_tokens = balance_arenax_tokens - $1 WHERE user_id = $2",
            amount,
            user_id
        )
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::database_error(e))?;
        Ok(())
    }

    /// `INSERT INTO transactions` inside a transaction.
    async fn create_transaction_in_tx(
        &self,
        user_id: Uuid,
        transaction_type: TransactionType,
        amount: i64,
        currency: String,
        description: String,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ) -> Result<(), ApiError> {
        sqlx::query!(
            r#"
            INSERT INTO transactions (
                id, user_id, transaction_type, amount, currency, status,
                reference, description, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
            )
            "#,
            Uuid::new_v4(),
            user_id,
            transaction_type as _,
            amount,
            currency,
            TransactionStatus::Completed as _,
            Uuid::new_v4().to_string(),
            description,
            Utc::now(),
            Utc::now()
        )
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::database_error(e))?;
        Ok(())
    }

    /// `UPDATE prize_pools SET total_amount = total_amount + $1` inside a
    /// transaction.
    async fn update_prize_pool_in_tx(
        &self,
        tournament_id: Uuid,
        entry_fee: i64,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ) -> Result<(), ApiError> {
        sqlx::query!(
            r#"
            UPDATE prize_pools
            SET total_amount = total_amount + $1, updated_at = $2
            WHERE tournament_id = $3
            "#,
            entry_fee,
            Utc::now(),
            tournament_id
        )
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::database_error(e))?;
        Ok(())
    }

    /// Close registration if the tournament is full — runs inside the
    /// `join_tournament` transaction so the status update is atomic with the
    /// participant INSERT.
    async fn update_tournament_status_if_needed_in_tx(
        &self,
        tournament_id: Uuid,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ) -> Result<(), ApiError> {
        // Read current state through the transaction so we see the participant
        // row we just inserted (READ COMMITTED isolation still sees its own
        // uncommitted writes in the same transaction).
        let row = sqlx::query!(
            "SELECT status, max_participants FROM tournaments WHERE id = $1",
            tournament_id
        )
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let count_row = sqlx::query!(
            "SELECT COUNT(*) as count FROM tournament_participants WHERE tournament_id = $1",
            tournament_id
        )
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let participant_count = count_row.count.unwrap_or(0) as i32;
        let max_participants = row.max_participants;

        // Only close if we just filled the last spot.
        if participant_count >= max_participants {
            sqlx::query!(
                r#"UPDATE tournaments SET status = $1, updated_at = $2 WHERE id = $3"#,
                TournamentStatus::RegistrationClosed as _,
                Utc::now(),
                tournament_id
            )
            .execute(&mut **tx)
            .await
            .map_err(|e| ApiError::database_error(e))?;

            tracing::info!(
                tournament_id = %tournament_id,
                participant_count = participant_count,
                "Tournament registration closed — capacity reached"
            );
        }

        Ok(())
    }

    async fn start_tournament(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        let seeding = crate::orchestrator::SeedingEngine::new(self.db_pool.clone());
        seeding.seed_and_generate_bracket(tournament_id).await?;
        Ok(())
    }

    async fn complete_tournament(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        let payout = crate::orchestrator::PayoutSettler::new(self.db_pool.clone());
        payout.finalize_tournament(tournament_id).await?;
        // Cleanup handled by background polling worker
        Ok(())
    }

    async fn create_transaction(
        &self,
        user_id: Uuid,
        transaction_type: TransactionType,
        amount: i64,
        currency: String,
        description: String,
    ) -> Result<(), ApiError> {
        sqlx::query!(
            r#"
            INSERT INTO transactions (
                id, user_id, transaction_type, amount, currency, status, reference, description, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
            )
            "#,
            Uuid::new_v4(),
            user_id,
            transaction_type as _,
            amount,
            currency,
            TransactionStatus::Completed as _,
            Uuid::new_v4().to_string(),
            description,
            Utc::now(),
            Utc::now()
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;
        Ok(())
    }

    async fn create_stellar_prize_pool_account(&self) -> Result<String, ApiError> {
        Ok(format!(
            "G{}",
            Uuid::new_v4().to_string().replace('-', "").to_uppercase()
        ))
    }

    async fn update_tournament_status_if_needed(
        &self,
        tournament_id: Uuid,
    ) -> Result<(), ApiError> {
        let tournament = self.get_tournament_by_id(tournament_id).await?;
        let participant_count = self.get_participant_count(tournament_id).await?;
        if participant_count >= tournament.max_participants
            && tournament.status == TournamentStatus::RegistrationOpen
        {
            self.update_tournament_status(tournament_id, TournamentStatus::RegistrationClosed)
                .await?;
        }
        Ok(())
    }

    async fn get_tournament_by_id(&self, tournament_id: Uuid) -> Result<Tournament, ApiError> {
        sqlx::query_as!(Tournament, "SELECT * FROM tournaments WHERE id = $1", tournament_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?
            .ok_or(ApiError::not_found("Tournament not found".to_string()))
    }

    async fn is_user_participant(
        &self,
        user_id: Uuid,
        tournament_id: Uuid,
    ) -> Result<bool, ApiError> {
        let count = sqlx::query!(
            "SELECT COUNT(*) as count FROM tournament_participants WHERE user_id = $1 AND tournament_id = $2",
            user_id,
            tournament_id
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .count
        .unwrap_or(0);
        Ok(count > 0)
    }

    async fn get_participant_status(
        &self,
        user_id: Uuid,
        tournament_id: Uuid,
    ) -> Result<ParticipantStatus, ApiError> {
        let row = sqlx::query!(
            "SELECT status FROM tournament_participants WHERE user_id = $1 AND tournament_id = $2",
            user_id,
            tournament_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .ok_or(ApiError::not_found("Participant not found"))?;
        Ok(row.status.into())
    }

    async fn can_user_join_tournament(
        &self,
        user_id: Option<Uuid>,
        tournament_id: Uuid,
    ) -> Result<bool, ApiError> {
        let user_id = match user_id {
            Some(u) => u,
            None => return Ok(false),
        };
        if self.is_user_participant(user_id, tournament_id).await? {
            return Ok(false);
        }
        let tournament = self.get_tournament_by_id(tournament_id).await?;
        if tournament.status != TournamentStatus::RegistrationOpen {
            return Ok(false);
        }
        if Utc::now() > tournament.registration_deadline {
            return Ok(false);
        }
        let current_count = self.get_participant_count(tournament_id).await?;
        Ok(current_count < tournament.max_participants)
    }

    async fn get_participant_count(&self, tournament_id: Uuid) -> Result<i32, ApiError> {
        let row = sqlx::query!(
            "SELECT COUNT(*) as count FROM tournament_participants WHERE tournament_id = $1",
            tournament_id
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;
        Ok(row.count.unwrap_or(0) as i32)
    }

    async fn get_user_elo(&self, user_id: Uuid, game: &str) -> Result<i32, ApiError> {
        let row = sqlx::query!(
            "SELECT current_rating FROM user_elo WHERE user_id = $1 AND game = $2",
            user_id,
            game
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;
        Ok(row.map(|r| r.current_rating).unwrap_or(1200))
    }

    async fn get_user_wallet(&self, user_id: Uuid) -> Result<Wallet, ApiError> {
        sqlx::query_as!(Wallet, "SELECT * FROM wallets WHERE user_id = $1", user_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?
            .ok_or(ApiError::not_found("Wallet not found"))
    }

    async fn deduct_arenax_tokens(&self, user_id: Uuid, amount: i64) -> Result<(), ApiError> {
        sqlx::query!(
            "UPDATE wallets SET balance_arenax_tokens = balance_arenax_tokens - $1 WHERE user_id = $2",
            amount,
            user_id
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;
        Ok(())
    }

    /// Create a real Stellar prize-pool account.
    ///
    /// Steps:
    /// 1. Generate a fresh ed25519 keypair and encode it as Stellar StrKeys.
    /// 2. On testnet (Friendbot available): fund via Friendbot — no admin key needed.
    ///    On mainnet: require `STELLAR_ADMIN_SECRET` to be set (funding via
    ///    CreateAccount + Payment ops is noted as a TODO for the XDR builder).
    /// 3. Return the public key (StrKey starting with `G`) for storage in the
    ///    `prize_pools.stellar_account` column.
    ///
    /// The secret key is intentionally NOT stored here because `prize_pools` has
    /// no encrypted-secret column.  If you need to sign outgoing prize payments
    /// from this account, persist the secret via `stellar_accounts` through
    /// `StellarService::create_stellar_account` and link it by public key.
    async fn create_stellar_prize_pool_account(&self) -> Result<String, ApiError> {
        // ----------------------------------------------------------------
        // 1. Generate a real Stellar keypair
        // ----------------------------------------------------------------
        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key = signing_key.verifying_key();

        let public_key = stellar_strkey_encode(6 << 3, verifying_key.as_bytes())
            .map_err(|e| ApiError::internal_server_error(e))?;

        tracing::info!(
            public_key = %public_key,
            "Generated Stellar prize-pool keypair"
        );

        // ----------------------------------------------------------------
        // 2. Fund the account
        // ----------------------------------------------------------------
        let friendbot_url = self
            .soroban_service
            .as_ref()
            .and_then(|svc| svc.network().friendbot_url.clone());

        if let Some(base_url) = friendbot_url {
            // Testnet: use Friendbot
            let url = format!("{}?addr={}", base_url, public_key);
            let client = reqwest::Client::new();
            let response = client
                .get(&url)
                .send()
                .await
                .map_err(|e| ApiError::internal_server_error(format!("Friendbot request failed: {}", e)))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(ApiError::internal_server_error(format!(
                    "Friendbot funding failed ({}): {}",
                    status, body
                )));
            }

            tracing::info!(
                public_key = %public_key,
                "Prize-pool account funded via Friendbot"
            );
        } else {
            // Mainnet: admin must fund via CreateAccount operation.
            // Building and signing a full XDR transaction envelope requires
            // the XDR builder (tracked separately). For now, verify the admin
            // secret is configured so the failure is actionable at startup.
            if self.admin_secret.is_none() {
                return Err(ApiError::internal_server_error(
                    "STELLAR_ADMIN_SECRET is required to fund prize-pool accounts on mainnet"
                        .to_string(),
                ));
            }

            tracing::warn!(
                public_key = %public_key,
                "Mainnet prize-pool account created but NOT yet funded — \
                 implement XDR CreateAccount op to fund from admin account"
            );
        }

        Ok(public_key)
    }

    async fn publish_tournament_event(
        &self,
        _event_data: serde_json::Value,
    ) -> Result<(), ApiError> {
        let tournament = self.get_tournament_by_id(tournament_id).await?;
        let participant_count = self.get_participant_count(tournament_id).await?;

        // Auto-close registration if tournament is full
        if participant_count >= tournament.max_participants
            && tournament.status == TournamentStatus::RegistrationOpen
        {
            self.update_tournament_status(tournament_id, TournamentStatus::RegistrationClosed)
                .await?;
        }

        Ok(())
    }

    async fn calculate_final_rankings(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        // Get all participants and their match results
        let participants = sqlx::query_as!(
            TournamentParticipant,
            "SELECT * FROM tournament_participants WHERE tournament_id = $1 AND status = $2",
            tournament_id,
            ParticipantStatus::Active as _
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Calculate rankings based on tournament type
        let tournament = self.get_tournament_by_id(tournament_id).await?;

        match tournament.bracket_type {
            BracketType::SingleElimination | BracketType::DoubleElimination => {
                // For elimination tournaments, rank by elimination order
                self.calculate_elimination_rankings(tournament_id, participants)
                    .await?;
            }
            BracketType::RoundRobin => {
                // For round robin, rank by win/loss record
                self.calculate_round_robin_rankings(tournament_id, participants)
                    .await?;
            }
            BracketType::Swiss => {
                // For Swiss, rank by points and tiebreakers
                self.calculate_swiss_rankings(tournament_id, participants)
                    .await?;
            }
        }

        Ok(())
    }

    /// Trigger prize distribution for a completed tournament.
    ///
    /// Exposed as `pub` so the HTTP handler can call it directly.
    /// The internal logic writes prize amounts to the DB first and then
    /// attempts on-chain transfer via the Soroban prize contract.
    pub async fn trigger_prize_distribution(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        // Validate tournament exists and is in a distributable state
        let tournament = self.get_tournament_by_id(tournament_id).await?;
        if tournament.status != TournamentStatus::Completed {
            return Err(ApiError::bad_request(
                "Tournament must be completed before distributing prizes",
            ));
        }
        self.distribute_prizes(tournament_id).await
    }

    /// Cancel a tournament and refund all participants.
    ///
    /// Sets status to `Cancelled`, then issues a wallet refund for every
    /// participant who paid an entry fee.
    pub async fn cancel_tournament(&self, tournament_id: Uuid) -> Result<Tournament, ApiError> {
        let tournament = self.get_tournament_by_id(tournament_id).await?;

        // Only non-terminal statuses can be cancelled
        if matches!(
            tournament.status,
            TournamentStatus::Completed | TournamentStatus::Cancelled
        ) {
            return Err(ApiError::bad_request(
                "Cannot cancel a tournament that is already completed or cancelled",
            ));
        }

        // Issue refunds for every participant who paid
        let participants = sqlx::query_as!(
            TournamentParticipant,
            "SELECT * FROM tournament_participants WHERE tournament_id = $1 AND entry_fee_paid = true",
            tournament_id,
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        for participant in &participants {
            // Refund in the tournament's currency
            match tournament.entry_fee_currency.as_str() {
                "ARENAX_TOKEN" => {
                    sqlx::query!(
                        "UPDATE wallets SET balance_arenax_tokens = balance_arenax_tokens + $1 WHERE user_id = $2",
                        tournament.entry_fee,
                        participant.user_id,
                    )
                    .execute(&self.db_pool)
                    .await
                    .map_err(|e| ApiError::database_error(e))?;
                }
                _ => {
                    // NGN and other fiat
                    sqlx::query!(
                        "UPDATE wallets SET balance_ngn = balance_ngn + $1 WHERE user_id = $2",
                        tournament.entry_fee,
                        participant.user_id,
                    )
                    .execute(&self.db_pool)
                    .await
                    .map_err(|e| ApiError::database_error(e))?;
                }
            }

            self.create_transaction(
                participant.user_id,
                TransactionType::Refund,
                tournament.entry_fee,
                tournament.entry_fee_currency.clone(),
                format!("Refund for cancelled tournament: {}", tournament.name),
            )
            .await?;
        }

        // Update tournament status
        let updated = sqlx::query_as!(
            Tournament,
            r#"UPDATE tournaments SET status = $1, updated_at = $2 WHERE id = $3 RETURNING *"#,
            TournamentStatus::Cancelled as _,
            Utc::now(),
            tournament_id,
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        tracing::info!(
            tournament_id = %tournament_id,
            refunds_issued = participants.len(),
            "Tournament cancelled and refunds issued"
        );

        Ok(updated)
    }

    /// Advance the tournament bracket to the next round.
    ///
    /// Transitions the tournament to `InProgress` (generating the initial
    /// bracket if not already done) and marks the current pending round as
    /// `InProgress`.
    pub async fn advance_bracket(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        let tournament = self.get_tournament_by_id(tournament_id).await?;

        match tournament.status {
            TournamentStatus::RegistrationClosed | TournamentStatus::Upcoming => {
                // First advancement: set to InProgress and generate bracket
                sqlx::query!(
                    r#"UPDATE tournaments SET status = $1, updated_at = $2 WHERE id = $3"#,
                    TournamentStatus::InProgress as _,
                    Utc::now(),
                    tournament_id,
                )
                .execute(&self.db_pool)
                .await
                .map_err(|e| ApiError::database_error(e))?;

                self.start_tournament(tournament_id).await?;
            }
            TournamentStatus::InProgress => {
                // Subsequent advancements: complete the current round and
                // start the next pending one
                sqlx::query!(
                    r#"
                    UPDATE tournament_rounds
                    SET status = $1, completed_at = $2
                    WHERE tournament_id = $3 AND status = $4
                    "#,
                    RoundStatus::Completed as _,
                    Utc::now(),
                    tournament_id,
                    RoundStatus::InProgress as _,
                )
                .execute(&self.db_pool)
                .await
                .map_err(|e| ApiError::database_error(e))?;

                let advanced = sqlx::query!(
                    r#"
                    UPDATE tournament_rounds
                    SET status = $1, started_at = $2
                    WHERE id = (
                        SELECT id FROM tournament_rounds
                        WHERE tournament_id = $3 AND status = $4
                        ORDER BY round_number ASC
                        LIMIT 1
                    )
                    RETURNING id
                    "#,
                    RoundStatus::InProgress as _,
                    Utc::now(),
                    tournament_id,
                    RoundStatus::Pending as _,
                )
                .fetch_optional(&self.db_pool)
                .await
                .map_err(|e| ApiError::database_error(e))?;

                if advanced.is_none() {
                    // No pending rounds left — complete the tournament
                    self.update_tournament_status(
                        tournament_id,
                        TournamentStatus::Completed,
                    )
                    .await?;
                    tracing::info!(tournament_id = %tournament_id, "Tournament completed after final round");
                }
            }
            _ => {
                return Err(ApiError::bad_request(
                    "Tournament must be in RegistrationClosed, Upcoming, or InProgress state to advance the bracket",
                ));
            }
        }

        Ok(())
    }

    async fn distribute_prizes(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        // Get prize pool information
        let prize_pool = sqlx::query!(
            "SELECT * FROM prize_pools WHERE tournament_id = $1",
            tournament_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .ok_or(ApiError::not_found("Prize pool not found"))?;

        // Get final rankings
        let participants = sqlx::query_as!(
            TournamentParticipant,
            "SELECT * FROM tournament_participants WHERE tournament_id = $1 AND final_rank IS NOT NULL ORDER BY final_rank",
            tournament_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Parse distribution percentages
        let percentages: Vec<f64> = serde_json::from_str(&prize_pool.distribution_percentages)
            .map_err(|e| {
                ApiError::internal_error(format!("Invalid distribution percentages: {}", e))
            })?;

        // Resolve Soroban dependencies once — if not configured we fall back to
        // recording-only mode so existing tests and deployments without a contract
        // address still work.
        let soroban = self.soroban_service.as_ref();
        let contract_id = self.prize_contract_id.as_deref();
        let admin_secret = self.admin_secret.as_deref();

        // Distribute prizes
        for (index, participant) in participants.iter().enumerate() {
            if index < percentages.len() && participant.final_rank.unwrap_or(0) <= 3 {
                let percentage = percentages[index];
                let prize_amount = (prize_pool.total_amount as f64 * percentage / 100.0) as i64;

                // Idempotency guard: skip if this participant already has a prize
                // recorded (handles retries after partial failures).
                if participant.prize_amount.is_some() {
                    tracing::info!(
                        tournament_id = %tournament_id,
                        user_id = %participant.user_id,
                        "Prize already recorded for participant, skipping"
                    );
                    continue;
                }

                // Record the prize amount in the database first so it is never
                // lost even if the on-chain call fails.
                sqlx::query!(
                    "UPDATE tournament_participants \
                     SET prize_amount = $1, prize_currency = $2 \
                     WHERE id = $3",
                    prize_amount,
                    prize_pool.currency,
                    participant.id
                )
                .execute(&self.db_pool)
                .await
                .map_err(|e| ApiError::database_error(e))?;

                // Attempt the on-chain transfer via the Soroban prize contract.
                match (soroban, contract_id, admin_secret) {
                    (Some(svc), Some(cid), Some(secret)) => {
                        let args = serde_json::json!({
                            "tournament_id": tournament_id.to_string(),
                            "recipient":     participant.user_id.to_string(),
                            "amount":        prize_amount,
                            "currency":      prize_pool.currency,
                        });

                        match svc.invoke(cid, "distribute", &args, secret).await {
                            Ok(result) if result.status == TxStatus::Success => {
                                tracing::info!(
                                    tournament_id = %tournament_id,
                                    user_id       = %participant.user_id,
                                    tx_hash       = %result.hash,
                                    prize_amount  = prize_amount,
                                    currency      = %prize_pool.currency,
                                    "Prize transfer confirmed on-chain"
                                );

                                // Persist the transaction hash alongside the prize record
                                // so it is auditable and visible in the admin dashboard.
                                if let Err(db_err) = sqlx::query!(
                                    "UPDATE tournament_participants \
                                     SET prize_tx_hash = $1 \
                                     WHERE id = $2",
                                    result.hash,
                                    participant.id
                                )
                                .execute(&self.db_pool)
                                .await
                                {
                                    // Non-fatal: the transfer succeeded on-chain; only the
                                    // hash column update failed.  Log and continue.
                                    tracing::warn!(
                                        user_id  = %participant.user_id,
                                        tx_hash  = %result.hash,
                                        error    = %db_err,
                                        "Prize confirmed on-chain but failed to persist tx_hash"
                                    );
                                }
                            }
                            Ok(result) => {
                                // Transaction was submitted but ended in a non-success
                                // status (Failed or still Pending after retries).
                                let error_detail = result
                                    .error
                                    .as_deref()
                                    .unwrap_or("unknown error")
                                    .to_string();

                                tracing::error!(
                                    tournament_id = %tournament_id,
                                    user_id       = %participant.user_id,
                                    tx_hash       = %result.hash,
                                    status        = ?result.status,
                                    error         = %error_detail,
                                    "Prize transfer did not succeed — recorded for admin review"
                                );

                                self.record_prize_failure(
                                    tournament_id,
                                    participant.user_id,
                                    prize_amount,
                                    &prize_pool.currency,
                                    &format!(
                                        "tx {} ended with status {:?}: {}",
                                        result.hash, result.status, error_detail
                                    ),
                                )
                                .await;
                            }
                            Err(e) => {
                                // The Soroban service exhausted its retries or hit a
                                // hard error.  Surface to the admin dashboard and
                                // continue distributing to other winners.
                                tracing::error!(
                                    tournament_id = %tournament_id,
                                    user_id       = %participant.user_id,
                                    error         = %e,
                                    "Soroban prize contract call failed — recorded for admin review"
                                );

                                self.record_prize_failure(
                                    tournament_id,
                                    participant.user_id,
                                    prize_amount,
                                    &prize_pool.currency,
                                    &e.to_string(),
                                )
                                .await;
                            }
                        }
                    }
                    _ => {
                        // Soroban not configured — recording-only mode.
                        tracing::warn!(
                            tournament_id = %tournament_id,
                            user_id       = %participant.user_id,
                            prize_amount  = prize_amount,
                            currency      = %prize_pool.currency,
                            "Soroban prize contract not configured; prize recorded in DB only"
                        );
                    }
                }
            }
        }

        Ok(())
    }

    /// Persist a prize distribution failure so it appears in the admin dashboard.
    ///
    /// Failures are written to `prize_distribution_failures`.  The insert is
    /// best-effort: if the table does not yet exist the error is logged but does
    /// not propagate, keeping the main distribution loop alive.
    async fn record_prize_failure(
        &self,
        tournament_id: Uuid,
        user_id: Uuid,
        amount: i64,
        currency: &str,
        reason: &str,
    ) {
        let result = sqlx::query!(
            r#"
            INSERT INTO prize_distribution_failures
                (id, tournament_id, user_id, amount, currency, reason, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (tournament_id, user_id) DO UPDATE
                SET reason     = EXCLUDED.reason,
                    retry_count = prize_distribution_failures.retry_count + 1,
                    updated_at  = EXCLUDED.created_at
            "#,
            Uuid::new_v4(),
            tournament_id,
            user_id,
            amount,
            currency,
            reason,
            Utc::now(),
        )
        .execute(&self.db_pool)
        .await;

        if let Err(e) = result {
            tracing::error!(
                tournament_id = %tournament_id,
                user_id       = %user_id,
                db_error      = %e,
                "Failed to record prize distribution failure in DB"
            );
        }
    }

    // Additional bracket generation methods
    async fn generate_double_elimination_bracket(
        &self,
        _event_data: serde_json::Value,
    ) -> Result<(), ApiError> {
        Ok(())
    }
}

// =====================================================================
// Response payload structs (single source of truth, kept at module scope
// so they don't accidentally collide with inline definitions).
// =====================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct TournamentBracketResponse {
    pub tournament_id: Uuid,
    pub rounds: Vec<BracketRound>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BracketRound {
    pub round_id: Uuid,
    pub round_number: i32,
    pub round_type: RoundType,
    pub status: RoundStatus,
    pub matches: Vec<BracketMatch>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BracketMatch {
    pub match_id: Uuid,
    pub match_number: i32,
    pub player1_id: Uuid,
    pub player2_id: Option<Uuid>,
    pub winner_id: Option<Uuid>,
    pub player1_score: Option<i32>,
    pub player2_score: Option<i32>,
    pub status: MatchStatus,
}
