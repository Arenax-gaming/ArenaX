use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::tournament::*;
use crate::models::wallet::Wallet;
use chrono::Utc;
use redis::Client as RedisClient;
use serde::{Deserialize, Serialize};
use sqlx::Row;
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

    /// Create a new tournament
    pub async fn create_tournament(
        &self,
        creator_id: Uuid,
        request: CreateTournamentRequest,
    ) -> Result<Tournament, ApiError> {
        self.validate_tournament_creation(&request).await?;

        let tournament = sqlx::query_as::<_, Tournament>(
            r#"
            INSERT INTO tournaments (
                id, name, description, game, max_participants, entry_fee, entry_fee_currency,
                prize_pool, prize_pool_currency, status, start_time, registration_deadline,
                created_by, created_at, updated_at, bracket_type, rules, min_skill_level, max_skill_level
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
            ) RETURNING *
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(&request.name)
        .bind(&request.description)
        .bind(&request.game)
        .bind(request.max_participants)
        .bind(request.entry_fee)
        .bind(&request.entry_fee_currency)
        .bind(0i64) // Initial prize pool
        .bind(&request.entry_fee_currency)
        .bind(TournamentStatus::Draft)
        .bind(request.start_time)
        .bind(request.registration_deadline)
        .bind(creator_id)
        .bind(Utc::now())
        .bind(Utc::now())
        .bind(&request.bracket_type)
        .bind(&request.rules)
        .bind(request.min_skill_level)
        .bind(request.max_skill_level)
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

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

    /// Get tournaments with pagination and filtering
    pub async fn get_tournaments(
        &self,
        user_id: Option<Uuid>,
        page: i32,
        per_page: i32,
        status_filter: Option<TournamentStatus>,
        game_filter: Option<String>,
    ) -> Result<TournamentListResponse, ApiError> {
        let offset = (page - 1) * per_page;

        let rows = sqlx::query(
            r#"
            SELECT t.*, COUNT(tp.id) as current_participants
            FROM tournaments t
            LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id
            WHERE ($1::text IS NULL OR t.status::text = $1)
            AND ($2::text IS NULL OR t.game = $2)
            GROUP BY t.id
            ORDER BY t.created_at DESC
            LIMIT $3 OFFSET $4
            "#,
        )
        .bind(status_filter.map(|s| s.to_string()))
        .bind(&game_filter)
        .bind(per_page)
        .bind(offset)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) as count
            FROM tournaments t
            WHERE ($1::text IS NULL OR t.status::text = $1)
            AND ($2::text IS NULL OR t.game = $2)
            "#,
        )
        .bind(status_filter.map(|s| s.to_string()))
        .bind(&game_filter)
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let total: i64 = total_row.get("count");

        let mut tournament_responses = Vec::new();
        for row in rows {
            let t_id: Uuid = row.get("id");
            let current_participants: Option<i64> = row.get("current_participants");

            let is_participant = if let Some(uid) = user_id {
                self.is_user_participant(uid, t_id).await.unwrap_or(false)
            } else {
                false
            };

            let participant_status = if is_participant {
                self.get_participant_status(user_id.unwrap(), t_id)
                    .await
                    .ok()
            } else {
                None
            };

            let can_join = self
                .can_user_join_tournament(user_id, t_id)
                .await
                .unwrap_or(false);

            tournament_responses.push(TournamentResponse {
                id: t_id,
                name: row.get("name"),
                description: row.get("description"),
                game: row.get("game"),
                max_participants: row.get("max_participants"),
                current_participants: current_participants.unwrap_or(0) as i32,
                entry_fee: row.get("entry_fee"),
                entry_fee_currency: row.get("entry_fee_currency"),
                prize_pool: row.get("prize_pool"),
                prize_pool_currency: row.get("prize_pool_currency"),
                status: row.get("status"),
                start_time: row.get("start_time"),
                end_time: row.get("end_time"),
                registration_deadline: row.get("registration_deadline"),
                bracket_type: row.get("bracket_type"),
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

    /// Get a specific tournament by ID
    pub async fn get_tournament(
        &self,
        tournament_id: Uuid,
        user_id: Option<Uuid>,
    ) -> Result<TournamentResponse, ApiError> {
        let row = sqlx::query(
            r#"
            SELECT t.*, COUNT(tp.id) as current_participants
            FROM tournaments t
            LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id
            WHERE t.id = $1
            GROUP BY t.id
            "#,
        )
        .bind(tournament_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?
        .ok_or(ApiError::not_found("Tournament not found"))?;

        let current_participants: Option<i64> = row.get("current_participants");

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
            id: row.get("id"),
            name: row.get("name"),
            description: row.get("description"),
            game: row.get("game"),
            max_participants: row.get("max_participants"),
            current_participants: current_participants.unwrap_or(0) as i32,
            entry_fee: row.get("entry_fee"),
            entry_fee_currency: row.get("entry_fee_currency"),
            prize_pool: row.get("prize_pool"),
            prize_pool_currency: row.get("prize_pool_currency"),
            status: row.get("status"),
            start_time: row.get("start_time"),
            end_time: row.get("end_time"),
            registration_deadline: row.get("registration_deadline"),
            bracket_type: row.get("bracket_type"),
            can_join,
            is_participant,
            participant_status,
        })
    }

    /// Join a tournament
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

        let participant = sqlx::query_as::<_, TournamentParticipant>(
            r#"
            INSERT INTO tournament_participants (
                id, tournament_id, user_id, registered_at, entry_fee_paid, status
            ) VALUES (
                $1, $2, $3, $4, $5, $6
            ) RETURNING *
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(tournament_id)
        .bind(user_id)
        .bind(Utc::now())
        .bind(true)
        .bind(ParticipantStatus::Paid)
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        self.update_prize_pool(tournament_id, tournament.entry_fee)
            .await?;

        self.update_tournament_status_if_needed(tournament_id)
            .await?;

        let username = self
            .get_user_username(user_id)
            .await
            .unwrap_or_else(|_| "Unknown".to_string());

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

    /// Update tournament status
    pub async fn update_tournament_status(
        &self,
        tournament_id: Uuid,
        new_status: TournamentStatus,
    ) -> Result<Tournament, ApiError> {
        let tournament = sqlx::query_as::<_, Tournament>(
            r#"
            UPDATE tournaments
            SET status = $1, updated_at = $2
            WHERE id = $3
            RETURNING *
            "#,
        )
        .bind(new_status)
        .bind(Utc::now())
        .bind(tournament_id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        match new_status {
            TournamentStatus::InProgress => {
                self.start_tournament(tournament_id).await?;
            }
            TournamentStatus::Completed => {
                self.complete_tournament(tournament_id).await?;
            }
            _ => {}
        }

        self.publish_tournament_event(serde_json::json!({
            "type": "status_changed",
            "tournament_id": tournament_id,
            "new_status": format!("{}", new_status),
        }))
        .await?;

        Ok(tournament)
    }

    // Private helper methods

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
            _ => {
                return Err(ApiError::bad_request("Invalid payment method"));
            }
        }
        Ok(())
    }

    async fn process_fiat_payment(
        &self,
        user_id: Uuid,
        tournament: &Tournament,
        payment_reference: &Option<String>,
    ) -> Result<(), ApiError> {
        if payment_reference.is_none() {
            return Err(ApiError::bad_request(
                "Payment reference is required for fiat payments",
            ));
        }
        let reference = payment_reference.as_ref().unwrap();

        let payment_verified = self
            .verify_payment_with_provider(reference, tournament.entry_fee)
            .await?;

        if !payment_verified {
            return Err(ApiError::bad_request("Payment verification failed"));
        }

        self.add_fiat_balance(user_id, tournament.entry_fee).await?;

        self.create_transaction(
            user_id,
            "entry_fee",
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
        tracing::info!(
            "Verifying payment: reference={}, amount={}",
            reference,
            amount
        );
        Ok(true)
    }

    async fn add_fiat_balance(&self, user_id: Uuid, amount: i64) -> Result<(), ApiError> {
        sqlx::query("UPDATE wallets SET balance_ngn = balance_ngn + $1 WHERE user_id = $2")
            .bind(amount)
            .bind(user_id)
            .execute(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;
        Ok(())
    }

    async fn process_arenax_token_payment(
        &self,
        user_id: Uuid,
        tournament: &Tournament,
    ) -> Result<(), ApiError> {
        let wallet = self.get_user_wallet(user_id).await?;

        if wallet.balance_arenax_tokens.unwrap_or(0) < tournament.entry_fee {
            return Err(ApiError::bad_request("Insufficient ArenaX token balance"));
        }

        self.deduct_arenax_tokens(user_id, tournament.entry_fee)
            .await?;

        self.create_transaction(
            user_id,
            "entry_fee",
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

        sqlx::query(
            r#"
            INSERT INTO prize_pools (
                id, tournament_id, total_amount, currency, stellar_account,
                distribution_percentages, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8
            )
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(tournament_id)
        .bind(0i64)
        .bind(currency)
        .bind(&stellar_account)
        .bind(r#"[50, 30, 20]"#)
        .bind(Utc::now())
        .bind(Utc::now())
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        Ok(())
    }

    async fn update_prize_pool(&self, tournament_id: Uuid, entry_fee: i64) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            UPDATE prize_pools
            SET total_amount = total_amount + $1, updated_at = $2
            WHERE tournament_id = $3
            "#,
        )
        .bind(entry_fee)
        .bind(Utc::now())
        .bind(tournament_id)
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        Ok(())
    }

    async fn start_tournament(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        self.generate_tournament_bracket(tournament_id).await?;

        sqlx::query(
            r#"
            UPDATE tournament_participants
            SET status = $1
            WHERE tournament_id = $2 AND status = $3
            "#,
        )
        .bind(ParticipantStatus::Active)
        .bind(tournament_id)
        .bind(ParticipantStatus::Paid)
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        Ok(())
    }

    async fn complete_tournament(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        self.calculate_final_rankings(tournament_id).await?;
        self.distribute_prizes(tournament_id).await?;
        Ok(())
    }

    async fn generate_tournament_bracket(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        let participants = sqlx::query_as::<_, TournamentParticipant>(
            r#"
            SELECT * FROM tournament_participants
            WHERE tournament_id = $1 AND status = $2
            ORDER BY registered_at
            "#,
        )
        .bind(tournament_id)
        .bind(ParticipantStatus::Active)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let tournament = self.get_tournament_by_id(tournament_id).await?;

        match tournament.bracket_type {
            BracketType::SingleElimination => {
                self.generate_single_elimination_bracket(tournament_id, participants)
                    .await?;
            }
            BracketType::DoubleElimination => {
                self.generate_double_elimination_bracket(tournament_id, participants)
                    .await?;
            }
            BracketType::RoundRobin => {
                self.generate_round_robin_bracket(tournament_id, participants)
                    .await?;
            }
            BracketType::Swiss => {
                self.generate_swiss_bracket(tournament_id, participants)
                    .await?;
            }
        }

        Ok(())
    }

    async fn generate_single_elimination_bracket(
        &self,
        tournament_id: Uuid,
        participants: Vec<TournamentParticipant>,
    ) -> Result<(), ApiError> {
        let participant_count = participants.len();
        if participant_count < 2 {
            return Err(ApiError::bad_request("Not enough participants for bracket"));
        }

        let rounds = (participant_count as f64).log2().ceil() as i32;

        for round_num in 1..=rounds {
            let round_type = if round_num == rounds {
                RoundType::Final
            } else {
                RoundType::Elimination
            };

            let round = sqlx::query_as::<_, TournamentRound>(
                r#"
                INSERT INTO tournament_rounds (
                    id, tournament_id, round_number, round_type, status, created_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6
                ) RETURNING *
                "#,
            )
            .bind(Uuid::new_v4())
            .bind(tournament_id)
            .bind(round_num)
            .bind(round_type.to_string())
            .bind(RoundStatus::Pending.to_string())
            .bind(Utc::now())
            .fetch_one(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;

            let matches_in_round = if round_num == 1 {
                participant_count / 2
            } else {
                participant_count / (2_usize.pow(round_num as u32))
            };

            for match_num in 1..=matches_in_round {
                let player1_idx = (match_num - 1) * 2;
                let player2_idx = player1_idx + 1;

                sqlx::query(
                    r#"
                    INSERT INTO tournament_matches (
                        id, tournament_id, round_id, match_number, player1_id, player2_id,
                        status, created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9
                    )
                    "#,
                )
                .bind(Uuid::new_v4())
                .bind(tournament_id)
                .bind(round.id)
                .bind(match_num as i32)
                .bind(participants[player1_idx].user_id)
                .bind(if player2_idx < participants.len() {
                    Some(participants[player2_idx].user_id)
                } else {
                    None
                })
                .bind(MatchStatus::Pending.to_string())
                .bind(Utc::now())
                .bind(Utc::now())
                .execute(&self.db_pool)
                .await
                .map_err(ApiError::database_error)?;
            }
        }

        Ok(())
    }

    async fn get_tournament_by_id(&self, tournament_id: Uuid) -> Result<Tournament, ApiError> {
        sqlx::query_as::<_, Tournament>("SELECT * FROM tournaments WHERE id = $1")
            .bind(tournament_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?
            .ok_or(ApiError::not_found("Tournament not found".to_string()))
    }

    async fn is_user_participant(
        &self,
        user_id: Uuid,
        tournament_id: Uuid,
    ) -> Result<bool, ApiError> {
        let row = sqlx::query(
            "SELECT COUNT(*) as count FROM tournament_participants WHERE user_id = $1 AND tournament_id = $2",
        )
        .bind(user_id)
        .bind(tournament_id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let count: i64 = row.get("count");
        Ok(count > 0)
    }

    async fn get_participant_status(
        &self,
        user_id: Uuid,
        tournament_id: Uuid,
    ) -> Result<ParticipantStatus, ApiError> {
        let row = sqlx::query(
            "SELECT status FROM tournament_participants WHERE user_id = $1 AND tournament_id = $2",
        )
        .bind(user_id)
        .bind(tournament_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?
        .ok_or(ApiError::not_found("Participant not found"))?;

        let status: ParticipantStatus = row.get("status");
        Ok(status)
    }

    async fn can_user_join_tournament(
        &self,
        user_id: Option<Uuid>,
        tournament_id: Uuid,
    ) -> Result<bool, ApiError> {
        if user_id.is_none() {
            return Ok(false);
        }
        let tournament = self.get_tournament_by_id(tournament_id).await?;
        let user_id = user_id.unwrap();

        if self.is_user_participant(user_id, tournament_id).await? {
            return Ok(false);
        }
        if tournament.status != TournamentStatus::RegistrationOpen {
            return Ok(false);
        }
        if Utc::now() > tournament.registration_deadline {
            return Ok(false);
        }
        let current_count = self.get_participant_count(tournament_id).await?;
        if current_count >= tournament.max_participants {
            return Ok(false);
        }
        Ok(true)
    }

    async fn get_participant_count(&self, tournament_id: Uuid) -> Result<i32, ApiError> {
        let row = sqlx::query(
            "SELECT COUNT(*) as count FROM tournament_participants WHERE tournament_id = $1",
        )
        .bind(tournament_id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let count: i64 = row.get("count");
        Ok(count as i32)
    }

    async fn get_user_elo(&self, user_id: Uuid, game: &str) -> Result<i32, ApiError> {
        let row =
            sqlx::query("SELECT current_rating FROM user_elo WHERE user_id = $1 AND game = $2")
                .bind(user_id)
                .bind(game)
                .fetch_optional(&self.db_pool)
                .await
                .map_err(ApiError::database_error)?;

        Ok(row
            .map(|r| r.get::<i32, _>("current_rating"))
            .unwrap_or(1200))
    }

    async fn get_user_wallet(&self, user_id: Uuid) -> Result<Wallet, ApiError> {
        sqlx::query_as::<_, Wallet>("SELECT * FROM wallets WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?
            .ok_or(ApiError::not_found("Wallet not found"))
    }

    async fn deduct_arenax_tokens(&self, user_id: Uuid, amount: i64) -> Result<(), ApiError> {
        sqlx::query(
            "UPDATE wallets SET balance_arenax_tokens = balance_arenax_tokens - $1 WHERE user_id = $2",
        )
        .bind(amount)
        .bind(user_id)
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;
        Ok(())
    }

    async fn create_transaction(
        &self,
        user_id: Uuid,
        transaction_type: &str,
        amount: i64,
        currency: String,
        description: String,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            INSERT INTO transactions (
                id, user_id, transaction_type, amount, currency, status, reference, description, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
            )
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(user_id)
        .bind(transaction_type)
        .bind(amount)
        .bind(&currency)
        .bind("completed")
        .bind(Uuid::new_v4().to_string())
        .bind(&description)
        .bind(Utc::now())
        .bind(Utc::now())
        .execute(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;
        Ok(())
    }

    async fn create_stellar_prize_pool_account(&self) -> Result<String, ApiError> {
        let account_id = format!(
            "G{}",
            uuid::Uuid::new_v4()
                .to_string()
                .replace('-', "")
                .to_uppercase()
        );
        Ok(account_id)
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

    async fn calculate_final_rankings(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        let participants = sqlx::query_as::<_, TournamentParticipant>(
            "SELECT * FROM tournament_participants WHERE tournament_id = $1 AND status = $2",
        )
        .bind(tournament_id)
        .bind(ParticipantStatus::Active)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let tournament = self.get_tournament_by_id(tournament_id).await?;

        match tournament.bracket_type {
            BracketType::SingleElimination | BracketType::DoubleElimination => {
                self.calculate_elimination_rankings(tournament_id, participants)
                    .await?;
            }
            BracketType::RoundRobin => {
                self.calculate_round_robin_rankings(tournament_id, participants)
                    .await?;
            }
            BracketType::Swiss => {
                self.calculate_swiss_rankings(tournament_id, participants)
                    .await?;
            }
        }

        Ok(())
    }

    async fn distribute_prizes(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        let prize_pool_row = sqlx::query("SELECT * FROM prize_pools WHERE tournament_id = $1")
            .bind(tournament_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?
            .ok_or(ApiError::not_found("Prize pool not found"))?;

        let total_amount: i64 = prize_pool_row.get("total_amount");
        let currency: String = prize_pool_row.get("currency");
        let dist_pct: String = prize_pool_row.get("distribution_percentages");

        let participants = sqlx::query_as::<_, TournamentParticipant>(
            "SELECT * FROM tournament_participants WHERE tournament_id = $1 AND final_rank IS NOT NULL ORDER BY final_rank",
        )
        .bind(tournament_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let percentages: Vec<f64> = serde_json::from_str(&dist_pct).map_err(|e| {
            ApiError::internal_error(format!("Invalid distribution percentages: {}", e))
        })?;

        for (index, participant) in participants.iter().enumerate() {
            if index < percentages.len() && participant.final_rank.unwrap_or(0) <= 3 {
                let percentage = percentages[index];
                let prize_amount = (total_amount as f64 * percentage / 100.0) as i64;

                sqlx::query(
                    "UPDATE tournament_participants SET prize_amount = $1, prize_currency = $2 WHERE id = $3",
                )
                .bind(prize_amount)
                .bind(&currency)
                .bind(participant.id)
                .execute(&self.db_pool)
                .await
                .map_err(ApiError::database_error)?;

                tracing::info!(
                    "Prize distributed: {} {} to user {}",
                    prize_amount,
                    currency,
                    participant.user_id
                );
            }
        }

        Ok(())
    }

    async fn generate_double_elimination_bracket(
        &self,
        tournament_id: Uuid,
        participants: Vec<TournamentParticipant>,
    ) -> Result<(), ApiError> {
        let participant_count = participants.len();
        if participant_count < 2 {
            return Err(ApiError::bad_request("Not enough participants for bracket"));
        }

        let rounds = (participant_count as f64).log2().ceil() as i32;

        for round_num in 1..=rounds {
            let round = sqlx::query_as::<_, TournamentRound>(
                r#"
                INSERT INTO tournament_rounds (
                    id, tournament_id, round_number, round_type, status, created_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6
                ) RETURNING *
                "#,
            )
            .bind(Uuid::new_v4())
            .bind(tournament_id)
            .bind(round_num)
            .bind(RoundType::Elimination.to_string())
            .bind(RoundStatus::Pending.to_string())
            .bind(Utc::now())
            .fetch_one(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;

            let matches_in_round = participant_count / 2_i32.pow(round_num as u32) as usize;
            for match_num in 1..=matches_in_round {
                let player1_idx = (match_num - 1) * 2;
                let player2_idx = player1_idx + 1;

                sqlx::query(
                    r#"
                    INSERT INTO tournament_matches (
                        id, tournament_id, round_id, match_number, player1_id, player2_id,
                        status, created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9
                    )
                    "#,
                )
                .bind(Uuid::new_v4())
                .bind(tournament_id)
                .bind(round.id)
                .bind(match_num as i32)
                .bind(participants[player1_idx].user_id)
                .bind(if player2_idx < participants.len() {
                    Some(participants[player2_idx].user_id)
                } else {
                    None
                })
                .bind(MatchStatus::Pending.to_string())
                .bind(Utc::now())
                .bind(Utc::now())
                .execute(&self.db_pool)
                .await
                .map_err(ApiError::database_error)?;
            }
        }

        tracing::info!(
            "Double elimination bracket generated for tournament: {}",
            tournament_id
        );
        Ok(())
    }

    async fn generate_round_robin_bracket(
        &self,
        tournament_id: Uuid,
        participants: Vec<TournamentParticipant>,
    ) -> Result<(), ApiError> {
        let participant_count = participants.len();
        if participant_count < 2 {
            return Err(ApiError::bad_request("Not enough participants for bracket"));
        }

        let round = sqlx::query_as::<_, TournamentRound>(
            r#"
            INSERT INTO tournament_rounds (
                id, tournament_id, round_number, round_type, status, created_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6
            ) RETURNING *
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(tournament_id)
        .bind(1)
        .bind(RoundType::Elimination.to_string())
        .bind(RoundStatus::Pending.to_string())
        .bind(Utc::now())
        .fetch_one(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let mut match_number = 1;
        for i in 0..participant_count {
            for j in (i + 1)..participant_count {
                sqlx::query(
                    r#"
                    INSERT INTO tournament_matches (
                        id, tournament_id, round_id, match_number, player1_id, player2_id,
                        status, created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9
                    )
                    "#,
                )
                .bind(Uuid::new_v4())
                .bind(tournament_id)
                .bind(round.id)
                .bind(match_number)
                .bind(participants[i].user_id)
                .bind(Some(participants[j].user_id))
                .bind(MatchStatus::Pending.to_string())
                .bind(Utc::now())
                .bind(Utc::now())
                .execute(&self.db_pool)
                .await
                .map_err(ApiError::database_error)?;

                match_number += 1;
            }
        }

        tracing::info!(
            "Round robin bracket generated for tournament: {} with {} matches",
            tournament_id,
            match_number - 1
        );
        Ok(())
    }

    async fn generate_swiss_bracket(
        &self,
        tournament_id: Uuid,
        participants: Vec<TournamentParticipant>,
    ) -> Result<(), ApiError> {
        let participant_count = participants.len();
        if participant_count < 2 {
            return Err(ApiError::bad_request("Not enough participants for bracket"));
        }

        let rounds = ((participant_count as f64).log2() * 1.5).ceil() as i32;

        for round_num in 1..=rounds {
            let round = sqlx::query_as::<_, TournamentRound>(
                r#"
                INSERT INTO tournament_rounds (
                    id, tournament_id, round_number, round_type, status, created_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6
                ) RETURNING *
                "#,
            )
            .bind(Uuid::new_v4())
            .bind(tournament_id)
            .bind(round_num)
            .bind(RoundType::Elimination.to_string())
            .bind(RoundStatus::Pending.to_string())
            .bind(Utc::now())
            .fetch_one(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;

            if round_num == 1 {
                let matches_in_round = participant_count / 2;
                for match_num in 1..=matches_in_round {
                    let player1_idx = (match_num - 1) * 2;
                    let player2_idx = player1_idx + 1;

                    sqlx::query(
                        r#"
                        INSERT INTO tournament_matches (
                            id, tournament_id, round_id, match_number, player1_id, player2_id,
                            status, created_at, updated_at
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9
                        )
                        "#,
                    )
                    .bind(Uuid::new_v4())
                    .bind(tournament_id)
                    .bind(round.id)
                    .bind(match_num as i32)
                    .bind(participants[player1_idx].user_id)
                    .bind(if player2_idx < participants.len() {
                        Some(participants[player2_idx].user_id)
                    } else {
                        None
                    })
                    .bind(MatchStatus::Pending.to_string())
                    .bind(Utc::now())
                    .bind(Utc::now())
                    .execute(&self.db_pool)
                    .await
                    .map_err(ApiError::database_error)?;
                }
            }
        }

        tracing::info!(
            "Swiss bracket generated for tournament: {} with {} rounds",
            tournament_id,
            rounds
        );
        Ok(())
    }

    async fn calculate_elimination_rankings(
        &self,
        tournament_id: Uuid,
        _participants: Vec<TournamentParticipant>,
    ) -> Result<(), ApiError> {
        let matches = sqlx::query_as::<_, TournamentMatch>(
            r#"
            SELECT tm.* FROM tournament_matches tm
            JOIN tournament_rounds tr ON tm.round_id = tr.id
            WHERE tm.tournament_id = $1 AND tm.status = $2
            ORDER BY tr.round_number DESC, tm.match_number
            "#,
        )
        .bind(tournament_id)
        .bind(MatchStatus::Completed.to_string())
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let mut current_rank = 1i32;

        for tournament_match in matches {
            let loser_id = if tournament_match.winner_id != Some(tournament_match.player1_id) {
                Some(tournament_match.player1_id)
            } else {
                tournament_match
                    .player2_id
                    .filter(|&p2| tournament_match.winner_id != Some(p2))
            };
            if let Some(lid) = loser_id {
                sqlx::query(
                    "UPDATE tournament_participants SET final_rank = $1 WHERE tournament_id = $2 AND user_id = $3",
                )
                .bind(current_rank)
                .bind(tournament_id)
                .bind(lid)
                .execute(&self.db_pool)
                .await
                .map_err(ApiError::database_error)?;

                current_rank += 1;
            }
        }

        Ok(())
    }

    async fn calculate_round_robin_rankings(
        &self,
        tournament_id: Uuid,
        participants: Vec<TournamentParticipant>,
    ) -> Result<(), ApiError> {
        let mut player_stats = std::collections::HashMap::new();

        for participant in &participants {
            let wins_row = sqlx::query(
                r#"
                SELECT COUNT(*) as count FROM tournament_matches
                WHERE tournament_id = $1 AND winner_id = $2 AND status = $3
                "#,
            )
            .bind(tournament_id)
            .bind(participant.user_id)
            .bind(MatchStatus::Completed.to_string())
            .fetch_one(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;

            let wins: i64 = wins_row.get("count");

            let losses_row = sqlx::query(
                r#"
                SELECT COUNT(*) as count FROM tournament_matches
                WHERE tournament_id = $1 AND (player1_id = $2 OR player2_id = $2)
                AND winner_id != $2 AND status = $3
                "#,
            )
            .bind(tournament_id)
            .bind(participant.user_id)
            .bind(MatchStatus::Completed.to_string())
            .fetch_one(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;

            let losses: i64 = losses_row.get("count");

            player_stats.insert(participant.user_id, (wins, losses));
        }

        let mut sorted_players: Vec<_> = player_stats.into_iter().collect();
        sorted_players.sort_by(|a, b| {
            let (wins_a, losses_a) = a.1;
            let (wins_b, losses_b) = b.1;
            wins_b.cmp(&wins_a).then(losses_a.cmp(&losses_b))
        });

        for (rank, (user_id, _)) in sorted_players.iter().enumerate() {
            sqlx::query(
                "UPDATE tournament_participants SET final_rank = $1 WHERE tournament_id = $2 AND user_id = $3",
            )
            .bind(rank as i32 + 1)
            .bind(tournament_id)
            .bind(user_id)
            .execute(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;
        }

        Ok(())
    }

    async fn calculate_swiss_rankings(
        &self,
        tournament_id: Uuid,
        participants: Vec<TournamentParticipant>,
    ) -> Result<(), ApiError> {
        let mut player_stats = std::collections::HashMap::new();

        for participant in &participants {
            let wins_row = sqlx::query(
                r#"
                SELECT COUNT(*) as count FROM tournament_matches
                WHERE tournament_id = $1 AND winner_id = $2 AND status = $3
                "#,
            )
            .bind(tournament_id)
            .bind(participant.user_id)
            .bind(MatchStatus::Completed.to_string())
            .fetch_one(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;

            let wins: i64 = wins_row.get("count");

            let draws_row = sqlx::query(
                r#"
                SELECT COUNT(*) as count FROM tournament_matches
                WHERE tournament_id = $1 AND (player1_id = $2 OR player2_id = $2)
                AND winner_id IS NULL AND status = $3
                "#,
            )
            .bind(tournament_id)
            .bind(participant.user_id)
            .bind(MatchStatus::Completed.to_string())
            .fetch_one(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;

            let draws: i64 = draws_row.get("count");

            let points = (wins * 3 + draws) as i32;
            player_stats.insert(participant.user_id, points);
        }

        let mut sorted_players: Vec<_> = player_stats.into_iter().collect();
        sorted_players.sort_by(|a, b| b.1.cmp(&a.1));

        for (rank, (user_id, _)) in sorted_players.iter().enumerate() {
            sqlx::query(
                "UPDATE tournament_participants SET final_rank = $1 WHERE tournament_id = $2 AND user_id = $3",
            )
            .bind(rank as i32 + 1)
            .bind(tournament_id)
            .bind(user_id)
            .execute(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;
        }

        Ok(())
    }

    async fn publish_tournament_event(
        &self,
        _event_data: serde_json::Value,
    ) -> Result<(), ApiError> {
        Ok(())
    }

    async fn publish_global_event(&self, _event_data: serde_json::Value) -> Result<(), ApiError> {
        Ok(())
    }

    /// Get tournament participants
    pub async fn get_tournament_participants(
        &self,
        tournament_id: Uuid,
    ) -> Result<Vec<TournamentParticipant>, ApiError> {
        let participants = sqlx::query_as::<_, TournamentParticipant>(
            "SELECT * FROM tournament_participants WHERE tournament_id = $1 ORDER BY registered_at",
        )
        .bind(tournament_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        Ok(participants)
    }

    /// Get tournament bracket
    pub async fn get_tournament_bracket(
        &self,
        tournament_id: Uuid,
    ) -> Result<TournamentBracketResponse, ApiError> {
        let rounds = sqlx::query_as::<_, TournamentRound>(
            "SELECT * FROM tournament_rounds WHERE tournament_id = $1 ORDER BY round_number",
        )
        .bind(tournament_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(ApiError::database_error)?;

        let mut bracket_rounds = Vec::new();
        for round in rounds {
            let matches = sqlx::query_as::<_, TournamentMatch>(
                "SELECT * FROM tournament_matches WHERE round_id = $1 ORDER BY match_number",
            )
            .bind(round.id)
            .fetch_all(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?;

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

    async fn get_user_username(&self, user_id: Uuid) -> Result<String, ApiError> {
        let row = sqlx::query("SELECT username FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(ApiError::database_error)?
            .ok_or(ApiError::not_found("User not found"))?;

        Ok(row.get("username"))
    }
}

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
