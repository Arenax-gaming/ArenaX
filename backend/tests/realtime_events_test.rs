use arenax_backend::realtime::events::*;
use uuid::Uuid;

#[test]
fn test_balance_update_serialization_roundtrip() {
    let event = RealtimeEvent::BalanceUpdate {
        user_id: Uuid::new_v4(),
        balance_ngn: 5000,
        balance_arenax_tokens: 200,
        balance_xlm: 100,
        timestamp: "2026-03-26T12:00:00Z".to_string(),
    };

    let json = serde_json::to_string(&event).unwrap();
    let deserialized: RealtimeEvent = serde_json::from_str(&json).unwrap();
    assert_eq!(event, deserialized);

    // Verify the tag
    let value: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(value["type"], "balance_update");
}

#[test]
fn test_match_found_serialization() {
    let event = RealtimeEvent::MatchFound {
        match_id: Uuid::new_v4(),
        opponent_id: Uuid::new_v4(),
        opponent_name: "Player2".to_string(),
        game_mode: "ranked".to_string(),
        timestamp: "2026-03-26T12:00:00Z".to_string(),
    };

    let json = serde_json::to_string(&event).unwrap();
    let deserialized: RealtimeEvent = serde_json::from_str(&json).unwrap();
    assert_eq!(event, deserialized);

    let value: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(value["type"], "match_found");
}

#[test]
fn test_match_status_change_serialization() {
    let event = RealtimeEvent::MatchStatusChange {
        match_id: Uuid::new_v4(),
        from_status: "pending".to_string(),
        to_status: "in_progress".to_string(),
        timestamp: "2026-03-26T12:00:00Z".to_string(),
    };

    let json = serde_json::to_string(&event).unwrap();
    let deserialized: RealtimeEvent = serde_json::from_str(&json).unwrap();
    assert_eq!(event, deserialized);

    let value: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(value["type"], "match_status_change");
}

#[test]
fn test_notification_serialization() {
    let event = RealtimeEvent::Notification {
        id: Uuid::new_v4(),
        title: "Welcome".to_string(),
        body: "Welcome to ArenaX!".to_string(),
        category: "system".to_string(),
        timestamp: "2026-03-26T12:00:00Z".to_string(),
    };

    let json = serde_json::to_string(&event).unwrap();
    let deserialized: RealtimeEvent = serde_json::from_str(&json).unwrap();
    assert_eq!(event, deserialized);

    let value: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(value["type"], "notification");
}

#[test]
fn test_ws_envelope_serialization() {
    let envelope = WsEnvelope {
        event: RealtimeEvent::Notification {
            id: Uuid::new_v4(),
            title: "Test".to_string(),
            body: "Test body".to_string(),
            category: "info".to_string(),
            timestamp: "2026-03-26T12:00:00Z".to_string(),
        },
    };

    let json = serde_json::to_string(&envelope).unwrap();
    let deserialized: WsEnvelope = serde_json::from_str(&json).unwrap();
    assert_eq!(envelope, deserialized);
}

#[test]
fn test_all_event_types_serializable_roundtrip() {
    let user_id = Uuid::new_v4();
    let match_id = Uuid::new_v4();

    let events = vec![
        RealtimeEvent::BalanceUpdate {
            user_id,
            balance_ngn: 1000,
            balance_arenax_tokens: 50,
            balance_xlm: 25,
            timestamp: "2026-03-26T12:00:00Z".to_string(),
        },
        RealtimeEvent::MatchFound {
            match_id,
            opponent_id: Uuid::new_v4(),
            opponent_name: "Opponent".to_string(),
            game_mode: "casual".to_string(),
            timestamp: "2026-03-26T12:01:00Z".to_string(),
        },
        RealtimeEvent::MatchStatusChange {
            match_id,
            from_status: "pending".to_string(),
            to_status: "active".to_string(),
            timestamp: "2026-03-26T12:02:00Z".to_string(),
        },
        RealtimeEvent::Notification {
            id: Uuid::new_v4(),
            title: "Alert".to_string(),
            body: "Something happened".to_string(),
            category: "alert".to_string(),
            timestamp: "2026-03-26T12:03:00Z".to_string(),
        },
        RealtimeEvent::MatchCompleted {
            match_id,
            winner_id: user_id,
            elo_change: 25,
            timestamp: "2026-03-26T12:04:00Z".to_string(),
        },
        RealtimeEvent::MatchDisputed {
            match_id,
            reason: "Suspected cheating".to_string(),
            timestamp: "2026-03-26T12:05:00Z".to_string(),
        },
    ];

    for event in events {
        let json = serde_json::to_string(&event).unwrap();
        let deserialized: RealtimeEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(event, deserialized);
    }
}

#[test]
fn test_channel_functions() {
    let user_id = Uuid::new_v4();
    let match_id = Uuid::new_v4();

    let user_ch = channels::user_channel(user_id);
    assert_eq!(user_ch, format!("user:{}", user_id));

    let match_ch = channels::match_channel(match_id);
    assert_eq!(match_ch, format!("match:{}", match_id));

    assert_eq!(channels::USER_CHANNEL_PATTERN, "user:*");
    assert_eq!(channels::MATCH_CHANNEL_PATTERN, "match:*");
}
