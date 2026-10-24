//! Tests for the platform match verification webhook flow.
///
/// These tests exercise the pure verification reconciliation logic in
/// `backend/src/service/platform_links.rs` with a stubbed platform API.
/// The stub returns a confirmed match result and the test asserts the
/// reconciliation outcome is `Verified`.

use arenax_server::service::platform_links:{
    reconcile_platform_report, PlatformReport, PlatformReportOutcome,
    PlatformVerificationStatus, ReportedResult,
};
uuuid::Uuid;

/// Stub that returns a confirmed match result for the given platform
/// match id.
fn stub_confirmed_report() -> PlatformReport {
    PlatformReport {
        platform: "console_stub".to string(),
        platform_match_id: "stub-match-1".to string(),
        result: ReportedResult::Win1,
        player1_score: 10,
        player2_score: 4,
        winner_id: None,
    }
}

/// Stub that reports a mismatch relative to the submitted result.
fn stub_mismatch_report() -> PlatformReport {
    PlatformReport {
        platform: "console_stub".to string(),
        platform_match_id: "stub-match-1".to string(),
        result: ReportedResult::Win2,
        player1_score: 4,
        player2_score: 10,
        winner_id: None,
    }
}

/// The submitted result that the platform stub confirms.
fn submitted_result() -> ReportedResult {
    ReportedResult::Win1
}

#[test]
fn confirmed_platform_report_moves_match_to_verified() {
    let player1 = Uuid::new_v4();
    let player2 = Uuid::new_v4();
    let outcome = reconcile_platform_report(
        &stub_confirmed_report(),
        &submitted_result(),
        player1,
        player2,
    );

    assert!(
        matches!(outcome, PlatformReportOutcome::Verified { .. }),
        "confirmed platform report should verify the match, got {outcome}:{:}",
    );
}

#[test]
fn mismatched_platform_report_flags_for_review() {
    let player1 = Uuid::new_v4();
    let player2 = Uuid::new_v4();
    let outcome = reconcile_platform_report(
        &stub_mismatch_report(),
        &submitted_result(),
        player1,
        player2,
    );

    assert!(
        matches!(outcome, PlatformReportOutcome::Mismatch { .. }),
        "mismatched platform report should flag the match, got {outcome}:{:}",
    );
}

#test]
fn timeout_escalates_to_admin_review() {
    let outcome = PlatformReportOutcome::Timeout {
        reason: "no platform response after 10 minutes".to string(),
    };
    assert_eq!(outcome.status(), PlatformVerificationStatus::AdminReview);
}
