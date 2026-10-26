use actix_web::body::MessageBody;
use arenax_tournament_realtime::{
    sse_response, tournament_channel, Delivery, HubError, Limits, Subscription, TournamentHub,
    TournamentUpdate, UpdateKind,
};
use std::{future::poll_fn, pin::Pin, time::Duration};
use uuid::Uuid;

fn redis_url() -> String {
    std::env::var("REDIS_TEST_URL").expect("Set REDIS_TEST_URL to a dedicated test Redis")
}

async fn hub(limits: Limits) -> TournamentHub {
    TournamentHub::connect(&redis_url(), limits).await.unwrap()
}

async fn next(subscription: &mut Subscription) -> Delivery {
    tokio::time::timeout(Duration::from_secs(5), subscription.recv())
        .await
        .expect("event delivery timed out")
        .expect("subscription closed")
}

async fn initial(subscription: &mut Subscription) {
    assert!(matches!(next(subscription).await, Delivery::Resync));
}

#[tokio::test]
#[ignore = "requires a dedicated Redis; see README"]
async fn redis_fans_out_all_change_types_across_instances_without_cross_tournament_leaks() {
    let publisher = hub(Limits::default()).await;
    let other_instance = hub(Limits::default()).await;
    let first_id = Uuid::new_v4();
    let second_id = Uuid::new_v4();
    let mut local = publisher.subscribe(first_id).unwrap();
    let mut remote = other_instance.subscribe(first_id).unwrap();
    let mut unrelated = other_instance.subscribe(second_id).unwrap();
    initial(&mut local).await;
    initial(&mut remote).await;
    initial(&mut unrelated).await;

    for kind in [
        UpdateKind::Created,
        UpdateKind::StatusChanged,
        UpdateKind::MatchResult,
        UpdateKind::PrizePoolChanged,
        UpdateKind::ParticipantsChanged,
        UpdateKind::BracketChanged,
    ] {
        let event =
            TournamentUpdate::new(first_id, kind.clone(), serde_json::json!({"revision": 1}));
        publisher.publish(&event).await.unwrap();
        for viewer in [&mut local, &mut remote] {
            let Delivery::Update(payload) = next(viewer).await else {
                panic!("expected tournament update");
            };
            let received: TournamentUpdate = serde_json::from_str(&payload).unwrap();
            assert_eq!(received.tournament_id, first_id);
            assert_eq!(received.kind, kind);
        }
    }
    assert!(
        tokio::time::timeout(Duration::from_millis(100), unrelated.recv())
            .await
            .is_err()
    );
}

#[tokio::test]
#[ignore = "requires a dedicated Redis; see README"]
async fn connection_limits_and_dropped_viewers_release_all_slots_and_empty_rooms() {
    let hub = hub(Limits {
        max_clients: 3,
        max_clients_per_tournament: 2,
        buffer_capacity: 4,
    })
    .await;
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    let a = hub.subscribe(first).unwrap();
    let b = hub.subscribe(first).unwrap();
    assert!(matches!(hub.subscribe(first), Err(HubError::Capacity)));
    let c = hub.subscribe(second).unwrap();
    assert!(matches!(
        hub.subscribe(Uuid::new_v4()),
        Err(HubError::Capacity)
    ));
    assert_eq!(hub.active_clients(), 3);
    assert_eq!(hub.active_tournaments(), 2);
    drop(a);
    drop(b);
    assert_eq!(hub.active_clients(), 1);
    assert_eq!(hub.active_tournaments(), 1);
    let replacement = hub.subscribe(first).unwrap();
    drop(c);
    drop(replacement);
    assert_eq!(hub.active_clients(), 0);
    assert_eq!(hub.active_tournaments(), 0);
}

#[tokio::test]
#[ignore = "requires a dedicated Redis; see README"]
async fn slow_clients_resync_and_invalid_messages_do_not_reach_viewers() {
    let hub = hub(Limits {
        buffer_capacity: 2,
        ..Limits::default()
    })
    .await;
    let id = Uuid::new_v4();
    let mut viewer = hub.subscribe(id).unwrap();
    initial(&mut viewer).await;
    let client = redis::Client::open(redis_url()).unwrap();
    let mut connection = client.get_multiplexed_async_connection().await.unwrap();
    let wrong_event = TournamentUpdate::new(
        Uuid::new_v4(),
        UpdateKind::StatusChanged,
        serde_json::json!({"wrong": true}),
    );
    for payload in [
        "not json".to_owned(),
        serde_json::to_string(&wrong_event).unwrap(),
    ] {
        let _: usize = redis::cmd("PUBLISH")
            .arg(tournament_channel(id))
            .arg(payload)
            .query_async(&mut connection)
            .await
            .unwrap();
    }
    let valid = TournamentUpdate::new(
        id,
        UpdateKind::PrizePoolChanged,
        serde_json::json!({"amount": 42}),
    );
    hub.publish(&valid).await.unwrap();
    let Delivery::Update(payload) = next(&mut viewer).await else {
        panic!("expected only the valid event");
    };
    assert_eq!(
        serde_json::from_str::<TournamentUpdate>(&payload)
            .unwrap()
            .data["amount"],
        42
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(50), viewer.recv())
            .await
            .is_err()
    );

    for revision in 0..40 {
        hub.publish(&TournamentUpdate::new(
            id,
            UpdateKind::StatusChanged,
            serde_json::json!({"revision": revision}),
        ))
        .await
        .unwrap();
    }
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(matches!(next(&mut viewer).await, Delivery::Resync));
    assert!(matches!(next(&mut viewer).await, Delivery::Update(_)));
    let oversized = TournamentUpdate::new(
        id,
        UpdateKind::StatusChanged,
        serde_json::json!({"body": "x".repeat(70_000)}),
    );
    assert!(matches!(
        hub.publish(&oversized).await,
        Err(HubError::MessageTooLarge)
    ));
}

#[tokio::test]
#[ignore = "requires a dedicated Redis; see README"]
async fn redis_disconnect_reconnect_notifies_existing_viewers_to_refetch() {
    let hub = hub(Limits::default()).await;
    let id = Uuid::new_v4();
    let mut viewer = hub.subscribe(id).unwrap();
    initial(&mut viewer).await;
    let client = redis::Client::open(redis_url()).unwrap();
    let mut connection = client.get_multiplexed_async_connection().await.unwrap();
    let killed: usize = redis::cmd("CLIENT")
        .arg("KILL")
        .arg("TYPE")
        .arg("pubsub")
        .query_async(&mut connection)
        .await
        .unwrap();
    assert!(killed >= 1);
    tokio::time::timeout(Duration::from_secs(5), async {
        while hub.is_ready() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    assert!(matches!(hub.subscribe(id), Err(HubError::Unavailable)));
    assert!(matches!(next(&mut viewer).await, Delivery::Resync));
    tokio::time::timeout(Duration::from_secs(5), async {
        while !hub.is_ready() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    assert!(matches!(next(&mut viewer).await, Delivery::Resync));
    hub.publish(&TournamentUpdate::new(
        id,
        UpdateKind::MatchResult,
        serde_json::json!({"winner": "verified"}),
    ))
    .await
    .unwrap();
    assert!(matches!(next(&mut viewer).await, Delivery::Update(_)));
}

#[tokio::test]
#[ignore = "requires a dedicated Redis; see README"]
async fn sse_body_delivers_initial_resync_then_real_updates_and_cleans_up_on_disconnect() {
    let hub = hub(Limits::default()).await;
    let id = Uuid::new_v4();
    let response = sse_response(hub.subscribe(id).unwrap());
    assert_eq!(
        response
            .headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap(),
        "text/event-stream"
    );
    assert_eq!(
        response
            .headers()
            .get("x-accel-buffering")
            .unwrap()
            .to_str()
            .unwrap(),
        "no"
    );
    let mut body = Box::pin(response.into_body());
    let first = poll_fn(|cx| Pin::as_mut(&mut body).poll_next(cx))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first, "event: resync\ndata: {}\n\n");
    hub.publish(&TournamentUpdate::new(
        id,
        UpdateKind::PrizePoolChanged,
        serde_json::json!({"amount": 123}),
    ))
    .await
    .unwrap();
    let update = tokio::time::timeout(
        Duration::from_secs(5),
        poll_fn(|cx| Pin::as_mut(&mut body).poll_next(cx)),
    )
    .await
    .unwrap()
    .unwrap()
    .unwrap();
    let text = std::str::from_utf8(&update).unwrap();
    assert!(text.starts_with("event: tournament_update\ndata: "));
    assert!(text.contains("\"amount\":123"));
    drop(body);
    assert_eq!(hub.active_clients(), 0);
    assert_eq!(hub.active_tournaments(), 0);
}
