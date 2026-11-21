//! Reusable custom validators.
//!
//! Every validator returns a [`validator::ValidationError`] with a stable
//! `code` and structured `params`. The codes are the keys used by the
//! [`crate::validators::i18n`] catalog, so error messages can be localized
//! without changing call sites.
//!
//! The single-argument validators (`validate_username`, `validate_password`,
//! …) are compatible with the `validator` crate's `#[validate(custom = "...")]`
//! attribute:
//!
//! ```ignore
//! #[derive(validator::Validate)]
//! struct RegisterRequest {
//!     #[validate(custom = "crate::validators::custom::validate_username")]
//!     username: String,
//! }
//! ```

use std::borrow::Cow;

use uuid::Uuid;
use validator::ValidationError;

/// Minimum username length in characters.
pub const USERNAME_MIN: usize = 3;
/// Maximum username length in characters.
pub const USERNAME_MAX: usize = 32;

/// Minimum password length in characters.
pub const PASSWORD_MIN: usize = 8;
/// Maximum password length in characters.
pub const PASSWORD_MAX: usize = 128;

/// Minimum reference (idempotency key) length.
pub const REFERENCE_MIN: usize = 8;
/// Maximum reference (idempotency key) length.
pub const REFERENCE_MAX: usize = 128;

/// Minimum phone number digit count (E.164).
pub const PHONE_MIN_DIGITS: usize = 7;
/// Maximum phone number digit count (E.164).
pub const PHONE_MAX_DIGITS: usize = 15;

/// Stellar public keys (ed25519/muxed) are 56 base32 characters.
pub const STELLAR_ADDRESS_LEN: usize = 56;

/// Validate a username: 3–32 characters, letters/digits/`_`/`-`/`.` only.
pub fn validate_username(value: &str) -> Result<(), ValidationError> {
    let len = value.chars().count();
    if !(USERNAME_MIN..=USERNAME_MAX).contains(&len) {
        let mut err = ValidationError::new("username");
        err.add_param(Cow::from("min"), &USERNAME_MIN);
        err.add_param(Cow::from("max"), &USERNAME_MAX);
        return Err(err);
    }
    let allowed =
        value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'));
    if !allowed {
        return Err(ValidationError::new("username_charset"));
    }
    Ok(())
}

/// Validate a password: 8–128 characters with at least one uppercase letter,
/// one lowercase letter and one digit.
pub fn validate_password(value: &str) -> Result<(), ValidationError> {
    let len = value.chars().count();
    if !(PASSWORD_MIN..=PASSWORD_MAX).contains(&len) {
        let mut err = ValidationError::new("password");
        err.add_param(Cow::from("min"), &PASSWORD_MIN);
        err.add_param(Cow::from("max"), &PASSWORD_MAX);
        return Err(err);
    }
    let has_lower = value.chars().any(|c| c.is_ascii_lowercase());
    let has_upper = value.chars().any(|c| c.is_ascii_uppercase());
    let has_digit = value.chars().any(|c| c.is_ascii_digit());
    if !(has_lower && has_upper && has_digit) {
        return Err(ValidationError::new("password_complexity"));
    }
    Ok(())
}

/// Validate that a string is a well-formed UUID.
pub fn validate_uuid(value: &str) -> Result<(), ValidationError> {
    if Uuid::parse_str(value).is_err() {
        return Err(ValidationError::new("uuid"));
    }
    Ok(())
}

/// Validate a currency code: 3–10 letters/digits (e.g. `NGN`, `XLM`, `ARENAX_TOKEN`).
pub fn validate_currency(value: &str) -> Result<(), ValidationError> {
    let valid = (3..=10).contains(&value.len())
        && value.chars().all(|c| c.is_ascii_alphanumeric());
    if !valid {
        return Err(ValidationError::new("currency"));
    }
    Ok(())
}

/// Validate a Stellar account address: 56 base32 characters starting with `G`/`C`.
pub fn validate_stellar_address(value: &str) -> Result<(), ValidationError> {
    let valid = value.len() == STELLAR_ADDRESS_LEN
        && (value.starts_with('G') || value.starts_with('C'))
        && value.chars().all(|c| c.is_ascii_alphanumeric());
    if !valid {
        return Err(ValidationError::new("stellar_address"));
    }
    Ok(())
}

/// Validate a phone number in E.164-ish form: optional leading `+`, 7–15 digits.
pub fn validate_phone_number(value: &str) -> Result<(), ValidationError> {
    let body = value.strip_prefix('+').unwrap_or(value);
    let valid = (PHONE_MIN_DIGITS..=PHONE_MAX_DIGITS).contains(&body.len())
        && body.chars().all(|c| c.is_ascii_digit())
        && value.chars().all(|c| c.is_ascii_digit() || c == '+')
        && value.matches('+').count() <= 1;
    if !valid {
        return Err(ValidationError::new("phone_number"));
    }
    Ok(())
}

/// Validate a "safe" free-text string: no control characters and at most
/// `max_len` bytes. Mirrors [`crate::middleware::security::validate_safe_string`]
/// but returns a structured, localizable error.
pub fn validate_safe_string(value: &str, max_len: usize) -> Result<(), ValidationError> {
    if value.len() > max_len {
        let mut err = ValidationError::new("safe_string_length");
        err.add_param(Cow::from("max"), &max_len);
        return Err(err);
    }
    if value.chars().any(|c| c.is_control()) {
        return Err(ValidationError::new("safe_string_control"));
    }
    Ok(())
}

/// Validate a positive integer amount.
pub fn validate_positive_amount(amount: i64) -> Result<(), ValidationError> {
    if amount <= 0 {
        return Err(ValidationError::new("positive_amount"));
    }
    Ok(())
}

/// Validate a reference / idempotency key: 8–128 chars, letters/digits/`_`/`-`.
///
/// Matches the rules enforced by `IdempotencyService::validate_key_format`.
pub fn validate_reference(value: &str) -> Result<(), ValidationError> {
    let valid = (REFERENCE_MIN..=REFERENCE_MAX).contains(&value.len())
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !valid {
        let mut err = ValidationError::new("reference");
        err.add_param(Cow::from("min"), &REFERENCE_MIN);
        err.add_param(Cow::from("max"), &REFERENCE_MAX);
        return Err(err);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn username_validates_length_and_charset() {
        assert!(validate_username("player_one").is_ok());
        assert!(validate_username("abc").is_ok());
        assert!(validate_username("a-b.c").is_ok());

        let err = validate_username("ab").unwrap_err();
        assert_eq!(err.code.as_ref(), "username");
        assert!(err.params.contains_key("min"));
        assert!(err.params.contains_key("max"));

        assert!(validate_username("has space").is_err());
        assert!(validate_username("emoji😀").is_err());

        let long = "a".repeat(33);
        assert!(validate_username(&long).is_err());
    }

    #[test]
    fn password_validates_length_and_complexity() {
        assert!(validate_password("StrongPass1").is_ok());

        let err = validate_password("weak").unwrap_err();
        assert_eq!(err.code.as_ref(), "password");

        let err = validate_password("alllowercase1").unwrap_err();
        assert_eq!(err.code.as_ref(), "password_complexity");

        assert!(validate_password("NODIGITS").is_err());
    }

    #[test]
    fn uuid_validates() {
        assert!(validate_uuid("550e8400-e29b-41d4-a716-446655440000").is_ok());
        assert!(validate_uuid("not-a-uuid").is_err());
    }

    #[test]
    fn currency_validates() {
        assert!(validate_currency("NGN").is_ok());
        assert!(validate_currency("ARENAX_TOKEN").is_ok());
        assert!(validate_currency("NG").is_err());
        assert!(validate_currency("has space").is_err());
    }

    #[test]
    fn stellar_address_validates() {
        let addr = format!("G{}", "A".repeat(55));
        assert!(validate_stellar_address(&addr).is_ok());

        let err = validate_stellar_address("SHORT").unwrap_err();
        assert_eq!(err.code.as_ref(), "stellar_address");

        assert!(validate_stellar_address(&format!("X{}", "A".repeat(55))).is_err());
    }

    #[test]
    fn phone_number_validates() {
        assert!(validate_phone_number("+2348012345678").is_ok());
        assert!(validate_phone_number("08012345678").is_ok());
        assert!(validate_phone_number("+1").is_err());
        assert!(validate_phone_number("abc12345678").is_err());
        assert!(validate_phone_number("++2348012345678").is_err());
    }

    #[test]
    fn safe_string_validates() {
        assert!(validate_safe_string("hello world", 255).is_ok());

        let err = validate_safe_string("hello", 3).unwrap_err();
        assert_eq!(err.code.as_ref(), "safe_string_length");

        let err = validate_safe_string("bad\u{0007}control", 255).unwrap_err();
        assert_eq!(err.code.as_ref(), "safe_string_control");
    }

    #[test]
    fn positive_amount_validates() {
        assert!(validate_positive_amount(1).is_ok());
        let err = validate_positive_amount(0).unwrap_err();
        assert_eq!(err.code.as_ref(), "positive_amount");
        assert!(validate_positive_amount(-5).is_err());
    }

    #[test]
    fn reference_validates() {
        assert!(validate_reference("valid_key_123").is_ok());
        assert!(validate_reference("key-with-hyphens").is_ok());
        assert!(validate_reference("12345678").is_ok());

        let err = validate_reference("short").unwrap_err();
        assert_eq!(err.code.as_ref(), "reference");

        assert!(validate_reference("").is_err());
        assert!(validate_reference("key with spaces").is_err());
        assert!(validate_reference("key@with#symbols").is_err());
    }
}

// ============================================================
// Bulk match ingestion — game-specific validation (Issue #bulk-ingest)
// ============================================================

use crate::models::BulkMatchResultItem;

/// Maximum score value accepted for any game.
///
/// Game integrations must report scores in the range `0..=MAX_GAME_SCORE`.
/// Scores outside this range are almost certainly a client bug or a
/// malicious payload.
pub const MAX_GAME_SCORE: i32 = 999_999;

/// Game-specific score-range upper bounds.
///
/// If a `game_id` is not listed here the generic `MAX_GAME_SCORE` ceiling
/// applies.  Keys are lower-cased before lookup so "FPS_PRO" and "fps_pro"
/// match the same rule.
fn max_score_for_game(game_id: &str) -> i32 {
    match game_id.to_ascii_lowercase().as_str() {
        // Round-based games — single-digit round counts.
        "chess" | "checkers" | "go" => 1,
        // Best-of-N series games — small integer win counts.
        "fighting_game" | "streetfighter" | "tekken" => 3,
        // Sports simulation — realistic score ceiling.
        "soccer_sim" | "basketball_sim" | "football_sim" => 200,
        // FPS / battle-royale — kill / point counts.
        "fps_pro" | "battle_royale" => 500,
        // Card / strategy games.
        "card_duel" | "hearthstone_clone" => 30,
        // Racing games — position/lap-time encoded as integer milliseconds.
        "racing_sim" => 999_999,
        // Default: generous ceiling for unknown integrations.
        _ => MAX_GAME_SCORE,
    }
}

/// Minimum required `game_id` length.
pub const GAME_ID_MIN_LEN: usize = 2;
/// Maximum allowed `game_id` length.
pub const GAME_ID_MAX_LEN: usize = 64;

/// Minimum required `game_mode` length.
pub const GAME_MODE_MIN_LEN: usize = 1;
/// Maximum allowed `game_mode` length.
pub const GAME_MODE_MAX_LEN: usize = 64;

/// Validate one item from a bulk match-result ingestion request.
///
/// Returns `Ok(())` when the item passes all game-specific rules, or an `Err`
/// carrying a human-readable explanation string when it does not.  The caller
/// is responsible for collecting these errors into
/// [`BulkMatchItemResult`][crate::models::BulkMatchItemResult] entries.
///
/// ### Rules applied (in order)
///
/// 1. `player1_id` ≠ `player2_id` — a player cannot face themselves.
/// 2. Scores are non-negative (`0..=MAX_GAME_SCORE`).
/// 3. Each score must not exceed the game-specific ceiling.
/// 4. `winner_id`, when present, must be `player1_id` or `player2_id`.
/// 5. When scores are equal the result must be a draw (`winner_id = None`).
/// 6. When scores differ `winner_id` must agree with the higher score.
/// 7. `game_id` length must be in `GAME_ID_MIN_LEN..=GAME_ID_MAX_LEN`.
/// 8. `game_mode` length must be in `GAME_MODE_MIN_LEN..=GAME_MODE_MAX_LEN`.
/// 9. Optional `proof_url`, when present, must start with `http://` or
///    `https://` and must not exceed 2 048 characters.
/// 10. Optional `completed_at`, when present, must be a positive Unix
///     timestamp (> 0).
/// 11. Optional `match_duration`, when present, must be positive (> 0).
pub fn validate_bulk_match_result(item: &BulkMatchResultItem) -> Result<(), String> {
    // Rule 1 — distinct players.
    if item.player1_id == item.player2_id {
        return Err("player1_id and player2_id must be different".to_string());
    }

    // Rule 2 — non-negative scores.
    if item.player1_score < 0 {
        return Err(format!(
            "player1_score must be >= 0, got {}",
            item.player1_score
        ));
    }
    if item.player2_score < 0 {
        return Err(format!(
            "player2_score must be >= 0, got {}",
            item.player2_score
        ));
    }

    // Rule 3 — game-specific score ceiling.
    let max_score = max_score_for_game(&item.game_id);
    if item.player1_score > max_score {
        return Err(format!(
            "player1_score {} exceeds the maximum allowed score {} for game '{}'",
            item.player1_score, max_score, item.game_id
        ));
    }
    if item.player2_score > max_score {
        return Err(format!(
            "player2_score {} exceeds the maximum allowed score {} for game '{}'",
            item.player2_score, max_score, item.game_id
        ));
    }

    // Rule 4 — winner_id, when present, must be one of the participants.
    if let Some(winner) = item.winner_id {
        if winner != item.player1_id && winner != item.player2_id {
            return Err(format!(
                "winner_id {} is not a participant in this match",
                winner
            ));
        }
    }

    // Rules 5 & 6 — winner consistency with scores.
    if item.player1_score == item.player2_score {
        // Draw: winner_id must be absent.
        if item.winner_id.is_some() {
            return Err(
                "winner_id must be absent when scores are equal (draw)".to_string(),
            );
        }
    } else {
        // Decisive outcome: winner_id must be present and must match the
        // player with the higher score.
        match item.winner_id {
            None => {
                return Err(
                    "winner_id is required when scores differ".to_string(),
                );
            }
            Some(winner) => {
                let expected_winner = if item.player1_score > item.player2_score {
                    item.player1_id
                } else {
                    item.player2_id
                };
                if winner != expected_winner {
                    return Err(format!(
                        "winner_id {} does not match the player with the higher score",
                        winner
                    ));
                }
            }
        }
    }

    // Rule 7 — game_id length.
    let game_id_len = item.game_id.len();
    if !(GAME_ID_MIN_LEN..=GAME_ID_MAX_LEN).contains(&game_id_len) {
        return Err(format!(
            "game_id length must be {GAME_ID_MIN_LEN}–{GAME_ID_MAX_LEN} characters, got {game_id_len}"
        ));
    }

    // Rule 8 — game_mode length.
    let mode_len = item.game_mode.len();
    if !(GAME_MODE_MIN_LEN..=GAME_MODE_MAX_LEN).contains(&mode_len) {
        return Err(format!(
            "game_mode length must be {GAME_MODE_MIN_LEN}–{GAME_MODE_MAX_LEN} characters, got {mode_len}"
        ));
    }

    // Rule 9 — proof_url format.
    if let Some(ref url) = item.proof_url {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err("proof_url must start with http:// or https://".to_string());
        }
        if url.len() > 2048 {
            return Err(format!(
                "proof_url must not exceed 2048 characters, got {}",
                url.len()
            ));
        }
    }

    // Rule 10 — completed_at must be a positive Unix timestamp.
    if let Some(ts) = item.completed_at {
        if ts <= 0 {
            return Err(format!(
                "completed_at must be a positive Unix timestamp, got {ts}"
            ));
        }
    }

    // Rule 11 — match_duration must be positive.
    if let Some(dur) = item.match_duration {
        if dur <= 0 {
            return Err(format!(
                "match_duration must be positive (seconds), got {dur}"
            ));
        }
    }

    Ok(())
}

#[cfg(test)]
mod bulk_validation_tests {
    use super::*;
    use uuid::Uuid;

    fn base_item() -> BulkMatchResultItem {
        let p1 = Uuid::new_v4();
        let p2 = Uuid::new_v4();
        BulkMatchResultItem {
            index: 0,
            player1_id: p1,
            player2_id: p2,
            game_id: "fps_pro".to_string(),
            game_mode: "ranked".to_string(),
            player1_score: 10,
            player2_score: 5,
            winner_id: Some(p1),
            match_type: None,
            tournament_id: None,
            round_id: None,
            proof_url: None,
            telemetry_data: None,
            completed_at: None,
            match_duration: None,
        }
    }

    #[test]
    fn valid_item_passes() {
        assert!(validate_bulk_match_result(&base_item()).is_ok());
    }

    #[test]
    fn same_player_ids_rejected() {
        let mut item = base_item();
        item.player2_id = item.player1_id;
        let err = validate_bulk_match_result(&item).unwrap_err();
        assert!(err.contains("different"));
    }

    #[test]
    fn negative_score_rejected() {
        let mut item = base_item();
        item.player1_score = -1;
        assert!(validate_bulk_match_result(&item).is_err());
    }

    #[test]
    fn score_exceeds_game_ceiling_rejected() {
        let mut item = base_item();
        // chess max score is 1
        item.game_id = "chess".to_string();
        item.player1_score = 2;
        item.player2_score = 0;
        item.winner_id = Some(item.player1_id);
        let err = validate_bulk_match_result(&item).unwrap_err();
        assert!(err.contains("maximum allowed score"));
    }

    #[test]
    fn winner_not_participant_rejected() {
        let mut item = base_item();
        item.winner_id = Some(Uuid::new_v4()); // random non-participant
        assert!(validate_bulk_match_result(&item).is_err());
    }

    #[test]
    fn draw_requires_no_winner_id() {
        let p1 = Uuid::new_v4();
        let p2 = Uuid::new_v4();
        let mut item = base_item();
        item.player1_id = p1;
        item.player2_id = p2;
        item.player1_score = 3;
        item.player2_score = 3;
        item.winner_id = Some(p1); // wrong: draw should have no winner
        assert!(validate_bulk_match_result(&item).is_err());
        item.winner_id = None;
        assert!(validate_bulk_match_result(&item).is_ok());
    }

    #[test]
    fn decisive_match_requires_winner_id() {
        let mut item = base_item();
        item.winner_id = None;
        assert!(validate_bulk_match_result(&item).is_err());
    }

    #[test]
    fn wrong_winner_id_rejected() {
        let mut item = base_item();
        // player2 has lower score (5) but is listed as winner
        item.winner_id = Some(item.player2_id);
        assert!(validate_bulk_match_result(&item).is_err());
    }

    #[test]
    fn invalid_proof_url_rejected() {
        let mut item = base_item();
        item.proof_url = Some("ftp://not-allowed.com".to_string());
        assert!(validate_bulk_match_result(&item).is_err());
    }

    #[test]
    fn valid_proof_url_accepted() {
        let mut item = base_item();
        item.proof_url = Some("https://cdn.example.com/proof.mp4".to_string());
        assert!(validate_bulk_match_result(&item).is_ok());
    }

    #[test]
    fn zero_completed_at_rejected() {
        let mut item = base_item();
        item.completed_at = Some(0);
        assert!(validate_bulk_match_result(&item).is_err());
    }

    #[test]
    fn zero_match_duration_rejected() {
        let mut item = base_item();
        item.match_duration = Some(0);
        assert!(validate_bulk_match_result(&item).is_err());
    }

    #[test]
    fn short_game_id_rejected() {
        let mut item = base_item();
        item.game_id = "x".to_string();
        assert!(validate_bulk_match_result(&item).is_err());
    }

    #[test]
    fn empty_game_mode_rejected() {
        let mut item = base_item();
        item.game_mode = String::new();
        assert!(validate_bulk_match_result(&item).is_err());
    }
}
