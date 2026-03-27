use arenax_backend::realtime::events::*;
use uuid::Uuid;

#[test]
fn test_event_pipeline_serialization_roundtrip() {
    // Simulate what EventBus does: serialize event to JSON
    let user_id = Uuid::new_v4();
    let event = RealtimeEvent::BalanceUpdate {
        user_id,
        balance_ngn: 100000,
        balance_arenax_tokens: 500,
        balance_xlm: 1000000,
        timestamp: "2026-03-26T12:00:00Z".to_string(),
    };

    // EventBus serializes
    let payload = serde_json::to_string(&event).unwrap();

    // WsBroadcaster deserializes
    let received: RealtimeEvent = serde_json::from_str(&payload).unwrap();

    // UserWebSocket wraps in envelope and sends
    let envelope = WsEnvelope { event: received };
    let ws_payload = serde_json::to_string(&envelope).unwrap();

    // Client receives and can parse
    let parsed: serde_json::Value = serde_json::from_str(&ws_payload).unwrap();
    assert_eq!(parsed["event"]["type"], "balance_update");
    assert_eq!(parsed["event"]["user_id"], user_id.to_string());
    assert_eq!(parsed["event"]["balance_ngn"], 100000);
}

#[test]
fn test_channel_naming() {
    let user_id = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
    let match_id = Uuid::parse_str("660e8400-e29b-41d4-a716-446655440000").unwrap();

    assert_eq!(
        channels::user_channel(user_id),
        "user:550e8400-e29b-41d4-a716-446655440000"
    );
    assert_eq!(
        channels::match_channel(match_id),
        "match:660e8400-e29b-41d4-a716-446655440000"
    );
}

#[test]
fn test_all_event_types_serializable() {
    let events = vec![
        RealtimeEvent::BalanceUpdate {
            user_id: Uuid::new_v4(),
            balance_ngn: 0,
            balance_arenax_tokens: 0,
            balance_xlm: 0,
            timestamp: "2026-01-01T00:00:00Z".to_string(),
        },
        RealtimeEvent::MatchFound {
            match_id: Uuid::new_v4(),
            opponent_id: Uuid::new_v4(),
            opponent_name: "TestPlayer".to_string(),
            game_mode: "casual".to_string(),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
        },
        RealtimeEvent::MatchStatusChange {
            match_id: Uuid::new_v4(),
            from_status: "CREATED".to_string(),
            to_status: "STARTED".to_string(),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
        },
        RealtimeEvent::Notification {
            id: Uuid::new_v4(),
            title: "Test".to_string(),
            body: "Body".to_string(),
            category: "system".to_string(),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
        },
        RealtimeEvent::MatchCompleted {
            match_id: Uuid::new_v4(),
            winner_id: Uuid::new_v4(),
            elo_change: 25,
            timestamp: "2026-01-01T00:00:00Z".to_string(),
        },
        RealtimeEvent::MatchDisputed {
            match_id: Uuid::new_v4(),
            reason: "Cheating".to_string(),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
        },
    ];

    for event in events {
        let json = serde_json::to_string(&event).unwrap();
        let _roundtrip: RealtimeEvent = serde_json::from_str(&json).unwrap();
    }
}

#[test]
fn test_session_registry_with_event_routing_simulation() {
    use arenax_backend::realtime::session_registry::SessionRegistry;

    let registry = SessionRegistry::new();
    let user_a = Uuid::new_v4();
    let user_b = Uuid::new_v4();
    let session_a1 = Uuid::new_v4();
    let session_a2 = Uuid::new_v4();
    let session_b1 = Uuid::new_v4();

    registry.register(user_a, session_a1);
    registry.register(user_a, session_a2);
    registry.register(user_b, session_b1);

    // Simulate routing: event for user_a should find 2 sessions
    let sessions_a = registry.get_sessions(&user_a);
    assert_eq!(sessions_a.len(), 2);

    // Event for user_b should find 1 session
    let sessions_b = registry.get_sessions(&user_b);
    assert_eq!(sessions_b.len(), 1);

    // Unknown user should find 0 sessions
    let unknown = Uuid::new_v4();
    assert!(registry.get_sessions(&unknown).is_empty());

    // Disconnect one of user_a's sessions
    registry.unregister(user_a, session_a1);
    assert_eq!(registry.get_sessions(&user_a).len(), 1);
}
