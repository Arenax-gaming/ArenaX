//! Tamper-evident dispute evidence storage — Issues #1081, #1076.
//!
//! A player's dispute screenshot is validated (size, declared content type,
//! and magic bytes) and hashed with SHA-256 *before* it is written to
//! object storage. The hash is persisted in `match_disputes` alongside the
//! S3 key, so anyone can later re-download the object, re-hash it, and
//! compare: a mismatch means the stored file was swapped after the fact.

use crate::api_error::ApiError;
use crate::config::StorageConfig;
use chrono::Utc;
use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Actix `PayloadConfig` limit for evidence uploads (#1076).
pub const MAX_EVIDENCE_BYTES: usize = 5 * 1024 * 1024;

pub const ALLOWED_CONTENT_TYPES: &[&str] = &["image/png", "image/jpeg", "image/webp"];

fn base_content_type(content_type: &str) -> &str {
    content_type.split(';').next().unwrap_or("").trim()
}

/// Reject anything but the three supported image types (#1076).
pub fn validate_content_type(content_type: &str) -> Result<(), ApiError> {
    if ALLOWED_CONTENT_TYPES.contains(&base_content_type(content_type)) {
        Ok(())
    } else {
        Err(ApiError::ValidationError(format!(
            "Unsupported content type '{}'; expected one of: {}",
            base_content_type(content_type),
            ALLOWED_CONTENT_TYPES.join(", ")
        )))
    }
}

/// Reject a payload larger than [`MAX_EVIDENCE_BYTES`]. Actix's
/// `PayloadConfig` limit (wired in `main.rs`) rejects the connection outright
/// for a body that large; this is a defense-in-depth check for callers that
/// buffer the body themselves.
pub fn validate_evidence_size(len: usize) -> Result<(), ApiError> {
    if len > MAX_EVIDENCE_BYTES {
        Err(ApiError::ValidationError(format!(
            "Evidence file is {len} bytes, which exceeds the {MAX_EVIDENCE_BYTES}-byte limit"
        )))
    } else {
        Ok(())
    }
}

/// Verify the file's magic bytes match the declared `Content-Type` (#1076) —
/// stops e.g. a PDF renamed to `evidence.png` from being accepted on the
/// header alone.
pub fn validate_magic_bytes(content_type: &str, bytes: &[u8]) -> Result<(), ApiError> {
    let matches = match base_content_type(content_type) {
        "image/png" => bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        "image/jpeg" => bytes.len() >= 3 && bytes[0..3] == [0xFF, 0xD8, 0xFF],
        "image/webp" => {
            bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
        }
        _ => false,
    };
    if matches {
        Ok(())
    } else {
        Err(ApiError::ValidationError(
            "File contents do not match the declared content type".to_string(),
        ))
    }
}

/// SHA-256 hex digest of the raw evidence bytes (#1081). Stored in
/// `match_disputes.evidence_hash` and returned from `GET .../dispute` so a
/// player can independently verify their upload was not tampered with.
pub fn hash_evidence(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn extension_for(content_type: &str) -> &'static str {
    match base_content_type(content_type) {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => "bin",
    }
}

/// S3 object key namespaced `{user_id}/{match_id}/{hash}.{ext}` (#1076) —
/// scoping by user and match rules out path traversal or one player
/// overwriting another's evidence, and keying by hash makes a duplicate
/// upload of the same bytes idempotent.
pub fn evidence_object_key(user_id: Uuid, match_id: Uuid, content_type: &str, hash_hex: &str) -> String {
    format!(
        "{user_id}/{match_id}/{hash_hex}.{}",
        extension_for(content_type)
    )
}

// ─── Object storage ────────────────────────────────────────────────────────

/// Abstraction over "put these bytes at this key" so the upload handler and
/// its tests do not depend on a live S3/MinIO endpoint.
#[async_trait::async_trait]
pub trait EvidenceStore: Send + Sync {
    async fn put(&self, key: &str, content_type: &str, bytes: &[u8]) -> Result<(), ApiError>;
}

/// Real S3/MinIO-compatible store: a single-shot `PUT` signed with AWS
/// SigV4, built from the `sha2`/`reqwest` crates already used elsewhere in
/// this backend so no new dependency is needed for signing.
pub struct S3EvidenceStore {
    endpoint: String,
    region: String,
    bucket: String,
    access_key: String,
    secret_key: String,
    http: reqwest::Client,
}

impl S3EvidenceStore {
    pub fn new(config: &StorageConfig) -> Self {
        Self {
            endpoint: config.s3_endpoint.trim_end_matches('/').to_string(),
            // Not present in `StorageConfig` today; every deployment target
            // for this project (MinIO, AWS in af-south-1 mirrors) accepts
            // "us-east-1" as the SigV4 region for path-style requests.
            region: "us-east-1".to_string(),
            bucket: config.s3_bucket.clone(),
            access_key: config.s3_access_key.clone(),
            secret_key: config.s3_secret_key.clone(),
            http: reqwest::Client::new(),
        }
    }
}

#[async_trait::async_trait]
impl EvidenceStore for S3EvidenceStore {
    async fn put(&self, key: &str, content_type: &str, bytes: &[u8]) -> Result<(), ApiError> {
        let url = format!("{}/{}/{}", self.endpoint, self.bucket, key);
        let host = url
            .split("//")
            .nth(1)
            .and_then(|rest| rest.split('/').next())
            .unwrap_or_default()
            .to_string();

        let now = Utc::now();
        let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
        let date_stamp = now.format("%Y%m%d").to_string();
        let payload_hash = hex::encode(Sha256::digest(bytes));

        let canonical_headers = format!(
            "host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
        );
        let signed_headers = "host;x-amz-content-sha256;x-amz-date";
        let canonical_request = format!(
            "PUT\n/{}/{}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}",
            self.bucket, key
        );
        let credential_scope = format!("{date_stamp}/{}/s3/aws4_request", self.region);
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n{}",
            hex::encode(Sha256::digest(canonical_request.as_bytes()))
        );
        let signing_key = derive_signing_key(&self.secret_key, &date_stamp, &self.region, "s3");
        let signature = hex::encode(hmac_sha256(&signing_key, string_to_sign.as_bytes()));

        let authorization = format!(
            "AWS4-HMAC-SHA256 Credential={}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}",
            self.access_key
        );

        let response = self
            .http
            .put(&url)
            .header("host", host)
            .header("x-amz-content-sha256", payload_hash)
            .header("x-amz-date", amz_date)
            .header("Authorization", authorization)
            .header("Content-Type", content_type)
            .body(bytes.to_vec())
            .send()
            .await
            .map_err(|e| ApiError::ServiceUnavailable(format!("Evidence storage upload failed: {e}")))?;

        if !response.status().is_success() {
            return Err(ApiError::ServiceUnavailable(format!(
                "Evidence storage rejected upload with status {}",
                response.status()
            )));
        }
        Ok(())
    }
}

fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK_SIZE: usize = 64;
    let mut key_block = [0u8; BLOCK_SIZE];
    if key.len() > BLOCK_SIZE {
        let hashed = Sha256::digest(key);
        key_block[..32].copy_from_slice(&hashed);
    } else {
        key_block[..key.len()].copy_from_slice(key);
    }

    let mut ipad = [0x36u8; BLOCK_SIZE];
    let mut opad = [0x5cu8; BLOCK_SIZE];
    for i in 0..BLOCK_SIZE {
        ipad[i] ^= key_block[i];
        opad[i] ^= key_block[i];
    }

    let mut inner = Sha256::new();
    inner.update(ipad);
    inner.update(message);
    let inner_hash = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(opad);
    outer.update(inner_hash);
    outer.finalize().into()
}

fn derive_signing_key(secret: &str, date_stamp: &str, region: &str, service: &str) -> [u8; 32] {
    let k_date = hmac_sha256(format!("AWS4{secret}").as_bytes(), date_stamp.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    hmac_sha256(&k_service, b"aws4_request")
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG_MAGIC: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    #[test]
    fn accepts_allowed_content_types_only() {
        assert!(validate_content_type("image/png").is_ok());
        assert!(validate_content_type("image/jpeg").is_ok());
        assert!(validate_content_type("image/webp").is_ok());
        assert!(validate_content_type("application/pdf").is_err());
    }

    #[test]
    fn rejects_oversized_payload() {
        assert!(validate_evidence_size(MAX_EVIDENCE_BYTES).is_ok());
        assert!(validate_evidence_size(MAX_EVIDENCE_BYTES + 1).is_err());
    }

    #[test]
    fn magic_bytes_must_match_declared_type() {
        let mut png_bytes = PNG_MAGIC.to_vec();
        png_bytes.extend_from_slice(b"rest of file");
        assert!(validate_magic_bytes("image/png", &png_bytes).is_ok());

        // A PDF (`%PDF`) renamed to declare image/png must be rejected.
        let fake = b"%PDF-1.4 not actually a png".to_vec();
        assert!(validate_magic_bytes("image/png", &fake).is_err());
    }

    #[test]
    fn hash_is_deterministic_and_detects_tampering() {
        let original = b"screenshot-bytes-v1".to_vec();
        let tampered = b"screenshot-bytes-v2".to_vec();

        let hash_a = hash_evidence(&original);
        let hash_b = hash_evidence(&original);
        assert_eq!(hash_a, hash_b, "re-hashing identical bytes must match");

        let hash_tampered = hash_evidence(&tampered);
        assert_ne!(
            hash_a, hash_tampered,
            "re-hashing a modified file must produce a different digest"
        );
    }

    #[test]
    fn object_key_is_namespaced_by_user_and_match() {
        let user_id = Uuid::from_u128(1);
        let match_id = Uuid::from_u128(2);
        let key = evidence_object_key(user_id, match_id, "image/png", "abc123");
        assert_eq!(key, format!("{user_id}/{match_id}/abc123.png"));
    }

    struct InMemoryStore {
        objects: std::sync::Mutex<std::collections::HashMap<String, Vec<u8>>>,
    }

    #[async_trait::async_trait]
    impl EvidenceStore for InMemoryStore {
        async fn put(&self, key: &str, _content_type: &str, bytes: &[u8]) -> Result<(), ApiError> {
            self.objects
                .lock()
                .unwrap()
                .insert(key.to_string(), bytes.to_vec());
            Ok(())
        }
    }

    #[tokio::test]
    async fn upload_then_rehash_detects_tamper_in_store() {
        let store = InMemoryStore {
            objects: std::sync::Mutex::new(std::collections::HashMap::new()),
        };
        let user_id = Uuid::from_u128(1);
        let match_id = Uuid::from_u128(2);
        let bytes = {
            let mut v = PNG_MAGIC.to_vec();
            v.extend_from_slice(b"original evidence");
            v
        };
        let hash_at_upload = hash_evidence(&bytes);
        let key = evidence_object_key(user_id, match_id, "image/png", &hash_at_upload);
        store.put(&key, "image/png", &bytes).await.unwrap();

        // Honest re-read: hash still matches.
        let stored = store.objects.lock().unwrap().get(&key).cloned().unwrap();
        assert_eq!(hash_evidence(&stored), hash_at_upload);

        // Simulate an admin swapping the S3 object in place.
        store
            .objects
            .lock()
            .unwrap()
            .insert(key.clone(), b"replaced file contents".to_vec());
        let tampered = store.objects.lock().unwrap().get(&key).cloned().unwrap();
        assert_ne!(
            hash_evidence(&tampered),
            hash_at_upload,
            "tamper must be detectable by re-hashing"
        );
    }
}
