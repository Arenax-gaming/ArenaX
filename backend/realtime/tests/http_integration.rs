//! Compile and exercise the actual backend route and mutation helper, independent
//! of the dev branch's unrelated service/model compilation problems.
use actix_web::{body::MessageBody, http::StatusCode, test, web, App};
use arenax_tournament_realtime::{Limits, TournamentHub, TournamentUpdate, UpdateKind};
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::{future::poll_fn, pin::Pin, time::Duration};
use uuid::Uuid;

mod db {
    pub type DbPool = sqlx::PgPool;
}
#[path = "../../src/http/tournament_events.rs"]
mod tournament_events;
#[path = "../../src/realtime/tournament_mutations.rs"]
mod tournament_mutations;

async fn pool() -> PgPool {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&std::env::var("DATABASE_TEST_URL").expect("Use a dedicated test PostgreSQL"))
        .await
        .unwrap();
    // One connection keeps these temporary tables isolated from other tests and
    // the database's persistent schema. They disappear when the pool closes.
    sqlx::query(
        "CREATE TEMP TABLE tournaments (
            id UUID PRIMARY KEY, visibility TEXT NOT NULL, prize_pool NUMERIC NOT NULL DEFAULT 0,
            prize_pool_currency TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "CREATE TEMP TABLE prize_pools (
            tournament_id UUID PRIMARY KEY, total_amount NUMERIC NOT NULL,
            currency TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool
}

#[actix_web::test]
#[ignore = "requires dedicated Redis and PostgreSQL; see README"]
async fn public_route_streams_redis_updates_and_rejects_private_missing_and_over_limit_requests() {
    let pool = pool().await;
    let public = Uuid::new_v4();
    let private = Uuid::new_v4();
    sqlx::query("INSERT INTO tournaments (id, visibility) VALUES ($1, 'public'), ($2, 'private')")
        .bind(public)
        .bind(private)
        .execute(&pool)
        .await
        .unwrap();
    let hub = TournamentHub::connect(
        &std::env::var("REDIS_TEST_URL").expect("Use a dedicated test Redis"),
        Limits {
            max_clients: 1,
            ..Limits::default()
        },
    )
    .await
    .unwrap();
    let app = test::init_service(
        App::new()
            .app_data(web::Data::new(pool.clone()))
            .app_data(web::Data::new(hub.clone()))
            .route(
                "/api/tournaments/{id}/events",
                web::get().to(tournament_events::tournament_events),
            ),
    )
    .await;
    for (id, expected) in [
        (private, StatusCode::NOT_FOUND),
        (Uuid::new_v4(), StatusCode::NOT_FOUND),
    ] {
        let response = test::call_service(
            &app,
            test::TestRequest::get()
                .uri(&format!("/api/tournaments/{id}/events"))
                .to_request(),
        )
        .await;
        assert_eq!(response.status(), expected);
    }
    let response = test::call_service(
        &app,
        test::TestRequest::get()
            .uri(&format!("/api/tournaments/{public}/events"))
            .to_request(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let mut body = Box::pin(response.into_body());
    let first = poll_fn(|cx| Pin::as_mut(&mut body).poll_next(cx))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first, "event: resync\ndata: {}\n\n");
    let excess = test::call_service(
        &app,
        test::TestRequest::get()
            .uri(&format!("/api/tournaments/{public}/events"))
            .to_request(),
    )
    .await;
    assert_eq!(excess.status(), StatusCode::TOO_MANY_REQUESTS);
    hub.publish(&TournamentUpdate::new(
        public,
        UpdateKind::MatchResult,
        serde_json::json!({"match_id": Uuid::new_v4(), "score": 3}),
    ))
    .await
    .unwrap();
    let frame = tokio::time::timeout(
        Duration::from_secs(5),
        poll_fn(|cx| Pin::as_mut(&mut body).poll_next(cx)),
    )
    .await
    .unwrap()
    .unwrap()
    .unwrap();
    assert!(std::str::from_utf8(&frame)
        .unwrap()
        .contains("\"kind\":\"match_result\""));
    drop(body);
    assert_eq!(hub.active_clients(), 0);
    assert_eq!(hub.active_tournaments(), 0);
    let malformed = test::call_service(
        &app,
        test::TestRequest::get()
            .uri("/api/tournaments/not-a-uuid/events")
            .to_request(),
    )
    .await;
    assert_eq!(malformed.status(), StatusCode::NOT_FOUND);
    drop(app);
    pool.close().await;
}

#[tokio::test]
#[ignore = "requires dedicated PostgreSQL; see README"]
async fn prize_pool_increment_updates_the_snapshot_and_rolls_back_if_it_cannot() {
    let pool = pool().await;
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO tournaments (id, visibility, prize_pool) VALUES ($1, 'public', 100)")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO prize_pools (tournament_id, total_amount, currency) VALUES ($1, 100, 'NGN')",
    )
    .bind(id)
    .execute(&pool)
    .await
    .unwrap();
    let (amount, currency) = tournament_mutations::add_to_prize_pool(&pool, id, 25)
        .await
        .unwrap();
    assert_eq!(amount, "125");
    assert_eq!(currency, "NGN");
    let current: (String, String) = sqlx::query_as(
        "SELECT prize_pool::text, prize_pool_currency FROM tournaments WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(current, (amount, currency));
    sqlx::query("DELETE FROM tournaments WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        tournament_mutations::add_to_prize_pool(&pool, id, 25).await,
        Err(sqlx::Error::RowNotFound)
    ));
    let remaining: String =
        sqlx::query_scalar("SELECT total_amount::text FROM prize_pools WHERE tournament_id = $1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(remaining, "125");
    pool.close().await;
}
