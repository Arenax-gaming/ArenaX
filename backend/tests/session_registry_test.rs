use arenax_backend::realtime::session_registry::SessionRegistry;
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
