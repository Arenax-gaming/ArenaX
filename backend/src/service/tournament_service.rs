use crate::api_error::ApiError;
use crate::db::DbPool;
use crate::models::*;
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

    /// Create a new tournament
    pub async fn create_tournament(
        &self,
        creator_id: Uuid,
        request: CreateTournamentRequest,
    ) -> Result<Tournament, ApiError> {
        // Validate tournament data
        self.validate_tournament_creation(&request).await?;

        // Create tournament
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
            0, // Initial prize pool
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

        // Create prize pool record
        self.create_prize_pool(&tournament.id, &request.entry_fee_currency)
            .await?;

        // Publish tournament created event
        self.publish_tournament_event(serde_json::json!({
            "type": "created",
            "tournament_id": tournament.id,
            "name": tournament.name.clone(),
            "game": tournament.game.clone(),
            "max_participants": tournament.max_participants,
        }))
        .await?;

        // Publish global event
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

        let mut query = String::from(
            "SELECT t.*, COUNT(tp.id) as current_participants FROM tournaments t
             LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id
             WHERE 1=1",
        );
        let mut params: Vec<Box<dyn sqlx::Encode<'_, sqlx::Postgres> + Send + Sync>> = Vec::new();
        let mut param_count = 0;

        if let Some(status) = status_filter {
            param_count += 1;
            query.push_str(&format!(" AND t.status = ${}", param_count));
            params.push(Box::new(status as i32));
        }

        if let Some(game) = game_filter {
            param_count += 1;
            query.push_str(&format!(" AND t.game = ${}", param_count));
            params.push(Box::new(game));
        }

        query.push_str(" GROUP BY t.id ORDER BY t.created_at DESC");

        param_count += 1;
        query.push_str(&format!(" LIMIT ${}", param_count));
        params.push(Box::new(per_page));

        param_count += 1;
        query.push_str(&format!(" OFFSET ${}", param_count));
        params.push(Box::new(offset));

        // For now, we'll use a simpler approach with sqlx::query
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

        // Get total count
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

        // Convert to response format
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

    /// Get a specific tournament by ID
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

    /// Join a tournament
    pub async fn join_tournament(
        &self,
        user_id: Uuid,
        tournament_id: Uuid,
        request: JoinTournamentRequest,
    ) -> Result<TournamentParticipant, ApiError> {
        // Validate tournament can be joined
        let tournament = self.get_tournament_by_id(tournament_id).await?;
        self.validate_tournament_join(&tournament, user_id).await?;

        // Check if user is already a participant
        if self.is_user_participant(user_id, tournament_id).await? {
            return Err(ApiError::bad_request("User is already a participant"));
        }

        // Process payment
        self.process_entry_fee_payment(user_id, &tournament, &request)
            .await?;

        // Add participant
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

        // Update prize pool
        self.update_prize_pool(tournament_id, tournament.entry_fee)
            .await?;

        // Update tournament status if needed
        self.update_tournament_status_if_needed(tournament_id)
            .await?;

        // Get username for event
        let username = self
            .get_user_username(user_id)
            .await
            .unwrap_or_else(|| "Unknown".to_string());

        // Publish participant joined event
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

        // Handle status-specific logic
        match new_status {
            TournamentStatus::InProgress => {
                self.start_tournament(tournament_id).await?;
            }
            TournamentStatus::Completed => {
                self.complete_tournament(tournament_id).await?;
            }
            _ => {}
        }

        // Publish status change event
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

        // Check participant count
        let current_count = self.get_participant_count(tournament.id).await?;
        if current_count >= tournament.max_participants {
            return Err(ApiError::bad_request("Tournament is full"));
        }

        // Check skill level requirements
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
                // Process fiat payment via Paystack/Flutterwave
                self.process_fiat_payment(user_id, tournament, &request.payment_reference)
                    .await?;
            }
            "arenax_token" => {
                // Process ArenaX token payment
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

        // Verify payment with payment provider
        let payment_verified = self
            .verify_payment_with_provider(reference, tournament.entry_fee)
            .await?;

        if !payment_verified {
            return Err(ApiError::bad_request("Payment verification failed"));
        }

        // Update user wallet balance
        self.add_fiat_balance(user_id, tournament.entry_fee).await?;

        // Create transaction record
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
        // In a real implementation, this would:
        // 1. Make API call to Paystack/Flutterwave
        // 2. Verify the payment reference and amount
        // 3. Check payment status

        // For now, simulate payment verification
        // In production, you would use the actual payment provider APIs
        tracing::info!(
            "Verifying payment: reference={}, amount={}",
            reference,
            amount
        );

        // Simulate successful verification
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
        // Check user's ArenaX token balance
        let wallet = self.get_user_wallet(user_id).await?;

        if wallet.balance_arenax_tokens < tournament.entry_fee {
            return Err(ApiError::bad_request("Insufficient ArenaX token balance"));
        }

        // Deduct tokens from user's wallet
        self.deduct_arenax_tokens(user_id, tournament.entry_fee)
            .await?;

        // Create transaction record
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
        // Create Stellar account for prize pool
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
            r#"[50, 30, 20]"#, // Default distribution: 1st: 50%, 2nd: 30%, 3rd: 20%
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

    async fn start_tournament(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        // Generate tournament bracket
        self.generate_tournament_bracket(tournament_id).await?;

        // Update all participants to active status
        sqlx::query!(
            r#"
            UPDATE tournament_participants
            SET status = $1
            WHERE tournament_id = $2 AND status = $3
            "#,
            ParticipantStatus::Active as _,
            tournament_id,
            ParticipantStatus::Paid as _
        )
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(())
    }

    async fn complete_tournament(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        // Calculate final rankings
        self.calculate_final_rankings(tournament_id).await?;

        // Distribute prizes
        self.distribute_prizes(tournament_id).await?;

        Ok(())
    }

    async fn generate_tournament_bracket(&self, tournament_id: Uuid) -> Result<(), ApiError> {
        // Get all participants
        let participants = sqlx::query_as!(
            TournamentParticipant,
            r#"
            SELECT * FROM tournament_participants
            WHERE tournament_id = $1 AND status = $2
            ORDER BY registered_at
            "#,
            tournament_id,
            ParticipantStatus::Active as _
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Get tournament details
        let tournament = self.get_tournament_by_id(tournament_id).await?;

        // Generate bracket based on type
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

        // Calculate number of rounds needed
        let rounds = (participant_count as f64).log2().ceil() as i32;

        // Create rounds
        for round_num in 1..=rounds {
            let round = sqlx::query_as!(
                TournamentRound,
                r#"
                INSERT INTO tournament_rounds (
                    id, tournament_id, round_number, round_type, status, created_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6
                ) RETURNING *
                "#,
                Uuid::new_v4(),
                tournament_id,
                round_num,
                if round_num == rounds {
                    RoundType::Final
                } else {
                    RoundType::Elimination
                } as _,
                RoundStatus::Pending as _,
                Utc::now()
            )
            .fetch_one(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;

            // Create matches for this round
            let matches_in_round = if round_num == 1 {
                participant_count / 2
            } else {
                (participant_count / (2_i32.pow(round_num as u32))) as usize
            };

            for match_num in 1..=matches_in_round {
                let player1_idx = (match_num - 1) * 2;
                let player2_idx = player1_idx + 1;

                sqlx::query!(
                    r#"
                    INSERT INTO tournament_matches (
                        id, tournament_id, round_id, match_number, player1_id, player2_id,
                        status, created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9
                    )
                    "#,
                    Uuid::new_v4(),
                    tournament_id,
                    round.id,
                    match_num as i32,
                    participants[player1_idx].user_id,
                    if player2_idx < participants.len() {
                        Some(participants[player2_idx].user_id)
                    } else {
                        None
                    },
                    MatchStatus::Pending as _,
                    Utc::now(),
                    Utc::now()
                )
                .execute(&self.db_pool)
                .await
                .map_err(|e| ApiError::database_error(e))?;
            }
        }

        Ok(())
    }

    // Additional helper methods would be implemented here...
    // For brevity, I'll include the essential ones and mark others as TODO

    async fn get_tournament_by_id(&self, tournament_id: Uuid) -> Result<Tournament, ApiError> {
        sqlx::query_as!(
            Tournament,
            "SELECT * FROM tournaments WHERE id = $1",
            tournament_id
        )
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
        let participant = sqlx::query!(
            "SELECT status FROM tournament_participants WHERE user_id = $1 AND tournament_id = $2",
            user_id,
            tournament_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .ok_or(ApiError::not_found("Participant not found"))?;

        Ok(participant.status.into())
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

        // Check if already participant
        if self.is_user_participant(user_id, tournament_id).await? {
            return Ok(false);
        }

        // Check tournament status
        if tournament.status != TournamentStatus::RegistrationOpen {
            return Ok(false);
        }

        // Check registration deadline
        if Utc::now() > tournament.registration_deadline {
            return Ok(false);
        }

        // Check participant limit
        let current_count = self.get_participant_count(tournament_id).await?;
        if current_count >= tournament.max_participants {
            return Ok(false);
        }

        Ok(true)
    }

    async fn get_participant_count(&self, tournament_id: Uuid) -> Result<i32, ApiError> {
        let count = sqlx::query!(
            "SELECT COUNT(*) as count FROM tournament_participants WHERE tournament_id = $1",
            tournament_id
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .count
        .unwrap_or(0);

        Ok(count as i32)
    }

    async fn get_user_elo(&self, user_id: Uuid, game: &str) -> Result<i32, ApiError> {
        let elo_record = sqlx::query!(
            "SELECT current_rating FROM user_elo WHERE user_id = $1 AND game = $2",
            user_id,
            game
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(elo_record.map(|r| r.current_rating).unwrap_or(1200)) // Default Elo rating
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
        // Generate a new Stellar account for the prize pool
        // In a real implementation, this would:
        // 1. Generate a new keypair
        // 2. Create the account on Stellar network
        // 3. Fund it with XLM
        // 4. Return the public key

        // For now, generate a realistic-looking Stellar public key
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

        // Distribute prizes
        for (index, participant) in participants.iter().enumerate() {
            if index < percentages.len() && participant.final_rank.unwrap_or(0) <= 3 {
                let percentage = percentages[index];
                let prize_amount = (prize_pool.total_amount as f64 * percentage / 100.0) as i64;

                // Update participant with prize amount
                sqlx::query!(
                    "UPDATE tournament_participants SET prize_amount = $1, prize_currency = $2 WHERE id = $3",
                    prize_amount,
                    prize_pool.currency,
                    participant.id
                )
                .execute(&self.db_pool)
                .await
                .map_err(|e| ApiError::database_error(e))?;

                // TODO: In a real implementation, initiate Stellar transaction to send prize
                // For now, we'll just record the prize amount
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

    // Additional bracket generation methods
    async fn generate_double_elimination_bracket(
        &self,
        tournament_id: Uuid,
        participants: Vec<TournamentParticipant>,
    ) -> Result<(), ApiError> {
        let participant_count = participants.len();
        if participant_count < 2 {
            return Err(ApiError::bad_request("Not enough participants for bracket"));
        }

        // Calculate number of rounds needed
        let rounds = (participant_count as f64).log2().ceil() as i32;

        // Winners bracket
        for round_num in 1..=rounds {
            let round = sqlx::query_as!(
                TournamentRound,
                r#"
                INSERT INTO tournament_rounds (
                    id, tournament_id, round_number, round_type, status, created_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6
                ) RETURNING *
                "#,
                Uuid::new_v4(),
                tournament_id,
                round_num,
                RoundType::Elimination as _,
                RoundStatus::Pending as _,
                Utc::now()
            )
            .fetch_one(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;

            let matches_in_round = participant_count / 2_i32.pow(round_num as u32) as usize;
            for match_num in 1..=matches_in_round {
                let player1_idx = (match_num - 1) * 2;
                let player2_idx = player1_idx + 1;

                sqlx::query!(
                    r#"
                    INSERT INTO tournament_matches (
                        id, tournament_id, round_id, match_number, player1_id, player2_id,
                        status, created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9
                    )
                    "#,
                    Uuid::new_v4(),
                    tournament_id,
                    round.id,
                    match_num as i32,
                    participants[player1_idx].user_id,
                    if player2_idx < participants.len() {
                        Some(participants[player2_idx].user_id)
                    } else {
                        None
                    },
                    MatchStatus::Pending as _,
                    Utc::now(),
                    Utc::now()
                )
                .execute(&self.db_pool)
                .await
                .map_err(|e| ApiError::database_error(e))?;
            }
        }

        // Losers bracket would be generated after winners bracket matches
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

        // Create a round for all matches
        let round = sqlx::query_as!(
            TournamentRound,
            r#"
            INSERT INTO tournament_rounds (
                id, tournament_id, round_number, round_type, status, created_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6
            ) RETURNING *
            "#,
            Uuid::new_v4(),
            tournament_id,
            1,
            RoundType::Elimination as _,
            RoundStatus::Pending as _,
            Utc::now()
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Generate round robin pairings
        let mut match_number = 1;
        for i in 0..participant_count {
            for j in (i + 1)..participant_count {
                sqlx::query!(
                    r#"
                    INSERT INTO tournament_matches (
                        id, tournament_id, round_id, match_number, player1_id, player2_id,
                        status, created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9
                    )
                    "#,
                    Uuid::new_v4(),
                    tournament_id,
                    round.id,
                    match_number,
                    participants[i].user_id,
                    participants[j].user_id,
                    MatchStatus::Pending as _,
                    Utc::now(),
                    Utc::now()
                )
                .execute(&self.db_pool)
                .await
                .map_err(|e| ApiError::database_error(e))?;

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

        // For Swiss tournaments, we'll generate Round 1 with simple pairings
        // Subsequent rounds would be generated based on standings
        let rounds = ((participant_count as f64).log2() * 1.5).ceil() as i32; // Typically 1.5x log2(n) rounds

        for round_num in 1..=rounds {
            let round = sqlx::query_as!(
                TournamentRound,
                r#"
                INSERT INTO tournament_rounds (
                    id, tournament_id, round_number, round_type, status, created_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6
                ) RETURNING *
                "#,
                Uuid::new_v4(),
                tournament_id,
                round_num,
                RoundType::Elimination as _,
                RoundStatus::Pending as _,
                Utc::now()
            )
            .fetch_one(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;

            // For round 1, use simple seed-based pairings
            if round_num == 1 {
                let matches_in_round = (participant_count / 2) as usize;
                for match_num in 1..=matches_in_round {
                    let player1_idx = (match_num - 1) * 2;
                    let player2_idx = player1_idx + 1;

                    sqlx::query!(
                        r#"
                        INSERT INTO tournament_matches (
                            id, tournament_id, round_id, match_number, player1_id, player2_id,
                            status, created_at, updated_at
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9
                        )
                        "#,
                        Uuid::new_v4(),
                        tournament_id,
                        round.id,
                        match_num as i32,
                        participants[player1_idx].user_id,
                        if player2_idx < participants.len() {
                            Some(participants[player2_idx].user_id)
                        } else {
                            None
                        },
                        MatchStatus::Pending as _,
                        Utc::now(),
                        Utc::now()
                    )
                    .execute(&self.db_pool)
                    .await
                    .map_err(|e| ApiError::database_error(e))?;
                }
            }
            // Subsequent Swiss rounds would be pairing based on standings and strength of schedule
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
        participants: Vec<TournamentParticipant>,
    ) -> Result<(), ApiError> {
        // For elimination tournaments, rank by elimination order
        // Get matches in reverse order to determine elimination sequence
        let matches = sqlx::query_as!(
            TournamentMatch,
            r#"
            SELECT tm.* FROM tournament_matches tm
            JOIN tournament_rounds tr ON tm.round_id = tr.id
            WHERE tm.tournament_id = $1 AND tm.status = $2
            ORDER BY tr.round_number DESC, tm.match_number
            "#,
            tournament_id,
            MatchStatus::Completed as _
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let mut rankings = Vec::new();
        let mut current_rank = 1;

        // Process matches to determine rankings
        for tournament_match in matches {
            if let Some(loser_id) = tournament_match.player1_id {
                if tournament_match.winner_id != Some(loser_id) {
                    rankings.push((loser_id, current_rank));
                    current_rank += 1;
                }
            }
            if let Some(loser_id) = tournament_match.player2_id {
                if tournament_match.winner_id != Some(loser_id) {
                    rankings.push((loser_id, current_rank));
                    current_rank += 1;
                }
            }
        }

        // Update participant rankings
        for (user_id, rank) in rankings {
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
        participants: Vec<TournamentParticipant>,
    ) -> Result<(), ApiError> {
        // For round robin, calculate win/loss records
        let mut player_stats = std::collections::HashMap::new();

        for participant in &participants {
            let wins = sqlx::query!(
                r#"
                SELECT COUNT(*) as count FROM tournament_matches
                WHERE tournament_id = $1 AND winner_id = $2 AND status = $3
                "#,
                tournament_id,
                participant.user_id,
                MatchStatus::Completed as _
            )
            .fetch_one(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?
            .count
            .unwrap_or(0);

            let losses = sqlx::query!(
                r#"
                SELECT COUNT(*) as count FROM tournament_matches
                WHERE tournament_id = $1 AND (player1_id = $2 OR player2_id = $2)
                AND winner_id != $2 AND status = $3
                "#,
                tournament_id,
                participant.user_id,
                participant.user_id,
                MatchStatus::Completed as _
            )
            .fetch_one(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?
            .count
            .unwrap_or(0);

            player_stats.insert(participant.user_id, (wins, losses));
        }

        // Sort by wins (descending), then by losses (ascending)
        let mut sorted_players: Vec<_> = player_stats.into_iter().collect();
        sorted_players.sort_by(|a, b| {
            let (wins_a, losses_a) = a.1;
            let (wins_b, losses_b) = b.1;
            wins_b.cmp(&wins_a).then(losses_a.cmp(&losses_b))
        });

        // Update rankings
        for (rank, (user_id, _)) in sorted_players.iter().enumerate() {
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
        participants: Vec<TournamentParticipant>,
    ) -> Result<(), ApiError> {
        // For Swiss tournaments, rank by points and tiebreakers
        let mut player_stats = std::collections::HashMap::new();

        for participant in &participants {
            let wins = sqlx::query!(
                r#"
                SELECT COUNT(*) as count FROM tournament_matches
                WHERE tournament_id = $1 AND winner_id = $2 AND status = $3
                "#,
                tournament_id,
                participant.user_id,
                MatchStatus::Completed as _
            )
            .fetch_one(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?
            .count
            .unwrap_or(0);

            let draws = sqlx::query!(
                r#"
                SELECT COUNT(*) as count FROM tournament_matches
                WHERE tournament_id = $1 AND (player1_id = $2 OR player2_id = $2)
                AND winner_id IS NULL AND status = $3
                "#,
                tournament_id,
                participant.user_id,
                MatchStatus::Completed as _
            )
            .fetch_one(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?
            .count
            .unwrap_or(0);

            // Swiss points: 3 for win, 1 for draw, 0 for loss
            let points = (wins * 3 + draws) as i32;
            player_stats.insert(participant.user_id, points);
        }

        // Sort by points (descending)
        let mut sorted_players: Vec<_> = player_stats.into_iter().collect();
        sorted_players.sort_by(|a, b| b.1.cmp(&a.1));

        // Update rankings
        for (rank, (user_id, _)) in sorted_players.iter().enumerate() {
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

    // Real-time event publishing methods
    // TODO: Implement proper realtime module with event types
    async fn publish_tournament_event(
        &self,
        _event_data: serde_json::Value,
    ) -> Result<(), ApiError> {
        // Placeholder for real-time tournament event publishing
        // Will be implemented when realtime module is added
        Ok(())
    }

    async fn publish_global_event(&self, _event_data: serde_json::Value) -> Result<(), ApiError> {
        // Placeholder for real-time global event publishing
        // Will be implemented when realtime module is added
        Ok(())
    }

    /// Get tournament participants
    pub async fn get_tournament_participants(
        &self,
        tournament_id: Uuid,
    ) -> Result<Vec<TournamentParticipant>, ApiError> {
        let participants = sqlx::query_as!(
            TournamentParticipant,
            "SELECT * FROM tournament_participants WHERE tournament_id = $1 ORDER BY registered_at",
            tournament_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        Ok(participants)
    }

    /// Get tournament bracket
    pub async fn get_tournament_bracket(
        &self,
        tournament_id: Uuid,
    ) -> Result<TournamentBracketResponse, ApiError> {
        // Get tournament rounds
        let rounds = sqlx::query_as!(
            TournamentRound,
            "SELECT * FROM tournament_rounds WHERE tournament_id = $1 ORDER BY round_number",
            tournament_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Get matches for each round
        let mut bracket_rounds = Vec::new();
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
                round_type: round.round_type.into(),
                status: round.status.into(),
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
                        status: m.status.into(),
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
        let user = sqlx::query!("SELECT username FROM users WHERE id = $1", user_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?
            .ok_or(ApiError::not_found("User not found"))?;

        Ok(user.username)
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

// Helper trait implementations for enum conversions
impl From<i32> for TournamentStatus {
    fn from(value: i32) -> Self {
        match value {
            0 => TournamentStatus::Draft,
            1 => TournamentStatus::Upcoming,
            2 => TournamentStatus::RegistrationOpen,
            3 => TournamentStatus::RegistrationClosed,
            4 => TournamentStatus::InProgress,
            5 => TournamentStatus::Completed,
            6 => TournamentStatus::Cancelled,
            _ => TournamentStatus::Draft,
        }
    }
}

impl From<i32> for ParticipantStatus {
    fn from(value: i32) -> Self {
        match value {
            0 => ParticipantStatus::Registered,
            1 => ParticipantStatus::Paid,
            2 => ParticipantStatus::Active,
            3 => ParticipantStatus::Eliminated,
            4 => ParticipantStatus::Disqualified,
            5 => ParticipantStatus::Withdrawn,
            _ => ParticipantStatus::Registered,
        }
    }
}

impl From<i32> for BracketType {
    fn from(value: i32) -> Self {
        match value {
            0 => BracketType::SingleElimination,
            1 => BracketType::DoubleElimination,
            2 => BracketType::RoundRobin,
            3 => BracketType::Swiss,
            _ => BracketType::SingleElimination,
        }
    }
}
