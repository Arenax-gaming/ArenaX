use std::collections::HashMap;
use std::sync::Arc;

use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use crate::api_error::ApiError;
use crate::models::batch::*;

/// In-memory progress store keyed by batch id.
///
/// In production this could be backed by Redis; an in-process `RwLock<HashMap>`
/// is sufficient for the initial implementation.
#[derive(Debug, Clone, Default)]
pub struct BatchProgressStore {
    inner: Arc<tokio::sync::RwLock<HashMap<Uuid, BatchStatus>>>,
}

impl BatchProgressStore {
    pub fn new() -> Self {
        Self::default()
    }

    async fn set_status(&self, batch_id: Uuid, status: BatchStatus) {
        self.inner.write().await.insert(batch_id, status);
    }

    pub async fn get_status(&self, batch_id: Uuid) -> Option<BatchStatus> {
        self.inner.read().await.get(&batch_id).cloned()
    }

    /// Remove a completed / rolled-back entry to prevent unbounded memory
    /// growth.  Callers should invoke this once the client has acknowledged
    /// the final response.
    pub async fn remove(&self, batch_id: Uuid) {
        self.inner.write().await.remove(&batch_id);
    }
}

// ─── BatchService ────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct BatchService {
    pool: PgPool,
    progress: BatchProgressStore,
}

impl BatchService {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            progress: BatchProgressStore::new(),
        }
    }

    pub fn progress_store(&self) -> &BatchProgressStore {
        &self.progress
    }

    /// Execute a batch request and return a fully populated response.
    pub async fn execute(&self, request: BatchRequest) -> Result<BatchResponse, ApiError> {
        request
            .validate()
            .map_err(|msg| ApiError::bad_request(msg))?;

        let batch_id = Uuid::new_v4();
        // Mark as in-progress for progress tracking
        self.progress.set_status(batch_id, BatchStatus::Completed).await;

        let result = match request.semantics {
            BatchSemantics::Atomic => self.execute_atomic(&batch_id, &request).await,
            BatchSemantics::Partial => self.execute_partial(&batch_id, &request).await,
        };

        // Update progress store with final status
        if let Ok(ref resp) = result {
            self.progress
                .set_status(batch_id, resp.status.clone())
                .await;
        }

        result
    }

    // ─── Atomic semantics ────────────────────────────────────────────────────

    async fn execute_atomic(
        &self,
        batch_id: &Uuid,
        request: &BatchRequest,
    ) -> Result<BatchResponse, ApiError> {
        let mut tx = self.pool.begin().await.map_err(ApiError::DatabaseError)?;

        let mut results = Vec::with_capacity(request.items.len());
        let mut succeeded = 0usize;
        let mut failed = 0usize;

        // Snapshot current state for potential rollback (idempotent if the
        // operation doesn't change existing rows — this is a best-effort
        // approach; a production system may want to record row snapshots).
        for (idx, item) in request.items.iter().enumerate() {
            match self.process_item(&mut *tx, &request.operation, &request.entity, item).await {
                Ok(value) => {
                    succeeded += 1;
                    results.push(BatchItemResult {
                        client_id: item.client_id,
                        status: BatchItemStatus::Succeeded,
                        data: Some(value),
                        error: None,
                    });
                }
                Err(e) => {
                    failed += 1;
                    results.push(BatchItemResult {
                        client_id: item.client_id,
                        status: BatchItemStatus::Failed,
                        data: None,
                        error: Some(BatchItemError {
                            code: "ITEM_FAILED".to_string(),
                            message: e.to_string(),
                        }),
                    });

                    // Atomic mode: rollback everything processed so far
                    let _ = tx.rollback().await;
                    return Ok(BatchResponse {
                        batch_id: *batch_id,
                        operation: request.operation.clone(),
                        status: BatchStatus::RolledBack,
                        results,
                        progress: BatchProgress {
                            total: request.items.len(),
                            succeeded,
                            failed,
                        },
                        rollback: Some(BatchRollbackInfo {
                            reason: format!(
                                "Item at index {} failed: {}",
                                idx,
                                e
                            ),
                            processed_before_rollback: succeeded,
                        }),
                    });
                }
            }
        }

        // All items succeeded — commit
        tx.commit().await.map_err(ApiError::DatabaseError)?;

        Ok(BatchResponse {
            batch_id: *batch_id,
            operation: request.operation.clone(),
            status: BatchStatus::Completed,
            results,
            progress: BatchProgress {
                total: request.items.len(),
                succeeded,
                failed,
            },
            rollback: None,
        })
    }

    // ─── Partial semantics ───────────────────────────────────────────────────

    async fn execute_partial(
        &self,
        batch_id: &Uuid,
        request: &BatchRequest,
    ) -> Result<BatchResponse, ApiError> {
        let mut results = Vec::with_capacity(request.items.len());
        let mut succeeded = 0usize;
        let mut failed = 0usize;

        for item in &request.items {
            // Each item gets its own transaction so failures are isolated
            let mut tx = self.pool.begin().await.map_err(ApiError::DatabaseError)?;

            match self.process_item(&mut *tx, &request.operation, &request.entity, item).await {
                Ok(value) => {
                    tx.commit().await.map_err(ApiError::DatabaseError)?;
                    succeeded += 1;
                    results.push(BatchItemResult {
                        client_id: item.client_id,
                        status: BatchItemStatus::Succeeded,
                        data: Some(value),
                        error: None,
                    });
                }
                Err(e) => {
                    let _ = tx.rollback().await;
                    failed += 1;
                    results.push(BatchItemResult {
                        client_id: item.client_id,
                        status: BatchItemStatus::Failed,
                        data: None,
                        error: Some(BatchItemError {
                            code: "ITEM_FAILED".to_string(),
                            message: e.to_string(),
                        }),
                    });
                }
            }
        }

        let status = if failed == 0 {
            BatchStatus::Completed
        } else {
            BatchStatus::PartialFailure
        };

        Ok(BatchResponse {
            batch_id: *batch_id,
            operation: request.operation.clone(),
            status,
            results,
            progress: BatchProgress {
                total: request.items.len(),
                succeeded,
                failed,
            },
            rollback: None,
        })
    }

    // ─── Per-item processing ─────────────────────────────────────────────────

    async fn process_item(
        &self,
        tx: &mut sqlx::PgConnection,
        operation: &BatchOperation,
        entity: &str,
        item: &BatchItem,
    ) -> Result<serde_json::Value, ApiError> {
        match (operation, entity) {
            // ── Creates ───────────────────────────────────────────────────────
            (BatchOperation::Create, "notifications") => {
                let user_id = item
                    .data
                    .get("userId")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ApiError::bad_request("Missing 'userId' in item data"))?;

                let user_uuid = Uuid::parse_str(user_id)
                    .map_err(|_| ApiError::bad_request("Invalid userId format"))?;

                let typ = item
                    .data
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("info");
                let title = item
                    .data
                    .get("title")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ApiError::bad_request("Missing 'title' in item data"))?;
                let message = item
                    .data
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let link = item.data.get("link").and_then(|v| v.as_str());
                let link_label = item.data.get("linkLabel").and_then(|v| v.as_str());

                let row = sqlx::query_as::<_, NotificationRow>(
                    r#"
                    INSERT INTO notifications (user_id, type, title, message, link, link_label)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    RETURNING id, user_id, type, title, message, link, link_label, read, created_at
                    "#,
                )
                .bind(user_uuid)
                .bind(typ)
                .bind(title)
                .bind(message)
                .bind(link)
                .bind(link_label)
                .fetch_one(&mut *tx)
                .await
                .map_err(ApiError::DatabaseError)?;

                Ok(notification_to_json(row))
            }

            (BatchOperation::Create, "tournaments") => {
                let name = item
                    .data
                    .get("name")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ApiError::bad_request("Missing 'name' in item data"))?;
                let game = item
                    .data
                    .get("game")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ApiError::bad_request("Missing 'game' in item data"))?;
                let max_participants = item
                    .data
                    .get("maxParticipants")
                    .and_then(|v| v.as_i64())
                    .ok_or_else(|| {
                        ApiError::bad_request("Missing 'maxParticipants' in item data")
                    })?;
                let entry_fee = item
                    .data
                    .get("entryFee")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let description = item.data.get("description").and_then(|v| v.as_str());
                let start_time = item
                    .data
                    .get("startTime")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ApiError::bad_request("Missing 'startTime' in item data"))?;
                let registration_deadline = item
                    .data
                    .get("registrationDeadline")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        ApiError::bad_request("Missing 'registrationDeadline' in item data")
                    })?;
                let created_by_str = item
                    .data
                    .get("createdBy")
                    .and_then(|v| v.as_str());
                let created_by = created_by_str
                    .map(|s| Uuid::parse_str(s))
                    .transpose()
                    .map_err(|_| ApiError::bad_request("Invalid 'createdBy' UUID format"))?;

                let row = sqlx::query_as::<_, TournamentRow>(
                    r#"
                    INSERT INTO tournaments (name, description, game, max_participants, entry_fee, start_time, registration_deadline, created_by)
                    VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8)
                    RETURNING id, name, description, game, max_participants, entry_fee, status, start_time, created_at
                    "#,
                )
                .bind(name)
                .bind(description)
                .bind(game)
                .bind(max_participants as i32)
                .bind(entry_fee)
                .bind(start_time)
                .bind(registration_deadline)
                .bind(created_by)
                .fetch_one(&mut *tx)
                .await
                .map_err(ApiError::DatabaseError)?;

                Ok(tournament_to_json(row))
            }

            (BatchOperation::Create, "users") => {
                let phone = item
                    .data
                    .get("phoneNumber")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        ApiError::bad_request("Missing 'phoneNumber' in item data")
                    })?;
                let username = item
                    .data
                    .get("username")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ApiError::bad_request("Missing 'username' in item data"))?;
                let email = item.data.get("email").and_then(|v| v.as_str());
                let display_name = item.data.get("displayName").and_then(|v| v.as_str());

                let row = sqlx::query_as::<_, UserRow>(
                    r#"
                    INSERT INTO users (phone_number, username, email, display_name)
                    VALUES ($1, $2, $3, $4)
                    RETURNING id, phone_number, username, email, display_name, is_verified, created_at
                    "#,
                )
                .bind(phone)
                .bind(username)
                .bind(email)
                .bind(display_name)
                .fetch_one(&mut *tx)
                .await
                .map_err(ApiError::DatabaseError)?;

                Ok(user_to_json(row))
            }

            (BatchOperation::Create, "wallets") => {
                let user_id = item
                    .data
                    .get("userId")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ApiError::bad_request("Missing 'userId' in item data"))?;
                let user_uuid = Uuid::parse_str(user_id)
                    .map_err(|_| ApiError::bad_request("Invalid userId format"))?;

                let currency = item
                    .data
                    .get("currency")
                    .and_then(|v| v.as_str())
                    .unwrap_or("NGN");

                let row = sqlx::query_as::<_, WalletRow>(
                    r#"
                    INSERT INTO wallets (user_id, currency)
                    VALUES ($1, $2)
                    RETURNING id, user_id, balance, currency, is_active, created_at
                    "#,
                )
                .bind(user_uuid)
                .bind(currency)
                .fetch_one(&mut *tx)
                .await
                .map_err(ApiError::DatabaseError)?;

                Ok(wallet_to_json(row))
            }

            // ── Updates ──────────────────────────────────────────────────────
            (BatchOperation::Update, "users") => {
                let id = item
                    .data
                    .get("id")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ApiError::bad_request("Missing 'id' in item data"))?;
                let uuid = Uuid::parse_str(id)
                    .map_err(|_| ApiError::bad_request("Invalid id UUID format"))?;

                let display_name = item.data.get("displayName").and_then(|v| v.as_str());
                let avatar_url = item.data.get("avatarUrl").and_then(|v| v.as_str());
                let bio = item.data.get("bio").and_then(|v| v.as_str());

                let row = sqlx::query_as::<_, UserRow>(
                    r#"
                    UPDATE users
                    SET display_name = COALESCE($2, display_name),
                        avatar_url   = COALESCE($3, avatar_url),
                        bio          = COALESCE($4, bio),
                        updated_at   = NOW()
                    WHERE id = $1
                    RETURNING id, phone_number, username, email, display_name, is_verified, created_at
                    "#,
                )
                .bind(uuid)
                .bind(display_name)
                .bind(avatar_url)
                .bind(bio)
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| match e {
                    sqlx::Error::RowNotFound => {
                        ApiError::not_found(format!("User {} not found", id))
                    }
                    other => ApiError::DatabaseError(other),
                })?;

                Ok(user_to_json(row))
            }

            (BatchOperation::Update, "notifications") => {
                let id = item
                    .data
                    .get("id")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ApiError::bad_request("Missing 'id' in item data"))?;
                let uuid = Uuid::parse_str(id)
                    .map_err(|_| ApiError::bad_request("Invalid id UUID format"))?;
                let read = item
                    .data
                    .get("read")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);

                let row = sqlx::query_as::<_, NotificationRow>(
                    r#"
                    UPDATE notifications
                    SET read = $2, updated_at = NOW()
                    WHERE id = $1
                    RETURNING id, user_id, type, title, message, link, link_label, read, created_at
                    "#,
                )
                .bind(uuid)
                .bind(read)
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| match e {
                    sqlx::Error::RowNotFound => {
                        ApiError::not_found(format!("Notification {} not found", id))
                    }
                    other => ApiError::DatabaseError(other),
                })?;

                Ok(notification_to_json(row))
            }

            (BatchOperation::Update, "tournaments") => {
                let id = item
                    .data
                    .get("id")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ApiError::bad_request("Missing 'id' in item data"))?;
                let uuid = Uuid::parse_str(id)
                    .map_err(|_| ApiError::bad_request("Invalid id UUID format"))?;

                let name = item.data.get("name").and_then(|v| v.as_str());
                let description = item.data.get("description").and_then(|v| v.as_str());

                let row = sqlx::query_as::<_, TournamentRow>(
                    r#"
                    UPDATE tournaments
                    SET name        = COALESCE($2, name),
                        description = COALESCE($3, description),
                        updated_at  = NOW()
                    WHERE id = $1
                    RETURNING id, name, description, game, max_participants, entry_fee, status, start_time, created_at
                    "#,
                )
                .bind(uuid)
                .bind(name)
                .bind(description)
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| match e {
                    sqlx::Error::RowNotFound => {
                        ApiError::not_found(format!("Tournament {} not found", id))
                    }
                    other => ApiError::DatabaseError(other),
                })?;

                Ok(tournament_to_json(row))
            }

            (BatchOperation::Update, "wallets") => {
                let id = item
                    .data
                    .get("id")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ApiError::bad_request("Missing 'id' in item data"))?;
                let uuid = Uuid::parse_str(id)
                    .map_err(|_| ApiError::bad_request("Invalid id UUID format"))?;
                let is_active = item
                    .data
                    .get("isActive")
                    .and_then(|v| v.as_bool());

                let row = sqlx::query_as::<_, WalletRow>(
                    r#"
                    UPDATE wallets
                    SET is_active  = COALESCE($2, is_active),
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING id, user_id, balance, currency, is_active, created_at
                    "#,
                )
                .bind(uuid)
                .bind(is_active)
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| match e {
                    sqlx::Error::RowNotFound => {
                        ApiError::not_found(format!("Wallet {} not found", id))
                    }
                    other => ApiError::DatabaseError(other),
                })?;

                Ok(wallet_to_json(row))
            }

            // ── Deletes ──────────────────────────────────────────────────────
            (BatchOperation::Delete, "users") => {
                let id = item
                    .data
                    .get("id")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ApiError::bad_request("Missing 'id' in item data"))?;
                let uuid = Uuid::parse_str(id)
                    .map_err(|_| ApiError::bad_request("Invalid id UUID format"))?;

                let result = sqlx::query("DELETE FROM users WHERE id = $1")
                    .bind(uuid)
                    .execute(&mut *tx)
                    .await
                    .map_err(ApiError::DatabaseError)?;

                if result.rows_affected() == 0 {
                    return Err(ApiError::not_found(format!("User {} not found", id)));
                }

                Ok(serde_json::json!({ "id": id }))
            }

            (BatchOperation::Delete, "notifications") => {
                let id = item
                    .data
                    .get("id")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ApiError::bad_request("Missing 'id' in item data"))?;
                let uuid = Uuid::parse_str(id)
                    .map_err(|_| ApiError::bad_request("Invalid id UUID format"))?;

                let result = sqlx::query("DELETE FROM notifications WHERE id = $1")
                    .bind(uuid)
                    .execute(&mut *tx)
                    .await
                    .map_err(ApiError::DatabaseError)?;

                if result.rows_affected() == 0 {
                    return Err(ApiError::not_found(format!(
                        "Notification {} not found",
                        id
                    )));
                }

                Ok(serde_json::json!({ "id": id }))
            }

            (BatchOperation::Delete, "tournaments") => {
                let id = item
                    .data
                    .get("id")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ApiError::bad_request("Missing 'id' in item data"))?;
                let uuid = Uuid::parse_str(id)
                    .map_err(|_| ApiError::bad_request("Invalid id UUID format"))?;

                let result = sqlx::query("DELETE FROM tournaments WHERE id = $1")
                    .bind(uuid)
                    .execute(&mut *tx)
                    .await
                    .map_err(ApiError::DatabaseError)?;

                if result.rows_affected() == 0 {
                    return Err(ApiError::not_found(format!(
                        "Tournament {} not found",
                        id
                    )));
                }

                Ok(serde_json::json!({ "id": id }))
            }

            (BatchOperation::Delete, "wallets") => {
                let id = item
                    .data
                    .get("id")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ApiError::bad_request("Missing 'id' in item data"))?;
                let uuid = Uuid::parse_str(id)
                    .map_err(|_| ApiError::bad_request("Invalid id UUID format"))?;

                let result = sqlx::query("DELETE FROM wallets WHERE id = $1")
                    .bind(uuid)
                    .execute(&mut *tx)
                    .await
                    .map_err(ApiError::DatabaseError)?;

                if result.rows_affected() == 0 {
                    return Err(ApiError::not_found(format!("Wallet {} not found", id)));
                }

                Ok(serde_json::json!({ "id": id }))
            }

            _ => Err(ApiError::bad_request(format!(
                "Unsupported combination: {:?} on '{}'",
                operation, entity
            ))),
        }
    }
}

// ─── Internal row types (mirrors the tables we query) ────────────────────────

#[derive(Debug, sqlx::FromRow)]
struct NotificationRow {
    id: Uuid,
    user_id: Uuid,
    #[sqlx(rename = "type")]
    typ: String,
    title: String,
    message: String,
    link: Option<String>,
    link_label: Option<String>,
    read: bool,
    created_at: chrono::DateTime<Utc>,
}

fn notification_to_json(row: NotificationRow) -> serde_json::Value {
    serde_json::json!({
        "id": row.id.to_string(),
        "type": row.typ,
        "title": row.title,
        "message": row.message,
        "link": row.link,
        "linkLabel": row.link_label,
        "read": row.read,
        "createdAt": row.created_at.to_rfc3339(),
    })
}

#[derive(Debug, sqlx::FromRow)]
struct TournamentRow {
    id: Uuid,
    name: String,
    description: Option<String>,
    game: String,
    max_participants: i32,
    entry_fee: Option<i64>,
    status: Option<i32>,
    start_time: chrono::DateTime<Utc>,
    created_at: chrono::DateTime<Utc>,
}

fn tournament_to_json(row: TournamentRow) -> serde_json::Value {
    serde_json::json!({
        "id": row.id.to_string(),
        "name": row.name,
        "description": row.description,
        "game": row.game,
        "maxParticipants": row.max_participants,
        "entryFee": row.entry_fee,
        "status": row.status,
        "startTime": row.start_time.to_rfc3339(),
        "createdAt": row.created_at.to_rfc3339(),
    })
}

#[derive(Debug, sqlx::FromRow)]
struct UserRow {
    id: Uuid,
    phone_number: String,
    username: String,
    email: Option<String>,
    display_name: Option<String>,
    is_verified: bool,
    created_at: chrono::DateTime<Utc>,
}

fn user_to_json(row: UserRow) -> serde_json::Value {
    serde_json::json!({
        "id": row.id.to_string(),
        "phoneNumber": row.phone_number,
        "username": row.username,
        "email": row.email,
        "displayName": row.display_name,
        "isVerified": row.is_verified,
        "createdAt": row.created_at.to_rfc3339(),
    })
}

#[derive(Debug, sqlx::FromRow)]
struct WalletRow {
    id: Uuid,
    user_id: Uuid,
    balance: rust_decimal::Decimal,
    currency: String,
    is_active: bool,
    created_at: chrono::DateTime<Utc>,
}

fn wallet_to_json(row: WalletRow) -> serde_json::Value {
    serde_json::json!({
        "id": row.id.to_string(),
        "userId": row.user_id.to_string(),
        "balance": row.balance.to_string(),
        "currency": row.currency,
        "isActive": row.is_active,
        "createdAt": row.created_at.to_rfc3339(),
    })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_batch_request_validation_empty_items() {
        let req = BatchRequest {
            operation: BatchOperation::Create,
            entity: "users".to_string(),
            items: vec![],
            semantics: BatchSemantics::default(),
        };
        let err = req.validate().unwrap_err();
        assert!(err.contains("at least one item"));
    }

    #[test]
    fn test_batch_request_validation_too_many_items() {
        let items: Vec<BatchItem> = (0..=MAX_BATCH_ITEMS)
            .map(|_| BatchItem {
                client_id: Uuid::new_v4(),
                data: serde_json::json!({}),
            })
            .collect();
        let req = BatchRequest {
            operation: BatchOperation::Create,
            entity: "users".to_string(),
            items,
            semantics: BatchSemantics::default(),
        };
        let err = req.validate().unwrap_err();
        assert!(err.contains("maximum allowed"));
    }

    #[test]
    fn test_batch_request_validation_unsupported_entity() {
        let req = BatchRequest {
            operation: BatchOperation::Create,
            entity: "galaxies".to_string(),
            items: vec![BatchItem {
                client_id: Uuid::new_v4(),
                data: serde_json::json!({}),
            }],
            semantics: BatchSemantics::default(),
        };
        let err = req.validate().unwrap_err();
        assert!(err.contains("Unsupported entity"));
    }

    #[test]
    fn test_batch_request_validation_empty_entity() {
        let req = BatchRequest {
            operation: BatchOperation::Create,
            entity: "".to_string(),
            items: vec![BatchItem {
                client_id: Uuid::new_v4(),
                data: serde_json::json!({}),
            }],
            semantics: BatchSemantics::default(),
        };
        let err = req.validate().unwrap_err();
        assert!(err.contains("Entity type is required"));
    }

    #[test]
    fn test_batch_request_valid() {
        let req = BatchRequest {
            operation: BatchOperation::Create,
            entity: "users".to_string(),
            items: vec![BatchItem {
                client_id: Uuid::new_v4(),
                data: serde_json::json!({ "phoneNumber": "+1234567890", "username": "alice" }),
            }],
            semantics: BatchSemantics::default(),
        };
        assert!(req.validate().is_ok());
    }

    #[test]
    fn test_batch_semantics_default_is_atomic() {
        assert_eq!(BatchSemantics::default(), BatchSemantics::Atomic);
    }

    #[test]
    fn test_progress_store_lifecycle() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let store = BatchProgressStore::new();
            let id = Uuid::new_v4();

            assert!(store.get_status(id).await.is_none());

            store.set_status(id, BatchStatus::Completed).await;
            assert_eq!(store.get_status(id).await, Some(BatchStatus::Completed));

            store.remove(id).await;
            assert!(store.get_status(id).await.is_none());
        });
    }
}
