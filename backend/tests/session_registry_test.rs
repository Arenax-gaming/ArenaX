use arenax_backend::realtime::session_registry::{
    SessionRegistry, MAX_CONNECTIONS_PER_USER,
};
use uuid::Uuid;

#[test]
fn test_register_and_get_sessions() {
    let registry = SessionRegistry::new();
    let user_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();

    // Initially empty
    assert!(registry.get_sessions(&user_id).is_empty());

    // Register returns true for new session
    assert!(registry.register(user_id, session_id));

    // Duplicate returns false
    assert!(!registry.register(user_id, session_id));

    // Session is retrievable
    let sessions = registry.get_sessions(&user_id);
    assert_eq!(sessions.len(), 1);
    assert!(sessions.contains(&session_id));
}

#[test]
fn test_unregister_session() {
    let registry = SessionRegistry::new();
    let user_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();

    registry.register(user_id, session_id);
    registry.unregister(user_id, session_id);

    assert!(registry.get_sessions(&user_id).is_empty());
    assert!(!registry.has_user(&user_id));
}

#[test]
fn test_multiple_sessions_per_user() {
    let registry = SessionRegistry::new();
    let user_id = Uuid::new_v4();
    let session_a = Uuid::new_v4();
    let session_b = Uuid::new_v4();

    registry.register(user_id, session_a);
    registry.register(user_id, session_b);
    assert_eq!(registry.get_sessions(&user_id).len(), 2);

    // Remove one, the other remains
    registry.unregister(user_id, session_a);
    let sessions = registry.get_sessions(&user_id);
    assert_eq!(sessions.len(), 1);
    assert!(sessions.contains(&session_b));
}

#[test]
fn test_max_five_connections_per_user() {
    let registry = SessionRegistry::new();
    let user_id = Uuid::new_v4();

    // First 5 sessions succeed
    let mut session_ids = Vec::new();
    for _ in 0..MAX_CONNECTIONS_PER_USER {
        let sid = Uuid::new_v4();
        assert!(registry.register(user_id, sid));
        session_ids.push(sid);
    }

    assert_eq!(registry.get_sessions(&user_id).len(), 5);

    // 6th session is rejected
    let extra_session = Uuid::new_v4();
    assert!(!registry.register(user_id, extra_session));
    assert_eq!(registry.get_sessions(&user_id).len(), 5);

    // After unregistering 1 session, a new session can connect
    registry.unregister(user_id, session_ids[0]);
    assert_eq!(registry.get_sessions(&user_id).len(), 4);
    assert!(registry.register(user_id, extra_session));
    assert_eq!(registry.get_sessions(&user_id).len(), 5);
}

#[test]
fn test_user_count() {
    let registry = SessionRegistry::new();
    let user_a = Uuid::new_v4();
    let user_b = Uuid::new_v4();

    registry.register(user_a, Uuid::new_v4());
    registry.register(user_b, Uuid::new_v4());

    assert_eq!(registry.connected_user_count(), 2);
}

#[test]
fn test_has_user() {
    let registry = SessionRegistry::new();
    let user_id = Uuid::new_v4();

    assert!(!registry.has_user(&user_id));

    registry.register(user_id, Uuid::new_v4());
    assert!(registry.has_user(&user_id));
}

#[test]
fn test_heartbeat_and_stale_detection() {
    let registry = SessionRegistry::new();
    let user_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();

    registry.register(user_id, session_id);

    // Fresh session is not stale
    assert!(!registry.is_stale(&session_id));
    assert!(registry.get_stale_sessions().is_empty());

    // Record heartbeat
    registry.record_heartbeat(&session_id);
    assert!(!registry.is_stale(&session_id));

    // Unknown session is considered stale
    let unknown = Uuid::new_v4();
    assert!(registry.is_stale(&unknown));
}

#[test]
fn test_state_preservation_and_reconnect() {
    let registry = SessionRegistry::new();
    let user_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    let channel1 = "match:123".to_string();
    let channel2 = "user:456".to_string();

    // Register and subscribe
    registry.register(user_id, session_id);
    registry.subscribe(session_id, channel1.clone());
    registry.subscribe(session_id, channel2.clone());

    assert_eq!(registry.get_subscribers(&channel1).len(), 1);
    assert_eq!(registry.get_subscribers(&channel2).len(), 1);

    // Disconnect (unregisters and preserves state)
    registry.unregister(user_id, session_id);
    assert!(registry.get_sessions(&user_id).is_empty());
    assert!(registry.get_subscribers(&channel1).is_empty());
    assert!(registry.get_subscribers(&channel2).is_empty());
    assert_eq!(registry.preserved_session_count(), 1);

    // Reconnect with new session_id within window
    let new_session_id = Uuid::new_v4();
    let restored = registry.reconnect(user_id, session_id, new_session_id);
    assert!(restored.is_some());

    let channels = restored.unwrap();
    assert!(channels.contains(&channel1));
    assert!(channels.contains(&channel2));

    // Verify new session is active and subscribed
    let user_sessions = registry.get_sessions(&user_id);
    assert_eq!(user_sessions.len(), 1);
    assert!(user_sessions.contains(&new_session_id));
    assert_eq!(registry.get_subscribers(&channel1), vec![new_session_id]);
    assert_eq!(registry.get_subscribers(&channel2), vec![new_session_id]);

    // Verify metrics
    let metrics = registry.get_metrics();
    assert_eq!(metrics.reconnect_count, 1);
    assert_eq!(metrics.reconnect_failures, 0);
    assert_eq!(metrics.reconnect_expired, 0);
}

#[test]
fn test_reconnect_failures_and_metrics() {
    let registry = SessionRegistry::new();
    let user_a = Uuid::new_v4();
    let user_b = Uuid::new_v4();
    let session_id = Uuid::new_v4();

    // Register and unregister user_a
    registry.register(user_a, session_id);
    registry.subscribe(session_id, "room:1".to_string());
    registry.unregister(user_a, session_id);

    // Reconnect attempt from user_b (mismatched user) should fail
    let attempt_b = registry.reconnect(user_b, session_id, Uuid::new_v4());
    assert!(attempt_b.is_none());

    let metrics = registry.get_metrics();
    assert_eq!(metrics.reconnect_failures, 1);
    assert_eq!(metrics.reconnect_count, 0);

    // Reconnect attempt for non-existent session
    let attempt_nonexistent = registry.reconnect(user_a, Uuid::new_v4(), Uuid::new_v4());
    assert!(attempt_nonexistent.is_none());

    let metrics = registry.get_metrics();
    assert_eq!(metrics.reconnect_failures, 2);
}

#[test]
fn test_channel_subscriptions_lifecycle() {
    let registry = SessionRegistry::new();
    let user_id = Uuid::new_v4();
    let session_a = Uuid::new_v4();
    let session_b = Uuid::new_v4();
    let channel = "global_chat".to_string();

    registry.register(user_id, session_a);
    registry.register(user_id, session_b);

    registry.subscribe(session_a, channel.clone());
    registry.subscribe(session_b, channel.clone());

    let subscribers = registry.get_subscribers(&channel);
    assert_eq!(subscribers.len(), 2);
    assert!(subscribers.contains(&session_a));
    assert!(subscribers.contains(&session_b));

    // Unsubscribe session_a
    registry.unsubscribe(session_a, &channel);
    let subscribers = registry.get_subscribers(&channel);
    assert_eq!(subscribers.len(), 1);
    assert_eq!(subscribers[0], session_b);
}
