//! String sanitization: HTML entity encoding, XSS stripping, SQL-identifier
//! whitelisting, and `LIKE` wildcard escaping.
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SanitizeError(pub String);

impl fmt::Display for SanitizeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for SanitizeError {}

/// HTML-entity-encode the five characters that matter for breaking out of
/// HTML text/attribute context: `& < > " '`. This is the core primitive
/// every other text sanitizer here builds on.
pub fn escape_html(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#x27;"),
            _ => out.push(c),
        }
    }
    out
}

/// Strip ASCII control characters (except `\t`, `\n`, `\r`) that have no
/// legitimate place in user-supplied text and are sometimes used to smuggle
/// payloads past naive filters or corrupt log output.
fn strip_control_chars(input: &str) -> String {
    input
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\t' | '\n' | '\r'))
        .collect()
}

/// Sanitize free-text, plain-text-only fields (usernames, tournament names,
/// search queries): strips control characters, trims, and HTML-escapes.
/// Safe default for any field that is never expected to contain markup.
pub fn sanitize_plain_text(input: &str) -> String {
    escape_html(strip_control_chars(input).trim())
}

/// Sanitize rich-text-ish fields (bios, chat messages, tournament
/// descriptions) that are allowed newlines/basic punctuation but must never
/// render as HTML. Functionally the same escaping as [`sanitize_plain_text`]
/// today (we do not support any user-authored markup) — kept as a distinct
/// entry point so callers name their intent, and so we have a single place
/// to loosen the policy later if rich formatting is ever supported.
pub fn sanitize_rich_text(input: &str) -> String {
    escape_html(&strip_control_chars(input))
}

/// Validate a value that will be interpolated into SQL as an *identifier*
/// (table/column name) rather than bound as a parameter — sqlx (and SQL in
/// general) cannot bind identifiers with `$1` placeholders, so any code
/// building a dynamic identifier must go through this whitelist instead of
/// interpolating raw user input.
///
/// Ordinary query values must always use sqlx's parameterized queries and
/// should never call this function.
pub fn sanitize_identifier(input: &str) -> Result<String, SanitizeError> {
    if input.is_empty() || input.len() > 64 {
        return Err(SanitizeError(
            "identifier must be 1-64 characters".to_string(),
        ));
    }
    let mut chars = input.chars();
    let first = chars.next().unwrap();
    if !(first.is_ascii_alphabetic() || first == '_') {
        return Err(SanitizeError(
            "identifier must start with a letter or underscore".to_string(),
        ));
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(SanitizeError(
            "identifier may only contain letters, digits, and underscores".to_string(),
        ));
    }
    Ok(input.to_string())
}

/// Escape `%` and `_` (the `LIKE`/`ILIKE` wildcard characters) in a value
/// that will be bound into a `LIKE` clause, so user input can't inject
/// unintended wildcard behavior. The escaped value should still be bound as
/// a parameter (e.g. `LIKE $1 ESCAPE '\'`), not string-interpolated.
pub fn escape_like_pattern(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '%' => out.push_str("\\%"),
            '_' => out.push_str("\\_"),
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_html_special_chars() {
        assert_eq!(
            escape_html("<script>alert('xss')</script>"),
            "&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;"
        );
    }

    #[test]
    fn rejects_bad_identifiers() {
        assert!(sanitize_identifier("users; DROP TABLE users;--").is_err());
        assert!(sanitize_identifier("1users").is_err());
        assert!(sanitize_identifier("valid_column_1").is_ok());
    }

    #[test]
    fn escapes_like_wildcards() {
        assert_eq!(escape_like_pattern("50%_off"), "50\\%\\_off");
    }
}
