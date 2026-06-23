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
            let loser_id = if tournament_match.winner_id != Some(tournament_match.player1_id) {
                Some(tournament_match.player1_id)
            } else {
                tournament_match
                    .player2_id
                    .filter(|&p2| tournament_match.winner_id != Some(p2))
            };
            if let Some(lid) = loser_id {
                rankings.push((lid, current_rank));
                current_rank += 1;
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
        let user = sqlx::query!("SELECT username FROM users WHERE id = $1", user_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?
            .ok_or(ApiError::not_found("User not found"))?;

        Ok(user.username)
    }

    /// Get tournament analytics dashboard data (Issue #291)
    /// Get tournament leaderboard (Issue #286)
    pub async fn get_tournament_leaderboard(
        &self,
        tournament_id: Uuid,
    ) -> Result<Vec<TournamentLeaderboardEntry>, ApiError> {
        // Query participants, sorted by final_rank (if completed) or by registered_at
        let participants = sqlx::query!(
            r#"
            SELECT tp.user_id, u.username, tp.final_rank, tp.prize_amount
            FROM tournament_participants tp
            JOIN users u ON tp.user_id = u.id
            WHERE tp.tournament_id = $1
            ORDER BY tp.final_rank ASC NULLS LAST, tp.registered_at ASC
            "#,
            tournament_id
    /// Get comprehensive tournament statistics
    pub async fn get_tournament_statistics(
        &self,
        tournament_id: Uuid,
    ) -> Result<TournamentStatisticsResponse, ApiError> {
        // Get basic tournament info
        let tournament = self.get_tournament_by_id(tournament_id).await?;

        // Get participant count
        let participant_count = self.get_participant_count(tournament_id).await?;

        // Get tournament rounds count
        let round_count = sqlx::query!("SELECT COUNT(*) as count FROM tournament_rounds WHERE tournament_id = $1", tournament_id)
            .fetch_one(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;

        // Get current round (highest round number with matches)
        let current_round = sqlx::query!("SELECT COALESCE(MAX(tr.round_number), 0) as current_round FROM tournament_rounds tr JOIN tournament_matches tm ON tr.id = tm.round_id WHERE tr.tournament_id = $1 AND tm.status IN ('in_progress', 'completed')", tournament_id)
            .fetch_one(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?
            .current_round
            .unwrap_or(0);

        // Get match statistics
        let match_stats = sqlx::query!("SELECT 
            COUNT(*) as total_matches,
            COUNT(CASE WHEN tm.status = 'completed' THEN 1 END) as completed_matches,
            COUNT(CASE WHEN tm.status = 'pending' OR tm.status = 'scheduled' THEN 1 END) as pending_matches,
            COUNT(CASE WHEN tm.status = 'in_progress' THEN 1 END) as in_progress_matches,
            COUNT(CASE WHEN tm.status = 'disputed' THEN 1 END) as disputed_matches
            FROM tournament_matches tm
            WHERE tm.tournament_id = $1",
            tournament_id
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Get prize pool information
        let prize_pool = sqlx::query!("SELECT total_amount, currency FROM prize_pools WHERE tournament_id = $1", tournament_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?
            .unwrap_or_else(|| {
                sqlx::query!("SELECT 0 as total_amount, 'USD' as currency")
                    .fetch_one(&self.db_pool)
                    .await
                    .map_err(|e| ApiError::database_error(e))
                    .ok()
                    .unwrap_or(sqlx::query!("SELECT 0 as total_amount, 'USD' as currency").fetch_one(&self.db_pool).await.unwrap())
            });

        // Calculate registration completion rate
        let registration_completion_rate = if tournament.max_participants > 0 {
            ((participant_count as f32 / tournament.max_participants as f32) * 100.0) as i32
        } else {
            0
        };

        // Calculate tournament completion rate
        let completion_rate = if match_stats.total_matches > 0 {
            ((match_stats.completed_matches as f32 / match_stats.total_matches as f32) * 100.0) as i32
        } else {
            0
        };

        // Get tournament status details
        let (prize_pool_amount, prize_pool_currency) = match prize_pool {
            Some(p) => (p.total_amount, p.currency),
            None => (0, "USD".to_string()),
        };

        Ok(TournamentStatisticsResponse {
            tournament_id,
            tournament_name: tournament.name,
            game: tournament.game,
            status: tournament.status,
            participant_count,
            total_matches: match_stats.total_matches,
            completed_matches: match_stats.completed_matches,
            pending_matches: match_stats.pending_matches,
            in_progress_matches: match_stats.in_progress_matches,
            disputed_matches: match_stats.disputed_matches,
            prize_pool_amount,
            prize_pool_currency,
            round_count: round_count.count.unwrap_or(0),
            current_round,
            registration_completion_rate,
            completion_rate,
        })
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct TournamentStatisticsResponse {
        pub tournament_id: Uuid,
        pub tournament_name: String,
        pub game: String,
        pub status: TournamentStatus,
        pub participant_count: i32,
        pub total_matches: i64,
        pub completed_matches: i64,
        pub pending_matches: i64,
        pub in_progress_matches: i64,
        pub disputed_matches: i64,
        pub prize_pool_amount: i64,
        pub prize_pool_currency: String,
        pub round_count: i64,
        pub current_round: i32,
        pub registration_completion_rate: i32,
        pub completion_rate: i32,
    }

    /// Get tournament leaderboard with ELO ratings and performance metrics
    pub async fn get_tournament_leaderboard(
        &self,
        tournament_id: Uuid,
        page: i32,
        per_page: i32,
    ) -> Result<TournamentLeaderboardResponse, ApiError> {
        let offset = (page - 1) * per_page;

        // Get tournament participants with their ELO ratings
        let participants = sqlx::query!("SELECT 
            tp.id as participant_id,
            tp.user_id,
            tp.registered_at,
            tp.entry_fee_paid,
            tp.status as participant_status,
            tp.final_rank,
            tp.prize_amount,
            tp.prize_currency,
            u.username,
            u.display_name,
            ue.current_rating as elo_rating,
            COALESCE(wins.wins, 0) as wins,
            COALESCE(losses.losses, 0) as losses,
            COALESCE(draws.draws, 0) as draws,
            COALESCE(matches.total_matches, 0) as total_matches
            FROM tournament_participants tp
            JOIN users u ON tp.user_id = u.id
            LEFT JOIN user_elo ue ON tp.user_id = ue.user_id AND ue.game = (SELECT game FROM tournaments WHERE id = $1)
            LEFT JOIN (
                SELECT winner_id, COUNT(*) as wins 
                FROM tournament_matches 
                WHERE tournament_id = $1 AND winner_id IS NOT NULL 
                GROUP BY winner_id
            ) wins ON tp.user_id = wins.winner_id
            LEFT JOIN (
                SELECT player1_id as loser_id, COUNT(*) as losses 
                FROM tournament_matches 
                WHERE tournament_id = $1 AND winner_id = player2_id AND winner_id IS NOT NULL 
                GROUP BY player1_id
            ) losses ON tp.user_id = losses.loser_id
            LEFT JOIN (
                SELECT player2_id as loser_id, COUNT(*) as losses 
                FROM tournament_matches 
                WHERE tournament_id = $1 AND winner_id = player1_id AND winner_id IS NOT NULL 
                GROUP BY player2_id
            ) losses2 ON tp.user_id = losses2.loser_id
            LEFT JOIN (
                SELECT player1_id as draw_id, COUNT(*) as draws 
                FROM tournament_matches 
                WHERE tournament_id = $1 AND winner_id IS NULL 
                GROUP BY player1_id
            ) draws ON tp.user_id = draws.draw_id
            LEFT JOIN (
                SELECT player2_id as draw_id, COUNT(*) as draws 
                FROM tournament_matches 
                WHERE tournament_id = $1 AND winner_id IS NULL 
                GROUP BY player2_id
            ) draws2 ON tp.user_id = draws2.draw_id
            LEFT JOIN (
                SELECT user_id, COUNT(*) as total_matches 
                FROM (
                    SELECT player1_id as user_id FROM tournament_matches WHERE tournament_id = $1
                    UNION ALL
                    SELECT player2_id as user_id FROM tournament_matches WHERE tournament_id = $1 AND player2_id IS NOT NULL
                ) all_players
                GROUP BY user_id
            ) matches ON tp.user_id = matches.user_id
            WHERE tp.tournament_id = $1
            ORDER BY tp.final_rank ASC, tp.registered_at ASC
            LIMIT $2 OFFSET $3",
            tournament_id,
            per_page,
            offset
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Get total count for pagination
        let total = sqlx::query!("SELECT COUNT(*) as count FROM tournament_participants WHERE tournament_id = $1", tournament_id)
            .fetch_one(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?
            .count
            .unwrap_or(0);

            leaderboard.push(TournamentLeaderboardEntry {
                user_id: p.user_id,
                username: p.username,
                final_rank: p.final_rank,
                prize_amount: p.prize_amount,
                points: (wins * 10) as i32, // Example point system
            });
        }

        Ok(leaderboard)
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TournamentLeaderboardEntry {
    pub user_id: Uuid,
    pub username: String,
    pub final_rank: Option<i32>,
    pub prize_amount: Option<i64>,
    pub points: i32,
}
        // Convert to response format
        let mut leaderboard_entries = Vec::new();
        for row in participants {
            let elo_rating = if row.elo_rating.is_some() { row.elo_rating.unwrap() } else { 1200 };
            let win_rate = if row.total_matches > 0 {
                ((row.wins as f32 / row.total_matches as f32) * 100.0).round() as i32
            } else {
                0
            };

            leaderboard_entries.push(TournamentLeaderboardEntry {
                participant_id: row.participant_id,
                user_id: row.user_id,
                username: row.username,
                display_name: row.display_name,
                elo_rating,
                final_rank: row.final_rank,
                wins: row.wins,
                losses: row.losses,
                draws: row.draws,
                total_matches: row.total_matches,
                win_rate_pct: win_rate,
                prize_amount: row.prize_amount,
                prize_currency: row.prize_currency,
                participant_status: row.participant_status.parse().unwrap_or(ParticipantStatus::Registered),
            });
        }

        Ok(TournamentLeaderboardResponse {
            tournament_id,
            entries: leaderboard_entries,
            total,
            page,
            per_page,
        })
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct TournamentLeaderboardResponse {
        pub tournament_id: Uuid,
        pub entries: Vec<TournamentLeaderboardEntry>,
        pub total: i64,
        pub page: i32,
        pub per_page: i32,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct TournamentLeaderboardEntry {
        pub participant_id: Uuid,
        pub user_id: Uuid,
        pub username: String,
        pub display_name: Option<String>,
        pub elo_rating: i32,
        pub final_rank: Option<i32>,
        pub wins: i64,
        pub losses: i64,
        pub draws: i64,
        pub total_matches: i64,
        pub win_rate_pct: i32,
        pub prize_amount: Option<i64>,
        pub prize_currency: Option<String>,
        pub participant_status: ParticipantStatus,
    }

    /// Get comprehensive tournament analytics for dashboard visualization
    pub async fn get_tournament_analytics(
        &self,
        tournament_id: Uuid,
    ) -> Result<TournamentAnalyticsResponse, ApiError> {
        let total_participants = self.get_participant_count(tournament_id).await?;
        
        let matches_stats = sqlx::query!(
            r#"
            SELECT 
                COUNT(*) as total_matches,
                SUM(CASE WHEN status = $2 THEN 1 ELSE 0 END) as matches_completed
            FROM tournament_matches
            WHERE tournament_id = $1
            "#,
            tournament_id,
            MatchStatus::Completed as _
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        let prize_pool = sqlx::query!(
            "SELECT total_amount FROM prize_pools WHERE tournament_id = $1",
        // Get basic tournament info
        let tournament = self.get_tournament_by_id(tournament_id).await?;

        // Get participant count
        let participant_count = self.get_participant_count(tournament_id).await?;

        // Get match statistics by round
        let round_stats = sqlx::query!("SELECT 
            tr.round_number,
            tr.round_type,
            COUNT(tm.id) as total_matches,
            COUNT(CASE WHEN tm.status = 'completed' THEN 1 END) as completed_matches,
            COUNT(CASE WHEN tm.status = 'pending' OR tm.status = 'scheduled' THEN 1 END) as pending_matches,
            COUNT(CASE WHEN tm.status = 'in_progress' THEN 1 END) as in_progress_matches,
            COUNT(CASE WHEN tm.status = 'disputed' THEN 1 END) as disputed_matches,
            AVG(EXTRACT(EPOCH FROM (tm.completed_at - tm.started_at))) as avg_duration_secs
            FROM tournament_rounds tr
            LEFT JOIN tournament_matches tm ON tr.id = tm.round_id AND tr.tournament_id = $1
            WHERE tr.tournament_id = $1
            GROUP BY tr.round_number, tr.round_type
            ORDER BY tr.round_number",
            tournament_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Get prize pool distribution
        let prize_distribution = sqlx::query!("SELECT 
            pp.total_amount as prize_pool_amount,
            pp.currency as prize_pool_currency,
            pp.distribution_percentages as distribution_percentages_json,
            COALESCE(SUM(tp.prize_amount), 0) as distributed_amount
            FROM prize_pools pp
            LEFT JOIN tournament_participants tp ON pp.tournament_id = tp.tournament_id AND tp.prize_amount IS NOT NULL
            WHERE pp.tournament_id = $1
            GROUP BY pp.total_amount, pp.currency, pp.distribution_percentages",
            tournament_id
        )
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .map(|p| p.total_amount)
        .unwrap_or(0);

        Ok(TournamentAnalyticsResponse {
            total_participants,
            total_matches: matches_stats.total_matches.unwrap_or(0) as i32,
            matches_completed: matches_stats.matches_completed.unwrap_or(0) as i32,
            current_prize_pool: prize_pool,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TournamentAnalyticsResponse {
    pub total_participants: i32,
    pub total_matches: i32,
    pub matches_completed: i32,
    pub current_prize_pool: i64,
}
        .unwrap_or_else(|| {
            sqlx::query!("SELECT 0 as prize_pool_amount, 'USD' as prize_pool_currency, '[]' as distribution_percentages_json, 0 as distributed_amount")
                .fetch_one(&self.db_pool)
                .await
                .map_err(|e| ApiError::database_error(e))
                .ok()
                .unwrap_or(sqlx::query!("SELECT 0 as prize_pool_amount, 'USD' as prize_pool_currency, '[]' as distribution_percentages_json, 0 as distributed_amount").fetch_one(&self.db_pool).await.unwrap())
        });

        // Get registration timeline
        let registration_timeline = sqlx::query!("SELECT 
            COUNT(*) as total_registrations,
            MIN(tp.registered_at) as first_registration,
            MAX(tp.registered_at) as last_registration,
            COUNT(CASE WHEN tp.entry_fee_paid THEN 1 END) as paid_registrations,
            COUNT(CASE WHEN tp.status = 'active' THEN 1 END) as active_participants
            FROM tournament_participants tp
            WHERE tp.tournament_id = $1",
            tournament_id
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Get participant skill level distribution
        let skill_distribution = sqlx::query!("SELECT 
            COUNT(*) as total_participants,
            AVG(ue.current_rating) as avg_elo,
            MIN(ue.current_rating) as min_elo,
            MAX(ue.current_rating) as max_elo,
            STDDEV(ue.current_rating) as elo_stddev
            FROM tournament_participants tp
            LEFT JOIN user_elo ue ON tp.user_id = ue.user_id AND ue.game = $1
            WHERE tp.tournament_id = $2",
            tournament.game,
            tournament_id
        )
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?
        .unwrap_or_else(|| {
            sqlx::query!("SELECT 0 as total_participants, 0 as avg_elo, 0 as min_elo, 0 as max_elo, 0 as elo_stddev")
                .fetch_one(&self.db_pool)
                .await
                .map_err(|e| ApiError::database_error(e))
                .ok()
                .unwrap_or(sqlx::query!("SELECT 0 as total_participants, 0 as avg_elo, 0 as min_elo, 0 as max_elo, 0 as elo_stddev").fetch_one(&self.db_pool).await.unwrap())
        });

        // Convert JSON distribution percentages
        let distribution_percentages: Vec<f64> = if let Some(ref json_str) = prize_distribution.distribution_percentages_json {
            serde_json::from_str(json_str)
                .map_err(|e| ApiError::internal_error(format!("Invalid distribution percentages JSON: {}", e)))?
        } else {
            vec![]
        };

        Ok(TournamentAnalyticsResponse {
            tournament_id,
            tournament_name: tournament.name,
            game: tournament.game,
            status: tournament.status,
            participant_count,
            registration_timeline: TournamentRegistrationTimeline {
                total_registrations: registration_timeline.total_registrations.unwrap_or(0),
                first_registration: registration_timeline.first_registration,
                last_registration: registration_timeline.last_registration,
                paid_registrations: registration_timeline.paid_registrations.unwrap_or(0),
                active_participants: registration_timeline.active_participants.unwrap_or(0),
            },
            round_statistics: round_stats
                .into_iter()
                .map(|r| TournamentRoundStatistics {
                    round_number: r.round_number.unwrap_or(0),
                    round_type: r.round_type,
                    total_matches: r.total_matches.unwrap_or(0),
                    completed_matches: r.completed_matches.unwrap_or(0),
                    pending_matches: r.pending_matches.unwrap_or(0),
                    in_progress_matches: r.in_progress_matches.unwrap_or(0),
                    disputed_matches: r.disputed_matches.unwrap_or(0),
                    avg_duration_secs: r.avg_duration_secs.map(|d| d as f64).unwrap_or(0.0),
                })
                .collect(),
            prize_pool: TournamentPrizePool {
                total_amount: prize_distribution.prize_pool_amount.unwrap_or(0),
                currency: prize_distribution.prize_pool_currency.unwrap_or("USD".to_string()),
                distribution_percentages,
                distributed_amount: prize_distribution.distributed_amount.unwrap_or(0),
            },
            skill_level_distribution: TournamentSkillDistribution {
                total_participants: skill_distribution.total_participants.unwrap_or(0),
                average_elo: skill_distribution.avg_elo.unwrap_or(0.0) as i32,
                min_elo: skill_distribution.min_elo.unwrap_or(0.0) as i32,
                max_elo: skill_distribution.max_elo.unwrap_or(0.0) as i32,
                elo_stddev: skill_distribution.elo_stddev.unwrap_or(0.0) as i32,
            },
        })
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct TournamentAnalyticsResponse {
        pub tournament_id: Uuid,
        pub tournament_name: String,
        pub game: String,
        pub status: TournamentStatus,
        pub participant_count: i32,
        pub registration_timeline: TournamentRegistrationTimeline,
        pub round_statistics: Vec<TournamentRoundStatistics>,
        pub prize_pool: TournamentPrizePool,
        pub skill_level_distribution: TournamentSkillDistribution,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct TournamentRegistrationTimeline {
        pub total_registrations: i64,
        pub first_registration: Option<DateTime<Utc>>,
        pub last_registration: Option<DateTime<Utc>>,
        pub paid_registrations: i64,
        pub active_participants: i64,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct TournamentRoundStatistics {
        pub round_number: i32,
        pub round_type: String,
        pub total_matches: i64,
        pub completed_matches: i64,
        pub pending_matches: i64,
        pub in_progress_matches: i64,
        pub disputed_matches: i64,
        pub avg_duration_secs: f64,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct TournamentPrizePool {
        pub total_amount: i64,
        pub currency: String,
        pub distribution_percentages: Vec<f64>,
        pub distributed_amount: i64,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct TournamentSkillDistribution {
        pub total_participants: i64,
        pub average_elo: i32,
        pub min_elo: i32,
        pub max_elo: i32,
        pub elo_stddev: i32,
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

#[derive(Debug, Serialize, Deserialize)]
pub struct TournamentPlayerInfo {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub final_rank: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BracketMatch {
    pub match_id: Uuid,
    pub match_number: i32,
    pub player1: TournamentPlayerInfo,
    pub player2: TournamentPlayerInfo,
    pub winner_id: Option<Uuid>,
    pub player1_score: Option<i32>,
    pub player2_score: Option<i32>,
    pub status: MatchStatus,
    pub scheduled_time: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}

    /// Get enhanced tournament bracket with detailed match information
    pub async fn get_enhanced_tournament_bracket(
        &self,
        tournament_id: Uuid,
    ) -> Result<TournamentBracketResponse, ApiError> {
        // Get tournament rounds
        let rounds = sqlx::query_as!(TournamentRound,
            "SELECT * FROM tournament_rounds WHERE tournament_id = $1 ORDER BY round_number",
            tournament_id
        )
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::database_error(e))?;

        // Get matches for each round with additional participant information
        let mut bracket_rounds = Vec::new();
        for round in rounds {
            let matches = sqlx::query!("SELECT 
                tm.id as match_id,
                tm.match_number,
                tm.player1_id,
                tm.player2_id,
                tm.winner_id,
                tm.player1_score,
                tm.player2_score,
                tm.status as match_status,
                tm.scheduled_time,
                tm.started_at,
                tm.completed_at,
                u1.username as player1_username,
                u2.username as player2_username,
                u1.display_name as player1_display_name,
                u2.display_name as player2_display_name,
                tp1.final_rank as player1_final_rank,
                tp2.final_rank as player2_final_rank
                FROM tournament_matches tm
                LEFT JOIN users u1 ON tm.player1_id = u1.id
                LEFT JOIN users u2 ON tm.player2_id = u2.id
                LEFT JOIN tournament_participants tp1 ON tm.player1_id = tp1.user_id AND tm.tournament_id = tp1.tournament_id
                LEFT JOIN tournament_participants tp2 ON tm.player2_id = tp2.user_id AND tm.tournament_id = tp2.tournament_id
                WHERE tm.round_id = $1
                ORDER BY tm.match_number",
                round.id
            )
            .fetch_all(&self.db_pool)
            .await
            .map_err(|e| ApiError::database_error(e))?;

            let mut round_matches = Vec::new();
            for match_row in matches {
                // Get player names and display info
                let player1_info = if let Some(username) = match_row.player1_username {
                    TournamentPlayerInfo {
                        user_id: match_row.player1_id,
                        username,
                        display_name: match_row.player1_display_name,
                        final_rank: match_row.player1_final_rank,
                    }
                } else {
                    TournamentPlayerInfo {
                        user_id: match_row.player1_id,
                        username: "Unknown".to_string(),
                        display_name: None,
                        final_rank: None,
                    }
                };

                let player2_info = if let Some(username) = match_row.player2_username {
                    TournamentPlayerInfo {
                        user_id: match_row.player2_id.unwrap_or_default(),
                        username,
                        display_name: match_row.player2_display_name,
                        final_rank: match_row.player2_final_rank,
                    }
                } else {
                    TournamentPlayerInfo {
                        user_id: match_row.player2_id.unwrap_or_default(),
                        username: "Bye".to_string(),
                        display_name: None,
                        final_rank: None,
                    }
                };

                round_matches.push(BracketMatch {
                    match_id: match_row.match_id,
                    match_number: match_row.match_number.unwrap_or(0),
                    player1: player1_info,
                    player2: player2_info,
                    winner_id: match_row.winner_id,
                    player1_score: match_row.player1_score,
                    player2_score: match_row.player2_score,
                    status: match_row.match_status.parse().unwrap_or(MatchStatus::Pending),
                    scheduled_time: match_row.scheduled_time,
                    started_at: match_row.started_at,
                    completed_at: match_row.completed_at,
                });
            }

            bracket_rounds.push(BracketRound {
                round_id: round.id,
                round_number: round.round_number,
                round_type: round.round_type.parse().unwrap_or(RoundType::Elimination),
                status: round.status.parse().unwrap_or(RoundStatus::Pending),
                matches: round_matches,
            });
        }

        Ok(TournamentBracketResponse {
            tournament_id,
            rounds: bracket_rounds,
        })
    }
}
