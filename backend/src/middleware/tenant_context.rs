//! Per-request tenant (tournament) context for row-level security (#1108).
//!
//! The RLS policies added in migration `20260829000005` key off two
//! Postgres session GUCs: `app.tournament_id` and `app.is_superadmin`. This
//! module resolves those two values once per request (from the route's
//! `tournament_id` path segment and the caller's JWT claims) and exposes
//! them as a `TenantContext` request extension — mirroring how
//! `AuthMiddleware` already attaches `Claims`.
//!
//! Setting a Postgres session variable only affects *one* connection, but
//! this backend hands out a fresh pooled connection per query
//! (`web::Data<PgPool>` + `.fetch_one(&pool)`), so a global middleware can't
//! set it once and have every later ad hoc query on the request inherit it.
//! `with_tenant_scope` is the actual enforcement point: it acquires a single
//! connection, sets both GUCs on it, and runs the caller's queries on that
//! same connection — so every handler that touches tenant-scoped tables
//! (`tournaments`, `tournament_participants`, `matches`, `match_disputes`)
//! needs to route those specific queries through it. Applying that to every
//! existing call site across the codebase is a larger follow-up than this
//! change; the handler wired up here (`tournament_handler::get_participants`)
//! demonstrates the real, working pattern end to end.

use crate::api_error::ApiError;
use crate::auth::jwt_service::Claims;
use actix_web::{
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    Error, HttpMessage,
};
use futures::future::LocalBoxFuture;
use sqlx::PgPool;
use std::future::{ready, Ready};
use uuid::Uuid;

#[derive(Debug, Clone, Default)]
pub struct TenantContext {
    /// None means "this request isn't scoped to a specific tournament" —
    /// `app_tenant_matches()` in the RLS policy treats that the same as a
    /// superadmin for read purposes only via the empty-string GUC value,
    /// so routes with no `{tournament_id}` segment are unaffected.
    pub tournament_id: Option<Uuid>,
    pub is_superadmin: bool,
}

/// Roles that bypass row-level security entirely (#1108) — platform admin
/// endpoints, not tournament organizers (who are scoped to their own
/// tournament like any other caller).
const SUPERADMIN_ROLES: &[&str] = &["admin", "super_admin", "platform_admin"];

fn is_superadmin(claims: Option<&Claims>) -> bool {
    claims
        .map(|c| c.roles.iter().any(|r| SUPERADMIN_ROLES.contains(&r.as_str())))
        .unwrap_or(false)
}

/// Actix middleware: resolves `TenantContext` from the route's
/// `tournament_id`/`id` path segment (when the scope is under
/// `/tournaments/{id}/...`) and the caller's claims, storing it as a
/// request extension for handlers to read.
pub struct TenantContextMiddleware;

impl<S, B> Transform<S, ServiceRequest> for TenantContextMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type InitError = ();
    type Transform = TenantContextMiddlewareService<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(TenantContextMiddlewareService { service }))
    }
}

pub struct TenantContextMiddlewareService<S> {
    service: S,
}

impl<S, B> Service<ServiceRequest> for TenantContextMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let tournament_id = req
            .match_info()
            .get("tournament_id")
            .or_else(|| req.match_info().get("id"))
            .and_then(|raw| Uuid::parse_str(raw).ok());
        let claims = req.extensions().get::<Claims>().cloned();

        req.extensions_mut().insert(TenantContext {
            tournament_id,
            is_superadmin: is_superadmin(claims.as_ref()),
        });

        let fut = self.service.call(req);
        Box::pin(fut)
    }
}

/// Acquires one pooled connection, sets `app.tournament_id`/`app.is_superadmin`
/// on its session, runs `f` on it, then releases it (#1108). Every query `f`
/// issues on this connection is subject to the RLS policies from migration
/// `20260829000005` for exactly this tenant.
pub async fn with_tenant_scope<F, Fut, T>(pool: &PgPool, ctx: &TenantContext, f: F) -> Result<T, ApiError>
where
    F: FnOnce(sqlx::pool::PoolConnection<sqlx::Postgres>) -> Fut,
    Fut: std::future::Future<Output = Result<T, ApiError>>,
{
    let mut conn = pool.acquire().await.map_err(ApiError::DatabaseError)?;

    sqlx::query("SELECT set_config('app.tournament_id', $1, false), set_config('app.is_superadmin', $2, false)")
        .bind(ctx.tournament_id.map(|id| id.to_string()).unwrap_or_default())
        .bind(if ctx.is_superadmin { "true" } else { "false" })
        .execute(&mut *conn)
        .await
        .map_err(ApiError::DatabaseError)?;

    f(conn).await
}

/// Requires a live Postgres (`TEST_DATABASE_URL`, same convention as
/// `service::idempotency_tests`); skips (rather than failing) when one isn't
/// reachable. Connects directly with plain `sqlx` — no app-layer code at
/// all — to prove the isolation is a database guarantee, not just something
/// the application happens to filter for.
#[cfg(test)]
mod rls_tests {
    use sqlx::PgPool;
    use uuid::Uuid;

    async fn connect_test_db() -> Option<PgPool> {
        let database_url = std::env::var("TEST_DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://test:test@localhost/arenax_test".to_string());
        sqlx::PgPool::connect(&database_url).await.ok()
    }

    async fn seed_user(db: &PgPool) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO users (id, phone_number, username) VALUES ($1, $2, $3)")
            .bind(id)
            .bind(format!("+1555{}", &id.simple().to_string()[..7]))
            .bind(format!("user_{}", id.simple()))
            .execute(db)
            .await
            .expect("seed user");
        id
    }

    async fn seed_tournament(db: &PgPool, created_by: Uuid) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO tournaments (id, name, game, max_participants, start_time, registration_deadline, created_by)
            VALUES ($1, $2, 'arena', 8, NOW() + INTERVAL '1 day', NOW() + INTERVAL '1 hour', $3)
            "#,
        )
        .bind(id)
        .bind(format!("RLS test tournament {id}"))
        .bind(created_by)
        .execute(db)
        .await
        .expect("seed tournament");
        id
    }

    #[tokio::test]
    async fn a_session_scoped_to_tournament_a_cannot_read_tournament_bs_participants() {
        let Some(db) = connect_test_db().await else {
            eprintln!("skipping: no TEST_DATABASE_URL reachable");
            return;
        };

        let organizer = seed_user(&db).await;
        let tournament_a = seed_tournament(&db, organizer).await;
        let tournament_b = seed_tournament(&db, organizer).await;

        let player_a = seed_user(&db).await;
        let player_b = seed_user(&db).await;

        // Superadmin session so these seed writes aren't themselves blocked
        // by the very policy under test.
        sqlx::query("SELECT set_config('app.is_superadmin', 'true', false)")
            .execute(&db)
            .await
            .ok();
        sqlx::query(
            "INSERT INTO tournament_participants (tournament_id, user_id) VALUES ($1, $2)",
        )
        .bind(tournament_a)
        .bind(player_a)
        .execute(&db)
        .await
        .expect("seed participant A");
        sqlx::query(
            "INSERT INTO tournament_participants (tournament_id, user_id) VALUES ($1, $2)",
        )
        .bind(tournament_b)
        .bind(player_b)
        .execute(&db)
        .await
        .expect("seed participant B");

        // A single dedicated connection, scoped to tournament A only — this
        // is exactly what `with_tenant_scope` sets up for a real request.
        let mut conn = db.acquire().await.expect("acquire connection");
        sqlx::query("SELECT set_config('app.tournament_id', $1, false), set_config('app.is_superadmin', 'false', false)")
            .bind(tournament_a.to_string())
            .execute(&mut *conn)
            .await
            .expect("set tenant context");

        let visible_tournament_ids: Vec<Uuid> = sqlx::query_scalar("SELECT tournament_id FROM tournament_participants")
            .fetch_all(&mut *conn)
            .await
            .expect("query participants");

        assert!(
            visible_tournament_ids.contains(&tournament_a),
            "tournament A's own participant must be visible"
        );
        assert!(
            !visible_tournament_ids.contains(&tournament_b),
            "tournament B's participant must NOT be visible to a session scoped to tournament A"
        );

        // Cleanup (as superadmin, so the RLS policy doesn't block the deletes).
        sqlx::query("SELECT set_config('app.is_superadmin', 'true', false)")
            .execute(&db)
            .await
            .ok();
        sqlx::query("DELETE FROM tournament_participants WHERE tournament_id IN ($1, $2)")
            .bind(tournament_a)
            .bind(tournament_b)
            .execute(&db)
            .await
            .ok();
        sqlx::query("DELETE FROM tournaments WHERE id IN ($1, $2)")
            .bind(tournament_a)
            .bind(tournament_b)
            .execute(&db)
            .await
            .ok();
        sqlx::query("DELETE FROM users WHERE id IN ($1, $2, $3)")
            .bind(organizer)
            .bind(player_a)
            .bind(player_b)
            .execute(&db)
            .await
            .ok();
    }

    #[tokio::test]
    async fn a_superadmin_session_sees_every_tournaments_participants() {
        let Some(db) = connect_test_db().await else {
            eprintln!("skipping: no TEST_DATABASE_URL reachable");
            return;
        };

        let organizer = seed_user(&db).await;
        let tournament_a = seed_tournament(&db, organizer).await;

        sqlx::query("SELECT set_config('app.is_superadmin', 'true', false)")
            .execute(&db)
            .await
            .ok();

        // A superadmin session with no tournament_id set at all must still
        // see rows across tournaments (#1108's "super-admin bypasses RLS").
        let mut conn = db.acquire().await.expect("acquire connection");
        sqlx::query("SELECT set_config('app.is_superadmin', 'true', false)")
            .execute(&mut *conn)
            .await
            .expect("set superadmin");

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tournaments WHERE id = $1")
            .bind(tournament_a)
            .fetch_one(&mut *conn)
            .await
            .expect("query tournaments as superadmin");
        assert_eq!(count, 1);

        sqlx::query("DELETE FROM tournaments WHERE id = $1").bind(tournament_a).execute(&db).await.ok();
        sqlx::query("DELETE FROM users WHERE id = $1").bind(organizer).execute(&db).await.ok();
    }
}
