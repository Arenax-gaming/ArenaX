//! Gameplay telemetry upload + match linkage HTTP surface.
//!
//! - `POST /api/telemetry` — validate a recorded session, upload it to
//!   S3/MinIO and link the resulting reference to the match record.
//! - `GET  /api/telemetry/{match_id}` — every recording linked to a match
//!   (admin only: it spans all players in the match).
//! - `GET  /api/telemetry/{match_id}/players/{player_id}` — one player's
//!   recording metadata; the player themselves or an admin.
//!
//! Uploads require authentication and a player may only submit their own
//! recording; admins may submit or read on behalf of any player.
//!
//! Expiry is not exposed here: retention is enforced by the background sweeper
//! ([`crate::service::TelemetryRetentionService`]), so nothing in the API can
//! delete a recording early or keep one alive past its window.

use crate::api_error::ApiError;
use crate::auth::jwt_service::{Claims, JwtService};
use crate::http::auth_handler::ACCESS_TOKEN_COOKIE;
use crate::models::telemetry::{TelemetryUploadLimits, TelemetryUploadRequest};
use crate::service::TelemetryUploadService;
use actix_web::dev::Payload;
use actix_web::http::header;
use actix_web::web::Bytes;
use actix_web::{web, HttpRequest, HttpResponse};
use flate2::read::GzDecoder;
use futures_util::StreamExt;
use std::io::Read;
use std::sync::Arc;
use uuid::Uuid;

/// A telemetry request body, already decompressed.
///
/// Uploads are accepted either as plain JSON or as a gzip-compressed body
/// (`Content-Encoding: gzip`), which is what clients recording long sessions
/// send: the event stream is highly repetitive, so gzip typically cuts it by an
/// order of magnitude (#1529). Decompression happens here rather than in the
/// handler so the size limits are enforced before the document is parsed.
pub struct TelemetryBody {
    bytes: Bytes,
}

impl TelemetryBody {
    /// Parse the decompressed body into an upload request.
    pub fn into_request(self) -> Result<TelemetryUploadRequest, ApiError> {
        serde_json::from_slice(&self.bytes).map_err(|error| {
            ApiError::BadRequest(format!("Telemetry body is not valid JSON: {error}"))
        })
    }

    #[cfg(test)]
    pub fn from_bytes(bytes: impl Into<Bytes>) -> Self {
        Self {
            bytes: bytes.into(),
        }
    }
}

impl actix_web::FromRequest for TelemetryBody {
    type Error = ApiError;
    type Future = futures::future::LocalBoxFuture<'static, Result<Self, ApiError>>;

    fn from_request(req: &HttpRequest, payload: &mut Payload) -> Self::Future {
        let limits = req
            .app_data::<web::Data<TelemetryUploadLimits>>()
            .map(|limits| *limits.get_ref())
            .unwrap_or_default();

        let encoding = req
            .headers()
            .get(header::CONTENT_ENCODING)
            .map(|value| value.to_str().unwrap_or("").trim().to_ascii_lowercase());

        let mut stream = payload.take();

        Box::pin(async move {
            let raw = read_limited(&mut stream, limits.max_upload_bytes).await?;
            let decoded = decode_body(raw, encoding.as_deref(), limits.max_document_bytes)?;
            Ok(Self { bytes: decoded })
        })
    }
}

/// Buffer the body, failing as soon as it exceeds `limit`.
///
/// The limit is enforced while reading, not after, so an oversized upload never
/// gets fully buffered.
async fn read_limited(stream: &mut Payload, limit: usize) -> Result<Bytes, ApiError> {
    let mut buffer: Vec<u8> = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            ApiError::BadRequest(format!("Failed to read telemetry body: {error}"))
        })?;
        if buffer.len() + chunk.len() > limit {
            return Err(ApiError::PayloadTooLarge(format!(
                "Compressed telemetry body exceeds the {limit}-byte upload limit"
            )));
        }
        buffer.extend_from_slice(&chunk);
    }

    Ok(Bytes::from(buffer))
}

/// Apply `Content-Encoding` and enforce the decompressed size limit.
fn decode_body(
    raw: Bytes,
    encoding: Option<&str>,
    max_document_bytes: usize,
) -> Result<Bytes, ApiError> {
    match encoding {
        // `identity` is what HTTP calls "no encoding"; a missing header means
        // the same thing in practice.
        None | Some("") | Some("identity") => {
            if raw.len() > max_document_bytes {
                return Err(ApiError::PayloadTooLarge(format!(
                    "Telemetry document is {} bytes, which exceeds the {max_document_bytes}-byte limit",
                    raw.len()
                )));
            }
            Ok(raw)
        }
        Some("gzip") | Some("x-gzip") => gunzip(raw, max_document_bytes),
        Some(other) => Err(ApiError::UnsupportedMediaType(format!(
            "Unsupported Content-Encoding '{other}'; telemetry uploads accept identity or gzip"
        ))),
    }
}

/// Inflate a gzip body, stopping one byte past the document limit.
fn gunzip(raw: Bytes, max_document_bytes: usize) -> Result<Bytes, ApiError> {
    let mut decoder = GzDecoder::new(raw.as_ref());
    let mut out: Vec<u8> = Vec::new();

    // Read one byte past the limit: if that byte arrives the document is
    // oversized, and the check costs a single byte rather than a full inflate.
    let mut limited = decoder.by_ref().take(max_document_bytes as u64 + 1);
    limited.read_to_end(&mut out).map_err(|error| {
        ApiError::BadRequest(format!("Telemetry body is not valid gzip: {error}"))
    })?;

    if out.len() > max_document_bytes {
        return Err(ApiError::PayloadTooLarge(format!(
            "Decompressed telemetry document exceeds the {max_document_bytes}-byte limit"
        )));
    }

    Ok(Bytes::from(out))
}

/// Extract and validate the caller's claims from the bearer token or the
/// access-token cookie.
async fn caller(req: &HttpRequest, jwt: &JwtService) -> Result<Claims, ApiError> {
    let token = req
        .headers()
        .get("Authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_owned)
        .or_else(|| {
            req.cookie(ACCESS_TOKEN_COOKIE)
                .map(|cookie| cookie.value().to_string())
        })
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))?;

    jwt.validate_token(&token)
        .await
        .map_err(crate::auth::middleware::api_error_for)
}

fn is_admin(claims: &Claims) -> bool {
    claims.roles.iter().any(|role| role == "admin")
}

fn assert_can_act_for(claims: &Claims, player_id: Uuid) -> Result<(), ApiError> {
    if claims.sub == player_id.to_string() || is_admin(claims) {
        Ok(())
    } else {
        Err(ApiError::forbidden(
            "You can only submit telemetry for yourself",
        ))
    }
}

/// POST /api/telemetry
async fn post_telemetry(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    service: web::Data<Arc<TelemetryUploadService>>,
    body: TelemetryBody,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    let request = body.into_request()?;
    assert_can_act_for(&claims, request.player_id)?;

    let outcome = service.upload(request).await?;
    Ok(HttpResponse::Ok().json(outcome))
}

/// GET /api/telemetry/{match_id}/players/{player_id}
async fn get_player_telemetry(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    service: web::Data<Arc<TelemetryUploadService>>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    let (match_id, player_id) = path.into_inner();
    assert_can_act_for(&claims, player_id)?;

    let reference = service.metadata(match_id, player_id).await?;
    Ok(HttpResponse::Ok().json(reference))
}

/// GET /api/telemetry/{match_id}
async fn get_match_telemetry(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    service: web::Data<Arc<TelemetryUploadService>>,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    if !is_admin(&claims) {
        return Err(ApiError::forbidden("Admin access required"));
    }

    let references = service.metadata_for_match(path.into_inner()).await?;
    Ok(HttpResponse::Ok().json(references))
}

/// Mounted inside the `/api` scope in `main.rs`.
pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/telemetry")
            // Upload limits for this scope only: the extractor reads them from
            // request app data, so no other route inherits them (#1529).
            .app_data(web::Data::new(TelemetryUploadLimits::from_env()))
            .route("", web::post().to(post_telemetry))
            .route("/{match_id}", web::get().to(get_match_telemetry))
            .route(
                "/{match_id}/players/{player_id}",
                web::get().to(get_player_telemetry),
            ),
    );
}

#[cfg(test)]
mod compression_tests {
    use super::*;
    use crate::models::telemetry::MAX_TELEMETRY_BYTES;
    use actix_web::ResponseError;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

    fn gzip(data: &[u8]) -> Bytes {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(data).expect("in-memory gzip write");
        Bytes::from(encoder.finish().expect("gzip finish"))
    }

    #[test]
    fn plain_bodies_pass_through_untouched() {
        let body = Bytes::from_static(br#"{"match_id":"x"}"#);

        let decoded = decode_body(body.clone(), None, MAX_TELEMETRY_BYTES).unwrap();

        assert_eq!(decoded, body);
    }

    #[test]
    fn identity_is_treated_as_no_encoding() {
        let body = Bytes::from_static(b"{}");

        assert_eq!(
            decode_body(body.clone(), Some("identity"), MAX_TELEMETRY_BYTES).unwrap(),
            body
        );
    }

    #[test]
    fn gzip_bodies_are_inflated_before_validation() {
        let json = br#"{"events":[]}"#;

        let decoded = decode_body(gzip(json), Some("gzip"), MAX_TELEMETRY_BYTES).unwrap();

        assert_eq!(&decoded[..], json);
    }

    #[test]
    fn unsupported_encodings_are_rejected_with_415() {
        let error = decode_body(Bytes::from_static(b"{}"), Some("br"), MAX_TELEMETRY_BYTES)
            .expect_err("brotli is not supported");

        assert!(matches!(error, ApiError::UnsupportedMediaType(_)));
        assert_eq!(error.error_response().status().as_u16(), 415);
    }

    #[test]
    fn corrupt_gzip_is_a_bad_request() {
        let error = decode_body(
            Bytes::from_static(b"not gzip at all"),
            Some("gzip"),
            MAX_TELEMETRY_BYTES,
        )
        .expect_err("garbage must not inflate");

        assert!(matches!(error, ApiError::BadRequest(_)));
        assert_eq!(error.error_response().status().as_u16(), 400);
    }

    #[test]
    fn a_document_that_inflates_past_the_limit_is_rejected_with_413() {
        // Highly compressible, so the compressed body is tiny while the
        // decompressed one is over the cap: the limit must be measured after
        // decompression, not on the wire.
        let payload = vec![b'a'; MAX_TELEMETRY_BYTES + 1];

        let error = decode_body(gzip(&payload), Some("gzip"), MAX_TELEMETRY_BYTES)
            .expect_err("oversized document");

        assert!(matches!(error, ApiError::PayloadTooLarge(_)));
        assert_eq!(error.error_response().status().as_u16(), 413);
    }

    #[test]
    fn an_oversized_plain_body_is_rejected_with_413() {
        let payload = Bytes::from(vec![b'a'; MAX_TELEMETRY_BYTES + 1]);

        let error = decode_body(payload, None, MAX_TELEMETRY_BYTES).expect_err("oversized document");

        assert!(matches!(error, ApiError::PayloadTooLarge(_)));
    }

    #[test]
    fn a_document_exactly_at_the_limit_is_accepted() {
        let payload = Bytes::from(vec![b'a'; MAX_TELEMETRY_BYTES]);

        let decoded = decode_body(payload, None, MAX_TELEMETRY_BYTES).unwrap();

        assert_eq!(decoded.len(), MAX_TELEMETRY_BYTES);
    }
}
