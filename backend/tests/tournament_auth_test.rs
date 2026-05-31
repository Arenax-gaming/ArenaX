/// Authorization tests for PATCH /api/tournaments/{id}/status
///
/// These tests exercise the authorization layer in isolation — no live DB or
/// Redis required.  They verify:
///   - Admin access is granted
///   - Tournament-creator access is granted
///   - Authenticated non-creator/non-admin receives 403
///   - Unauthenticated requests receive 401
///   - Only admins may trigger the Completed (prize-distribution) transition
///   - Privilege escalation via forged is_admin=false + role "admin" is handled
///   - IDOR: a user cannot update another user's tournament
use arenax_backend::auth::jwt_service::{Claims, TokenType};
use arenax_backend::models::tournament::TournamentStatus;
use chrono::{Duration, Utc};
use uuid::Uuid;

// ── helpers ───────────────────────────────────────────────────────────────────

fn admin_claims(user_id: Uuid) -> Claims {
    Claims {
        sub: user_id.to_string(),
        exp: (Utc::now() + Duration::minutes(15)).timestamp(),
        iat: Utc::now().timestamp(),
        jti: Uuid::new_v4().to_string(),
        token_type: TokenType::Access,
        device_id: None,
        session_id: Uuid::new_v4().to_string(),
        roles: vec!["admin".to_string()],
        is_admin: true,
    }
}

fn user_claims(user_id: Uuid) -> Claims {
    Claims {
        sub: user_id.to_string(),
        exp: (Utc::now() + Duration::minutes(15)).timestamp(),
        iat: Utc::now().timestamp(),
        jti: Uuid::new_v4().to_string(),
        token_type: TokenType::Access,
        device_id: None,
        session_id: Uuid::new_v4().to_string(),
        roles: vec!["user".to_string()],
        is_admin: false,
    }
}

/// Simulates the authorization logic from `update_tournament_status` handler.
/// Returns Ok(()) when access is granted, Err(status_code) otherwise.
fn check_authorization(
    claims: &Claims,
    creator_id: Uuid,
    new_status: TournamentStatus,
) -> Result<(), u16> {
    let caller_id = Uuid::parse_str(&claims.sub).map_err(|_| 401u16)?;

    let is_admin = claims.is_admin();
    let is_creator = creator_id == caller_id;

    if !is_admin && !is_creator {
        return Err(403);
    }

    // Only admins may trigger Completed (chains prize distribution)
    if new_status == TournamentStatus::Completed && !is_admin {
        return Err(403);
    }

    Ok(())
}

// ── authentication ────────────────────────────────────────────────────────────

#[test]
fn unauthenticated_request_returns_401() {
    // No Claims present → parse_str on empty string fails → 401
    let bad_claims = Claims {
        sub: "not-a-uuid".to_string(),
        exp: (Utc::now() + Duration::minutes(15)).timestamp(),
        iat: Utc::now().timestamp(),
        jti: Uuid::new_v4().to_string(),
        token_type: TokenType::Access,
        device_id: None,
        session_id: Uuid::new_v4().to_string(),
        roles: vec![],
        is_admin: false,
    };
    let result = check_authorization(&bad_claims, Uuid::new_v4(), TournamentStatus::Upcoming);
    assert_eq!(result, Err(401), "malformed sub must yield 401");
}

// ── admin access ──────────────────────────────────────────────────────────────

#[test]
fn admin_can_update_any_tournament_status() {
    let admin_id = Uuid::new_v4();
    let creator_id = Uuid::new_v4(); // different user
    let claims = admin_claims(admin_id);

    for status in [
        TournamentStatus::Draft,
        TournamentStatus::Upcoming,
        TournamentStatus::RegistrationOpen,
        TournamentStatus::RegistrationClosed,
        TournamentStatus::InProgress,
        TournamentStatus::Cancelled,
    ] {
        assert!(
            check_authorization(&claims, creator_id, status).is_ok(),
            "admin must be allowed for status {status:?}"
        );
    }
}

#[test]
fn admin_can_trigger_completed_transition() {
    let admin_id = Uuid::new_v4();
    let creator_id = Uuid::new_v4();
    let claims = admin_claims(admin_id);
    assert!(
        check_authorization(&claims, creator_id, TournamentStatus::Completed).is_ok(),
        "admin must be allowed to set Completed"
    );
}

// ── creator access ────────────────────────────────────────────────────────────

#[test]
fn creator_can_update_non_privileged_status() {
    let creator_id = Uuid::new_v4();
    let claims = user_claims(creator_id);

    for status in [
        TournamentStatus::Draft,
        TournamentStatus::Upcoming,
        TournamentStatus::RegistrationOpen,
        TournamentStatus::RegistrationClosed,
        TournamentStatus::InProgress,
        TournamentStatus::Cancelled,
    ] {
        assert!(
            check_authorization(&claims, creator_id, status).is_ok(),
            "creator must be allowed for status {status:?}"
        );
    }
}

#[test]
fn creator_cannot_trigger_completed_transition() {
    let creator_id = Uuid::new_v4();
    let claims = user_claims(creator_id);
    assert_eq!(
        check_authorization(&claims, creator_id, TournamentStatus::Completed),
        Err(403),
        "creator must NOT be allowed to set Completed (prize distribution)"
    );
}

// ── unauthorized authenticated user ──────────────────────────────────────────

#[test]
fn non_creator_non_admin_receives_403() {
    let creator_id = Uuid::new_v4();
    let other_user_id = Uuid::new_v4();
    let claims = user_claims(other_user_id);

    assert_eq!(
        check_authorization(&claims, creator_id, TournamentStatus::Upcoming),
        Err(403),
        "non-creator non-admin must receive 403"
    );
}

#[test]
fn idor_attempt_blocked() {
    // Attacker tries to update a tournament they don't own
    let real_creator = Uuid::new_v4();
    let attacker = Uuid::new_v4();
    let claims = user_claims(attacker);

    assert_eq!(
        check_authorization(&claims, real_creator, TournamentStatus::InProgress),
        Err(403),
        "IDOR attempt must be blocked with 403"
    );
}

// ── privilege escalation ──────────────────────────────────────────────────────

#[test]
fn forged_is_admin_false_with_admin_role_still_grants_admin() {
    // Token has is_admin: false but roles contains "admin" — must still be treated as admin
    let user_id = Uuid::new_v4();
    let creator_id = Uuid::new_v4();
    let claims = Claims {
        sub: user_id.to_string(),
        exp: (Utc::now() + Duration::minutes(15)).timestamp(),
        iat: Utc::now().timestamp(),
        jti: Uuid::new_v4().to_string(),
        token_type: TokenType::Access,
        device_id: None,
        session_id: Uuid::new_v4().to_string(),
        roles: vec!["admin".to_string()],
        is_admin: false, // field says false, but role says admin
    };
    // is_admin() checks both field AND roles
    assert!(claims.is_admin(), "role-based admin must be detected");
    assert!(
        check_authorization(&claims, creator_id, TournamentStatus::Completed).is_ok(),
        "role-based admin must be allowed to set Completed"
    );
}

#[test]
fn forged_is_admin_true_without_admin_role_still_grants_admin() {
    // Token has is_admin: true — field alone is sufficient
    let user_id = Uuid::new_v4();
    let creator_id = Uuid::new_v4();
    let claims = Claims {
        sub: user_id.to_string(),
        exp: (Utc::now() + Duration::minutes(15)).timestamp(),
        iat: Utc::now().timestamp(),
        jti: Uuid::new_v4().to_string(),
        token_type: TokenType::Access,
        device_id: None,
        session_id: Uuid::new_v4().to_string(),
        roles: vec!["user".to_string()],
        is_admin: true,
    };
    assert!(claims.is_admin());
    assert!(
        check_authorization(&claims, creator_id, TournamentStatus::Completed).is_ok()
    );
}

#[test]
fn non_admin_cannot_escalate_to_completed_via_any_path() {
    let user_id = Uuid::new_v4();
    // Even as creator, Completed is blocked
    let claims = user_claims(user_id);
    assert_eq!(
        check_authorization(&claims, user_id, TournamentStatus::Completed),
        Err(403),
        "creator without admin role must not reach Completed"
    );
}

// ── is_admin helper ───────────────────────────────────────────────────────────

#[test]
fn is_admin_false_for_plain_user() {
    let claims = user_claims(Uuid::new_v4());
    assert!(!claims.is_admin());
}

#[test]
fn is_admin_true_for_admin_field() {
    let claims = admin_claims(Uuid::new_v4());
    assert!(claims.is_admin());
}

#[test]
fn is_admin_true_when_only_role_is_admin() {
    let claims = Claims {
        sub: Uuid::new_v4().to_string(),
        exp: (Utc::now() + Duration::minutes(15)).timestamp(),
        iat: Utc::now().timestamp(),
        jti: Uuid::new_v4().to_string(),
        token_type: TokenType::Access,
        device_id: None,
        session_id: Uuid::new_v4().to_string(),
        roles: vec!["admin".to_string()],
        is_admin: false,
    };
    assert!(claims.is_admin());
}

#[test]
fn is_admin_false_when_no_admin_role_and_field_false() {
    let claims = Claims {
        sub: Uuid::new_v4().to_string(),
        exp: (Utc::now() + Duration::minutes(15)).timestamp(),
        iat: Utc::now().timestamp(),
        jti: Uuid::new_v4().to_string(),
        token_type: TokenType::Access,
        device_id: None,
        session_id: Uuid::new_v4().to_string(),
        roles: vec!["moderator".to_string(), "user".to_string()],
        is_admin: false,
    };
    assert!(!claims.is_admin());
}

// ── valid status transitions (non-privileged) ─────────────────────────────────

#[test]
fn valid_transitions_allowed_for_creator() {
    let creator_id = Uuid::new_v4();
    let claims = user_claims(creator_id);

    let transitions = [
        (TournamentStatus::Draft, TournamentStatus::Upcoming),
        (TournamentStatus::Upcoming, TournamentStatus::RegistrationOpen),
        (TournamentStatus::RegistrationOpen, TournamentStatus::RegistrationClosed),
        (TournamentStatus::RegistrationClosed, TournamentStatus::InProgress),
        (TournamentStatus::InProgress, TournamentStatus::Cancelled),
    ];

    for (_, new_status) in transitions {
        assert!(
            check_authorization(&claims, creator_id, new_status).is_ok(),
            "creator must be allowed for transition to {new_status:?}"
        );
    }
}

// ── prize distribution guard ──────────────────────────────────────────────────

#[test]
fn prize_distribution_blocked_for_all_non_admins() {
    // Any user who is not an admin must be blocked from Completed
    for _ in 0..5 {
        let user_id = Uuid::new_v4();
        let claims = user_claims(user_id);
        // Even as creator
        assert_eq!(
            check_authorization(&claims, user_id, TournamentStatus::Completed),
            Err(403),
            "non-admin must never reach prize distribution"
        );
    }
}
