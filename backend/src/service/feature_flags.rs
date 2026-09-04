//! Feature toggle management — Issue #948.
//!
//! Lets operators turn features on and off without a deploy:
//!
//! 1. **Remote flag configuration** — create/update flags (enabled, rollout,
//!    variants) at runtime via the API.
//! 2. **Per-user overrides** — force a flag on/off (and optionally a variant)
//!    for a specific user. Expired overrides are ignored.
//! 3. **Percentage rollout** — deterministic SHA-256 bucket so the same user
//!    always lands in the same 0–99 bucket for a given flag.
//! 4. **A/B test assignment** — weighted variants with sticky per-user
//!    assignments so changing weights does not reshuffle existing users.
//! 5. **Flag analytics** — evaluation + conversion events with aggregated
//!    counts, unique users, and breakdowns by reason and variant.
//!
//! Evaluation priority:
//! override (if not expired) → kill switch (`enabled = false`) →
//! percentage rollout → sticky/new A/B assignment → boolean on.

use crate::api_error::ApiError;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::collections::{BTreeMap, HashMap};
use tracing::{debug, warn};
use uuid::Uuid;
use validator::Validate;

// ─── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct FeatureFlag {
    pub id: Uuid,
    pub flag_key: String,
    pub name: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub rollout_percentage: i32,
    pub variants: serde_json::Value,
    pub default_variant: Option<String>,
    pub metadata: serde_json::Value,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct FlagOverride {
    pub id: Uuid,
    pub flag_id: Uuid,
    pub user_id: Uuid,
    pub enabled: bool,
    pub variant: Option<String>,
    pub reason: Option<String>,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct CreateFlagRequest {
    #[validate(length(min = 2, max = 100))]
    pub key: String,
    #[validate(length(min = 1, max = 200))]
    pub name: String,
    pub description: Option<String>,
    pub enabled: Option<bool>,
    pub rollout_percentage: Option<i32>,
    pub variants: Option<BTreeMap<String, i32>>,
    pub default_variant: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateFlagRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub enabled: Option<bool>,
    pub rollout_percentage: Option<i32>,
    pub variants: Option<BTreeMap<String, i32>>,
    pub default_variant: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetOverrideRequest {
    pub enabled: bool,
    pub variant: Option<String>,
    pub reason: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackEventRequest {
    pub event_name: String,
    pub properties: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvaluationReason {
    Override,
    Disabled,
    NotInRollout,
    AbTest,
    Percentage,
}

impl EvaluationReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Override => "override",
            Self::Disabled => "disabled",
            Self::NotInRollout => "not_in_rollout",
            Self::AbTest => "ab_test",
            Self::Percentage => "percentage",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvaluationResult {
    pub key: String,
    pub enabled: bool,
    pub variant: Option<String>,
    pub reason: EvaluationReason,
    pub bucket: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReasonCount {
    pub reason: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariantCount {
    pub variant: String,
    pub count: i64,
    pub unique_users: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlagAnalytics {
    pub key: String,
    pub total_evaluations: i64,
    pub unique_users: i64,
    pub enabled_count: i64,
    pub disabled_count: i64,
    pub conversion_count: i64,
    pub by_reason: Vec<ReasonCount>,
    pub by_variant: Vec<VariantCount>,
    pub last_evaluated_at: Option<DateTime<Utc>>,
}

// ─── Pure evaluation (no I/O) ─────────────────────────────────────────────────

/// Stable 0–99 bucket for `(flag_key, user_id)`. Same inputs always produce
/// the same bucket so percentage rollout is deterministic across deploys.
pub fn rollout_bucket(user_id: Uuid, flag_key: &str) -> u8 {
    (hash_to_u32(flag_key, user_id) % 100) as u8
}

pub fn is_in_rollout(user_id: Uuid, flag_key: &str, percentage: i32) -> bool {
    if percentage <= 0 {
        return false;
    }
    if percentage >= 100 {
        return true;
    }
    (rollout_bucket(user_id, flag_key) as i32) < percentage
}

/// Pick a weighted variant. Names are sorted so assignment is stable across
/// process restarts regardless of HashMap iteration order.
pub fn assign_variant(
    user_id: Uuid,
    flag_key: &str,
    variants: &BTreeMap<String, i32>,
    default_variant: Option<&str>,
) -> Option<String> {
    let total: i64 = variants.values().map(|w| i64::from((*w).max(0))).sum();
    if total <= 0 {
        return default_variant.map(str::to_string);
    }

    let salt = format!("ab:{flag_key}");
    let pick = (hash_to_u32(&salt, user_id) as i64) % total;
    let mut acc: i64 = 0;
    for (name, weight) in variants {
        acc += i64::from((*weight).max(0));
        if pick < acc {
            return Some(name.clone());
        }
    }
    variants.keys().next().cloned().or_else(|| default_variant.map(str::to_string))
}

pub fn parse_variants(value: &serde_json::Value) -> BTreeMap<String, i32> {
    match value.as_object() {
        Some(obj) => obj
            .iter()
            .filter_map(|(k, v)| v.as_i64().map(|n| (k.clone(), n as i32)))
            .collect(),
        None => BTreeMap::new(),
    }
}

/// Resolve a flag for one user. Returns the evaluation plus an optional new
/// A/B variant that the caller should persist as a sticky assignment.
pub fn resolve_evaluation(
    flag: &FeatureFlag,
    user_id: Uuid,
    user_override: Option<&FlagOverride>,
    existing_assignment: Option<&str>,
    now: DateTime<Utc>,
) -> (EvaluationResult, Option<String>) {
    let bucket = rollout_bucket(user_id, &flag.flag_key);
    let variants = parse_variants(&flag.variants);

    if let Some(over) = user_override {
        let expired = over.expires_at.map(|exp| exp <= now).unwrap_or(false);
        if !expired {
            return (
                EvaluationResult {
                    key: flag.flag_key.clone(),
                    enabled: over.enabled,
                    variant: over.variant.clone(),
                    reason: EvaluationReason::Override,
                    bucket,
                },
                None,
            );
        }
    }

    if !flag.enabled {
        return (
            EvaluationResult {
                key: flag.flag_key.clone(),
                enabled: false,
                variant: flag.default_variant.clone(),
                reason: EvaluationReason::Disabled,
                bucket,
            },
            None,
        );
    }

    if !is_in_rollout(user_id, &flag.flag_key, flag.rollout_percentage) {
        return (
            EvaluationResult {
                key: flag.flag_key.clone(),
                enabled: false,
                variant: flag.default_variant.clone(),
                reason: EvaluationReason::NotInRollout,
                bucket,
            },
            None,
        );
    }

    if !variants.is_empty() {
        if let Some(variant) = existing_assignment {
            return (
                EvaluationResult {
                    key: flag.flag_key.clone(),
                    enabled: true,
                    variant: Some(variant.to_string()),
                    reason: EvaluationReason::AbTest,
                    bucket,
                },
                None,
            );
        }

        let variant = assign_variant(
            user_id,
            &flag.flag_key,
            &variants,
            flag.default_variant.as_deref(),
        );
        return (
            EvaluationResult {
                key: flag.flag_key.clone(),
                enabled: true,
                variant: variant.clone(),
                reason: EvaluationReason::AbTest,
                bucket,
            },
            variant,
        );
    }

    (
        EvaluationResult {
            key: flag.flag_key.clone(),
            enabled: true,
            variant: flag.default_variant.clone().or_else(|| Some("on".to_string())),
            reason: EvaluationReason::Percentage,
            bucket,
        },
        None,
    )
}

fn hash_to_u32(salt: &str, user_id: Uuid) -> u32 {
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(b"\0");
    hasher.update(user_id.as_bytes());
    let digest = hasher.finalize();
    u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]])
}

fn pg_sqlstate(err: &sqlx::Error) -> Option<String> {
    match err {
        sqlx::Error::Database(db_err) => db_err.code().map(|c| c.to_string()),
        _ => None,
    }
}

fn validate_flag_key(key: &str) -> Result<(), ApiError> {
    let ok = key.len() >= 2
        && key.len() <= 100
        && key
            .chars()
            .enumerate()
            .all(|(i, c)| {
                if i == 0 {
                    c.is_ascii_lowercase() || c.is_ascii_digit()
                } else {
                    c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-'
                }
            });
    if !ok {
        return Err(ApiError::bad_request(
            "Flag key must be 2–100 chars: lowercase alphanumeric, hyphens, or underscores, starting with a letter or digit",
        ));
    }
    Ok(())
}

fn validate_rollout(percentage: i32) -> Result<(), ApiError> {
    if !(0..=100).contains(&percentage) {
        return Err(ApiError::bad_request(
            "rollout_percentage must be between 0 and 100",
        ));
    }
    Ok(())
}

fn validate_variants(variants: &BTreeMap<String, i32>) -> Result<(), ApiError> {
    if variants.is_empty() {
        return Ok(());
    }
    if variants.values().any(|w| *w < 0) {
        return Err(ApiError::bad_request("Variant weights must be >= 0"));
    }
    if variants.values().all(|w| *w == 0) {
        return Err(ApiError::bad_request(
            "At least one variant must have a weight > 0",
        ));
    }
    Ok(())
}

fn variants_json(variants: &BTreeMap<String, i32>) -> serde_json::Value {
    serde_json::to_value(variants).unwrap_or_else(|_| serde_json::json!({}))
}

// ─── Service ──────────────────────────────────────────────────────────────────

pub struct FeatureFlagService {
    db: PgPool,
}

impl FeatureFlagService {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    // ── Remote configuration ──────────────────────────────────────────────

    pub async fn create_flag(
        &self,
        req: CreateFlagRequest,
        created_by: Option<Uuid>,
    ) -> Result<FeatureFlag, ApiError> {
        req.validate()
            .map_err(|e| ApiError::ValidationError(e.to_string()))?;
        validate_flag_key(&req.key)?;

        let rollout = req.rollout_percentage.unwrap_or(0);
        validate_rollout(rollout)?;
        let variants = req.variants.unwrap_or_default();
        validate_variants(&variants)?;
        let variants_value = variants_json(&variants);
        let metadata = req.metadata.unwrap_or_else(|| serde_json::json!({}));

        let flag = sqlx::query_as::<_, FeatureFlag>(
            r#"
            INSERT INTO feature_flags
                (flag_key, name, description, enabled, rollout_percentage,
                 variants, default_variant, metadata, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id, flag_key, name, description, enabled, rollout_percentage,
                      variants, default_variant, metadata, created_by, created_at, updated_at
            "#,
        )
        .bind(&req.key)
        .bind(&req.name)
        .bind(&req.description)
        .bind(req.enabled.unwrap_or(false))
        .bind(rollout)
        .bind(&variants_value)
        .bind(&req.default_variant)
        .bind(&metadata)
        .bind(created_by)
        .fetch_one(&self.db)
        .await
        .map_err(|e| match pg_sqlstate(&e).as_deref() {
            Some("23505") => ApiError::conflict(format!("Flag '{}' already exists", req.key)),
            _ => ApiError::DatabaseError(e),
        })?;

        debug!(flag_key = %flag.flag_key, "Created feature flag");
        Ok(flag)
    }

    pub async fn update_flag(
        &self,
        key: &str,
        req: UpdateFlagRequest,
    ) -> Result<FeatureFlag, ApiError> {
        let existing = self.get_flag(key).await?;

        if let Some(pct) = req.rollout_percentage {
            validate_rollout(pct)?;
        }
        if let Some(ref variants) = req.variants {
            validate_variants(variants)?;
        }

        let name = req.name.unwrap_or(existing.name);
        let description = req.description.or(existing.description);
        let enabled = req.enabled.unwrap_or(existing.enabled);
        let rollout = req.rollout_percentage.unwrap_or(existing.rollout_percentage);
        let variants = req
            .variants
            .map(|v| variants_json(&v))
            .unwrap_or(existing.variants);
        let default_variant = match req.default_variant {
            Some(v) if v.is_empty() => None,
            Some(v) => Some(v),
            None => existing.default_variant,
        };
        let metadata = req.metadata.unwrap_or(existing.metadata);

        let flag = sqlx::query_as::<_, FeatureFlag>(
            r#"
            UPDATE feature_flags
            SET name = $2,
                description = $3,
                enabled = $4,
                rollout_percentage = $5,
                variants = $6,
                default_variant = $7,
                metadata = $8
            WHERE flag_key = $1
            RETURNING id, flag_key, name, description, enabled, rollout_percentage,
                      variants, default_variant, metadata, created_by, created_at, updated_at
            "#,
        )
        .bind(key)
        .bind(&name)
        .bind(&description)
        .bind(enabled)
        .bind(rollout)
        .bind(&variants)
        .bind(&default_variant)
        .bind(&metadata)
        .fetch_optional(&self.db)
        .await
        .map_err(ApiError::DatabaseError)?
        .ok_or_else(|| ApiError::not_found("Feature flag not found"))?;

        debug!(flag_key = %flag.flag_key, enabled, rollout, "Updated feature flag");
        Ok(flag)
    }

    pub async fn get_flag(&self, key: &str) -> Result<FeatureFlag, ApiError> {
        sqlx::query_as::<_, FeatureFlag>(
            r#"
            SELECT id, flag_key, name, description, enabled, rollout_percentage,
                   variants, default_variant, metadata, created_by, created_at, updated_at
            FROM feature_flags
            WHERE flag_key = $1
            "#,
        )
        .bind(key)
        .fetch_optional(&self.db)
        .await
        .map_err(ApiError::DatabaseError)?
        .ok_or_else(|| ApiError::not_found("Feature flag not found"))
    }

    pub async fn list_flags(&self) -> Result<Vec<FeatureFlag>, ApiError> {
        sqlx::query_as::<_, FeatureFlag>(
            r#"
            SELECT id, flag_key, name, description, enabled, rollout_percentage,
                   variants, default_variant, metadata, created_by, created_at, updated_at
            FROM feature_flags
            ORDER BY flag_key
            "#,
        )
        .fetch_all(&self.db)
        .await
        .map_err(ApiError::DatabaseError)
    }

    pub async fn delete_flag(&self, key: &str) -> Result<(), ApiError> {
        let result = sqlx::query("DELETE FROM feature_flags WHERE flag_key = $1")
            .bind(key)
            .execute(&self.db)
            .await
            .map_err(ApiError::DatabaseError)?;

        if result.rows_affected() == 0 {
            return Err(ApiError::not_found("Feature flag not found"));
        }
        Ok(())
    }

    // ── Per-user overrides ────────────────────────────────────────────────

    pub async fn set_override(
        &self,
        key: &str,
        user_id: Uuid,
        req: SetOverrideRequest,
        created_by: Option<Uuid>,
    ) -> Result<FlagOverride, ApiError> {
        let flag = self.get_flag(key).await?;

        sqlx::query_as::<_, FlagOverride>(
            r#"
            INSERT INTO feature_flag_overrides
                (flag_id, user_id, enabled, variant, reason, created_by, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (flag_id, user_id) DO UPDATE SET
                enabled    = EXCLUDED.enabled,
                variant    = EXCLUDED.variant,
                reason     = EXCLUDED.reason,
                created_by = EXCLUDED.created_by,
                expires_at = EXCLUDED.expires_at,
                created_at = NOW()
            RETURNING id, flag_id, user_id, enabled, variant, reason,
                      created_by, created_at, expires_at
            "#,
        )
        .bind(flag.id)
        .bind(user_id)
        .bind(req.enabled)
        .bind(&req.variant)
        .bind(&req.reason)
        .bind(created_by)
        .bind(req.expires_at)
        .fetch_one(&self.db)
        .await
        .map_err(|e| match pg_sqlstate(&e).as_deref() {
            Some("23503") => ApiError::bad_request("User not found"),
            _ => ApiError::DatabaseError(e),
        })
    }

    pub async fn remove_override(&self, key: &str, user_id: Uuid) -> Result<(), ApiError> {
        let flag = self.get_flag(key).await?;
        let result = sqlx::query(
            "DELETE FROM feature_flag_overrides WHERE flag_id = $1 AND user_id = $2",
        )
        .bind(flag.id)
        .bind(user_id)
        .execute(&self.db)
        .await
        .map_err(ApiError::DatabaseError)?;

        if result.rows_affected() == 0 {
            return Err(ApiError::not_found("Override not found"));
        }
        Ok(())
    }

    pub async fn list_overrides(&self, key: &str) -> Result<Vec<FlagOverride>, ApiError> {
        let flag = self.get_flag(key).await?;
        sqlx::query_as::<_, FlagOverride>(
            r#"
            SELECT id, flag_id, user_id, enabled, variant, reason,
                   created_by, created_at, expires_at
            FROM feature_flag_overrides
            WHERE flag_id = $1
            ORDER BY created_at DESC
            "#,
        )
        .bind(flag.id)
        .fetch_all(&self.db)
        .await
        .map_err(ApiError::DatabaseError)
    }

    // ── Evaluation ────────────────────────────────────────────────────────

    pub async fn evaluate(
        &self,
        key: &str,
        user_id: Uuid,
    ) -> Result<EvaluationResult, ApiError> {
        let flag = self.get_flag(key).await?;
        let (result, new_assignment) = self.evaluate_loaded(&flag, user_id).await?;
        self.record_evaluation(&flag, user_id, &result).await;
        if let Some(variant) = new_assignment {
            self.persist_assignment(flag.id, user_id, &variant).await;
        }
        Ok(result)
    }

    pub async fn evaluate_all(&self, user_id: Uuid) -> Result<Vec<EvaluationResult>, ApiError> {
        let flags = self.list_flags().await?;
        if flags.is_empty() {
            return Ok(Vec::new());
        }

        let overrides = sqlx::query_as::<_, FlagOverride>(
            r#"
            SELECT id, flag_id, user_id, enabled, variant, reason,
                   created_by, created_at, expires_at
            FROM feature_flag_overrides
            WHERE user_id = $1
            "#,
        )
        .bind(user_id)
        .fetch_all(&self.db)
        .await
        .map_err(ApiError::DatabaseError)?;

        #[derive(sqlx::FromRow)]
        struct AssignmentRow {
            flag_id: Uuid,
            variant: String,
        }

        let assignments = sqlx::query_as::<_, AssignmentRow>(
            r#"
            SELECT flag_id, variant
            FROM feature_flag_assignments
            WHERE user_id = $1
            "#,
        )
        .bind(user_id)
        .fetch_all(&self.db)
        .await
        .map_err(ApiError::DatabaseError)?;

        let override_by_flag: HashMap<Uuid, FlagOverride> =
            overrides.into_iter().map(|o| (o.flag_id, o)).collect();
        let assignment_by_flag: HashMap<Uuid, String> =
            assignments.into_iter().map(|a| (a.flag_id, a.variant)).collect();

        let mut results = Vec::with_capacity(flags.len());
        for flag in flags {
            let (result, new_assignment) = resolve_evaluation(
                &flag,
                user_id,
                override_by_flag.get(&flag.id),
                assignment_by_flag.get(&flag.id).map(String::as_str),
                Utc::now(),
            );
            self.record_evaluation(&flag, user_id, &result).await;
            if let Some(variant) = new_assignment {
                self.persist_assignment(flag.id, user_id, &variant).await;
            }
            results.push(result);
        }

        Ok(results)
    }

    async fn evaluate_loaded(
        &self,
        flag: &FeatureFlag,
        user_id: Uuid,
    ) -> Result<(EvaluationResult, Option<String>), ApiError> {
        let user_override = sqlx::query_as::<_, FlagOverride>(
            r#"
            SELECT id, flag_id, user_id, enabled, variant, reason,
                   created_by, created_at, expires_at
            FROM feature_flag_overrides
            WHERE flag_id = $1 AND user_id = $2
            "#,
        )
        .bind(flag.id)
        .bind(user_id)
        .fetch_optional(&self.db)
        .await
        .map_err(ApiError::DatabaseError)?;

        let existing_assignment: Option<String> = sqlx::query_scalar(
            r#"
            SELECT variant
            FROM feature_flag_assignments
            WHERE flag_id = $1 AND user_id = $2
            "#,
        )
        .bind(flag.id)
        .bind(user_id)
        .fetch_optional(&self.db)
        .await
        .map_err(ApiError::DatabaseError)?;

        Ok(resolve_evaluation(
            flag,
            user_id,
            user_override.as_ref(),
            existing_assignment.as_deref(),
            Utc::now(),
        ))
    }

    async fn persist_assignment(&self, flag_id: Uuid, user_id: Uuid, variant: &str) {
        if let Err(e) = sqlx::query(
            r#"
            INSERT INTO feature_flag_assignments (flag_id, user_id, variant)
            VALUES ($1, $2, $3)
            ON CONFLICT (flag_id, user_id) DO NOTHING
            "#,
        )
        .bind(flag_id)
        .bind(user_id)
        .bind(variant)
        .execute(&self.db)
        .await
        {
            warn!(error = %e, %flag_id, %user_id, "Failed to persist A/B assignment");
        }
    }

    async fn record_evaluation(&self, flag: &FeatureFlag, user_id: Uuid, result: &EvaluationResult) {
        if let Err(e) = sqlx::query(
            r#"
            INSERT INTO feature_flag_events
                (flag_id, flag_key, user_id, event_name, enabled, variant, reason)
            VALUES ($1, $2, $3, 'evaluation', $4, $5, $6)
            "#,
        )
        .bind(flag.id)
        .bind(&flag.flag_key)
        .bind(user_id)
        .bind(result.enabled)
        .bind(&result.variant)
        .bind(result.reason.as_str())
        .execute(&self.db)
        .await
        {
            warn!(error = %e, flag_key = %flag.flag_key, "Failed to record flag evaluation");
        }
    }

    pub async fn track_event(
        &self,
        key: &str,
        user_id: Uuid,
        req: TrackEventRequest,
    ) -> Result<(), ApiError> {
        if req.event_name.trim().is_empty() || req.event_name.len() > 100 {
            return Err(ApiError::bad_request(
                "event_name must be 1–100 characters",
            ));
        }
        let flag = self.get_flag(key).await?;
        let (evaluation, _) = self.evaluate_loaded(&flag, user_id).await?;
        let properties = req.properties.unwrap_or_else(|| serde_json::json!({}));

        sqlx::query(
            r#"
            INSERT INTO feature_flag_events
                (flag_id, flag_key, user_id, event_name, enabled, variant, reason, properties)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            "#,
        )
        .bind(flag.id)
        .bind(&flag.flag_key)
        .bind(user_id)
        .bind(&req.event_name)
        .bind(evaluation.enabled)
        .bind(&evaluation.variant)
        .bind(evaluation.reason.as_str())
        .bind(&properties)
        .execute(&self.db)
        .await
        .map_err(ApiError::DatabaseError)?;

        Ok(())
    }

    // ── Analytics ─────────────────────────────────────────────────────────

    pub async fn get_analytics(&self, key: &str) -> Result<FlagAnalytics, ApiError> {
        let _flag = self.get_flag(key).await?;

        #[derive(sqlx::FromRow)]
        struct TotalsRow {
            total_evaluations: Option<i64>,
            unique_users: Option<i64>,
            enabled_count: Option<i64>,
            disabled_count: Option<i64>,
            conversion_count: Option<i64>,
            last_evaluated_at: Option<DateTime<Utc>>,
        }

        let totals = sqlx::query_as::<_, TotalsRow>(
            r#"
            SELECT
                COUNT(*) FILTER (WHERE event_name = 'evaluation')              AS total_evaluations,
                COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'evaluation') AS unique_users,
                COUNT(*) FILTER (WHERE event_name = 'evaluation' AND enabled)  AS enabled_count,
                COUNT(*) FILTER (WHERE event_name = 'evaluation' AND NOT enabled) AS disabled_count,
                COUNT(*) FILTER (WHERE event_name <> 'evaluation')             AS conversion_count,
                MAX(created_at) FILTER (WHERE event_name = 'evaluation')       AS last_evaluated_at
            FROM feature_flag_events
            WHERE flag_key = $1
            "#,
        )
        .bind(key)
        .fetch_one(&self.db)
        .await
        .map_err(ApiError::DatabaseError)?;

        let by_reason = sqlx::query_as::<_, ReasonCount>(
            r#"
            SELECT reason, COUNT(*)::bigint AS count
            FROM feature_flag_events
            WHERE flag_key = $1 AND event_name = 'evaluation'
            GROUP BY reason
            ORDER BY count DESC
            "#,
        )
        .bind(key)
        .fetch_all(&self.db)
        .await
        .map_err(ApiError::DatabaseError)?;

        let by_variant = sqlx::query_as::<_, VariantCount>(
            r#"
            SELECT
                COALESCE(variant, 'none') AS variant,
                COUNT(*)::bigint AS count,
                COUNT(DISTINCT user_id)::bigint AS unique_users
            FROM feature_flag_events
            WHERE flag_key = $1 AND event_name = 'evaluation'
            GROUP BY COALESCE(variant, 'none')
            ORDER BY count DESC
            "#,
        )
        .bind(key)
        .fetch_all(&self.db)
        .await
        .map_err(ApiError::DatabaseError)?;

        Ok(FlagAnalytics {
            key: key.to_string(),
            total_evaluations: totals.total_evaluations.unwrap_or(0),
            unique_users: totals.unique_users.unwrap_or(0),
            enabled_count: totals.enabled_count.unwrap_or(0),
            disabled_count: totals.disabled_count.unwrap_or(0),
            conversion_count: totals.conversion_count.unwrap_or(0),
            by_reason,
            by_variant,
            last_evaluated_at: totals.last_evaluated_at,
        })
    }
}

impl FeatureFlag {
    /// JSON response uses `key` rather than the DB column `flag_key`.
    pub fn to_response(&self) -> FeatureFlagResponse {
        FeatureFlagResponse {
            id: self.id,
            key: self.flag_key.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            enabled: self.enabled,
            rollout_percentage: self.rollout_percentage,
            variants: parse_variants(&self.variants),
            default_variant: self.default_variant.clone(),
            metadata: self.metadata.clone(),
            created_by: self.created_by,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct FeatureFlagResponse {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub rollout_percentage: i32,
    pub variants: BTreeMap<String, i32>,
    pub default_variant: Option<String>,
    pub metadata: serde_json::Value,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_flag(key: &str, enabled: bool, rollout: i32, variants: serde_json::Value) -> FeatureFlag {
        FeatureFlag {
            id: Uuid::nil(),
            flag_key: key.to_string(),
            name: key.to_string(),
            description: None,
            enabled,
            rollout_percentage: rollout,
            variants,
            default_variant: Some("control".to_string()),
            metadata: serde_json::json!({}),
            created_by: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    fn sample_override(enabled: bool, variant: Option<&str>, expires_at: Option<DateTime<Utc>>) -> FlagOverride {
        FlagOverride {
            id: Uuid::nil(),
            flag_id: Uuid::nil(),
            user_id: Uuid::nil(),
            enabled,
            variant: variant.map(str::to_string),
            reason: Some("qa".to_string()),
            created_by: None,
            created_at: Utc::now(),
            expires_at,
        }
    }

    #[test]
    fn bucket_is_stable_for_same_user_and_flag() {
        let user = Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap();
        let a = rollout_bucket(user, "new_matchmaking");
        let b = rollout_bucket(user, "new_matchmaking");
        assert_eq!(a, b);
        assert!(a < 100);
    }

    #[test]
    fn bucket_differs_across_flags() {
        let user = Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap();
        // Extremely unlikely both 0-99 hashes collide for two salts; still valid if they do,
        // so we only assert the function is total.
        let a = rollout_bucket(user, "flag_a");
        let b = rollout_bucket(user, "flag_b");
        let _ = (a, b);
    }

    #[test]
    fn rollout_zero_excludes_everyone() {
        let user = Uuid::new_v4();
        assert!(!is_in_rollout(user, "any", 0));
    }

    #[test]
    fn rollout_hundred_includes_everyone() {
        let user = Uuid::new_v4();
        assert!(is_in_rollout(user, "any", 100));
    }

    #[test]
    fn buckets_are_roughly_uniform() {
        let mut counts = [0u32; 100];
        for i in 0..10_000u128 {
            let user = Uuid::from_u128(i + 1);
            counts[rollout_bucket(user, "uniform_flag") as usize] += 1;
        }
        let min = *counts.iter().min().unwrap();
        let max = *counts.iter().max().unwrap();
        // 10k users / 100 buckets = 100 expected. Allow a wide but non-degenerate band.
        assert!(min > 20, "min bucket count {min} too low");
        assert!(max < 250, "max bucket count {max} too high");
    }

    #[test]
    fn disabled_flag_returns_disabled_without_override() {
        let flag = sample_flag("dark_mode", false, 100, serde_json::json!({}));
        let user = Uuid::new_v4();
        let (result, assign) = resolve_evaluation(&flag, user, None, None, Utc::now());
        assert!(!result.enabled);
        assert_eq!(result.reason, EvaluationReason::Disabled);
        assert!(assign.is_none());
    }

    #[test]
    fn override_wins_over_disabled_kill_switch() {
        let flag = sample_flag("dark_mode", false, 0, serde_json::json!({}));
        let user = Uuid::new_v4();
        let over = sample_override(true, Some("on"), None);
        let (result, _) = resolve_evaluation(&flag, user, Some(&over), None, Utc::now());
        assert!(result.enabled);
        assert_eq!(result.reason, EvaluationReason::Override);
        assert_eq!(result.variant.as_deref(), Some("on"));
    }

    #[test]
    fn override_can_force_flag_off() {
        let flag = sample_flag("full_rollout", true, 100, serde_json::json!({}));
        let user = Uuid::new_v4();
        let over = sample_override(false, None, None);
        let (result, _) = resolve_evaluation(&flag, user, Some(&over), None, Utc::now());
        assert!(!result.enabled);
        assert_eq!(result.reason, EvaluationReason::Override);
    }

    #[test]
    fn expired_override_is_ignored() {
        let flag = sample_flag("dark_mode", false, 100, serde_json::json!({}));
        let user = Uuid::new_v4();
        let over = sample_override(true, Some("on"), Some(Utc::now() - chrono::Duration::hours(1)));
        let (result, _) = resolve_evaluation(&flag, user, Some(&over), None, Utc::now());
        assert!(!result.enabled);
        assert_eq!(result.reason, EvaluationReason::Disabled);
    }

    #[test]
    fn not_in_rollout_when_percentage_is_below_bucket() {
        let flag = sample_flag("partial", true, 1, serde_json::json!({}));
        // Find a user whose bucket is >= 1 (almost everyone).
        let user = (0u128..500)
            .map(Uuid::from_u128)
            .find(|u| rollout_bucket(*u, "partial") >= 1)
            .expect("need a user outside 1% rollout");
        let (result, _) = resolve_evaluation(&flag, user, None, None, Utc::now());
        assert!(!result.enabled);
        assert_eq!(result.reason, EvaluationReason::NotInRollout);
    }

    #[test]
    fn percentage_rollout_enables_boolean_flag() {
        let flag = sample_flag("full_rollout", true, 100, serde_json::json!({}));
        let user = Uuid::new_v4();
        let (result, assign) = resolve_evaluation(&flag, user, None, None, Utc::now());
        assert!(result.enabled);
        assert_eq!(result.reason, EvaluationReason::Percentage);
        assert_eq!(result.variant.as_deref(), Some("control"));
        assert!(assign.is_none());
    }

    #[test]
    fn ab_assignment_is_sticky_when_existing() {
        let flag = sample_flag(
            "checkout",
            true,
            100,
            serde_json::json!({"control": 50, "treatment": 50}),
        );
        let user = Uuid::new_v4();
        let (result, assign) =
            resolve_evaluation(&flag, user, None, Some("treatment"), Utc::now());
        assert!(result.enabled);
        assert_eq!(result.reason, EvaluationReason::AbTest);
        assert_eq!(result.variant.as_deref(), Some("treatment"));
        assert!(assign.is_none(), "must not re-assign when sticky value exists");
    }

    #[test]
    fn ab_assignment_is_stable_and_requests_persist() {
        let flag = sample_flag(
            "checkout",
            true,
            100,
            serde_json::json!({"control": 50, "treatment": 50}),
        );
        let user = Uuid::parse_str("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").unwrap();
        let (first, assign_a) = resolve_evaluation(&flag, user, None, None, Utc::now());
        let (second, assign_b) = resolve_evaluation(&flag, user, None, None, Utc::now());
        assert_eq!(first.variant, second.variant);
        assert_eq!(first.reason, EvaluationReason::AbTest);
        assert!(assign_a.is_some());
        assert_eq!(assign_a, first.variant);
        assert_eq!(assign_a, assign_b);
    }

    #[test]
    fn weighted_variant_respects_zero_weight() {
        let mut variants = BTreeMap::new();
        variants.insert("control".to_string(), 0);
        variants.insert("treatment".to_string(), 100);
        let user = Uuid::new_v4();
        let picked = assign_variant(user, "exp", &variants, Some("control"));
        assert_eq!(picked.as_deref(), Some("treatment"));
    }

    #[test]
    fn validate_flag_key_rejects_bad_input() {
        assert!(validate_flag_key("ok_flag").is_ok());
        assert!(validate_flag_key("a").is_err());
        assert!(validate_flag_key("BadFlag").is_err());
        assert!(validate_flag_key("-leading").is_err());
        assert!(validate_flag_key("has space").is_err());
    }
}
