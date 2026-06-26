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
use crate::service::bracket_generator::BracketGenerator;
use chrono::{DateTime, Utc};
use redis::Client as RedisClient;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

pub struct TournamentService {
    db_pool: DbPool,
    redis_client: Option<Arc<RedisClient>>,
}

impl TournamentService {
    pub fn new(db_pool: DbPool) -> Self {
        Self {
            db_pool,
            redis_client: None,
        }
    }

    pub fn with_redis(mut self, redis_client: Arc<RedisClient>) -> Self {
        self.redis_client = Some(redis_client);
        self
    }

    // =================================================================
    // Public CRUD entry points
    // =================================================================

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
        let tournament = self.get_tournament_by_id(tournament_id).await?;
        self.validate_tournament_join(&tournament, user_id).await?;

        if self.is_user_participant(user_id, tournament_id).await? {
            return Err(ApiError::bad_request("User is already a participant"));
        }

        self.process_entry_fee_payment(user_id, &tournament, &request)
            .await?;

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
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        self.update_prize_pool(tournament_id, tournament.entry_fee)
            .await?;

        self.update_tournament_status_if_needed(tournament_id)
            .await?;

        let username = self
            .get_user_username(user_id)
            .await
            .unwrap_or_else(|| "Unknown".to_string());

        self.publish_tournament_event(serde_json::json!({
            "type": "participant_joined",
            "tournament_id": tournament_id,
            "user_id": user_id,
            "username": username,
            "participant_count": self.get_participant_count(tournament_id).await?,
        }))
        .await?;

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

    async fn get_user_username(&self, user_id: Uuid) -> Result<String, ApiError> {
        let row = sqlx::query!("SELECT username FROM users WHERE id = $1", user_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?
            .ok_or(ApiError::not_found("User not found"))?;
        Ok(row.username)
    }

    async fn publish_tournament_event(
        &self,
        _event_data: serde_json::Value,
    ) -> Result<(), ApiError> {
        // Will be wired into the realtime module when it's stable.
        Ok(())
    }

    async fn publish_global_event(
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
