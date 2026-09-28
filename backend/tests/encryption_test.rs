use std::{sync::Arc, time::Instant};

#[path = "../src/security/encryption.rs"]
mod encryption;

use encryption::{
    EncryptedField, EncryptionAuditLogger, EncryptionError, EncryptionKey, EncryptionOperation,
    KeyRing, PiiDataProtector,
};

#[test]
fn test_aes_gcm_encryption_decryption_roundtrip() {
    let key_ring = Arc::new(KeyRing::new());
    let audit = Arc::new(EncryptionAuditLogger::new());
    let key = EncryptionKey::generate();
    key_ring.add_key("v1", key);

    let protector = PiiDataProtector::new(key_ring, audit);

    let sample_pii = "+1-555-867-5309";
    let envelope = protector
        .encrypt_str(sample_pii, "user.phone_number", Some("admin_user_99"))
        .expect("encryption succeeds");

    assert!(envelope.starts_with("enc:v1:"));
    assert!(envelope.contains('$'));

    let decrypted = protector
        .decrypt_str(&envelope, "user.phone_number", Some("admin_user_99"))
        .expect("decryption succeeds");

    assert_eq!(decrypted, sample_pii);
}

#[test]
fn test_key_rotation_multi_version_lifecycle() {
    let key_ring = Arc::new(KeyRing::new());
    let audit = Arc::new(EncryptionAuditLogger::new());

    let key_v1 = EncryptionKey::generate();
    let key_v2 = EncryptionKey::generate();
    let key_v3 = EncryptionKey::generate();

    key_ring.add_key("v1", key_v1);
    let protector = PiiDataProtector::new(key_ring.clone(), audit);

    // 1. Data encrypted under v1
    let original_data = "sensitive_device_fingerprint_xyz";
    let env_v1 = protector
        .encrypt_str(original_data, "user.device_fingerprint", None)
        .unwrap();
    assert!(env_v1.starts_with("enc:v1:"));

    // 2. Rotate to v2
    key_ring.rotate_key("v2", key_v2);

    // 3. New data encrypted under v2
    let new_data = "player_tax_id_9876";
    let env_v2 = protector
        .encrypt_str(new_data, "user.tax_id", None)
        .unwrap();
    assert!(env_v2.starts_with("enc:v2:"));

    // 4. Transparent decryption of both v1 and v2
    assert_eq!(
        protector.decrypt_str(&env_v1, "user.device_fingerprint", None).unwrap(),
        original_data
    );
    assert_eq!(
        protector.decrypt_str(&env_v2, "user.tax_id", None).unwrap(),
        new_data
    );

    // 5. Rotate to v3 and re-encrypt older record
    key_ring.rotate_key("v3", key_v3);
    let env_v3 = protector.reencrypt(&env_v1, "user.device_fingerprint", None).unwrap();
    assert!(env_v3.starts_with("enc:v3:"));
    assert_eq!(
        protector.decrypt_str(&env_v3, "user.device_fingerprint", None).unwrap(),
        original_data
    );
}

#[test]
fn test_tamper_proofing_and_authentication_tag_validation() {
    let key_ring = Arc::new(KeyRing::new());
    let audit = Arc::new(EncryptionAuditLogger::new());
    key_ring.add_key("v1", EncryptionKey::generate());

    let protector = PiiDataProtector::new(key_ring, audit);
    let envelope = protector
        .encrypt_str("critical_wallet_key_data", "stellar.secret", None)
        .unwrap();

    // Modify a single character in ciphertext
    let mut bytes = envelope.into_bytes();
    let len = bytes.len();
    bytes[len - 2] = if bytes[len - 2] == b'0' { b'1' } else { b'0' };
    let corrupted_envelope = String::from_utf8(bytes).unwrap();

    let result = protector.decrypt_str(&corrupted_envelope, "stellar.secret", None);
    assert_eq!(result, Err(EncryptionError::DecryptionFailed));
}

#[test]
fn test_audit_trail_captures_all_events() {
    let key_ring = Arc::new(KeyRing::new());
    let audit = Arc::new(EncryptionAuditLogger::new());
    key_ring.add_key("v1", EncryptionKey::generate());

    let event_log = Arc::new(std::sync::Mutex::new(Vec::new()));
    let event_log_clone = event_log.clone();

    audit.register_callback(Box::new(move |evt| {
        let mut list = event_log_clone.lock().unwrap();
        list.push(evt.clone());
    }));

    let protector = PiiDataProtector::new(key_ring, audit);

    // Encrypt event
    let env = protector
        .encrypt_str("user@example.com", "user.email", Some("operator_1"))
        .unwrap();

    // Decrypt event
    let _ = protector
        .decrypt_str(&env, "user.email", Some("operator_1"))
        .unwrap();

    // Failed decrypt event (tampered)
    let _ = protector.decrypt_str("enc:v1:000000000000000000000000$ffffffff", "user.email", Some("operator_1"));

    let events = event_log.lock().unwrap();
    assert_eq!(events.len(), 3);
    assert_eq!(events[0].operation, EncryptionOperation::Encrypt);
    assert_eq!(events[0].actor_id.as_deref(), Some("operator_1"));
    assert_eq!(events[0].field_name, "user.email");

    assert_eq!(events[1].operation, EncryptionOperation::Decrypt);
    assert_eq!(events[1].status, "SUCCESS");

    assert_eq!(events[2].operation, EncryptionOperation::DecryptFailed);
}

#[test]
fn test_encrypted_field_serde_and_redaction() {
    let original_secret = "confidential_player_contact".to_string();
    let field = EncryptedField::encrypt_new(
        original_secret.clone(),
        "player.contact",
        Some("test_user"),
    )
    .unwrap();

    // Redaction in Debug & Display
    assert_eq!(format!("{:?}", field), "EncryptedField([REDACTED_PII])");
    assert_eq!(format!("{}", field), "[REDACTED_PII]");

    // JSON serialization outputs ciphertext envelope, NOT plaintext
    let serialized_json = serde_json::to_string(&field).unwrap();
    assert!(!serialized_json.contains(&original_secret));
    assert!(serialized_json.starts_with("\"enc:"));

    // JSON deserialization reconstructs EncryptedField
    let mut deserialized: EncryptedField<String> =
        serde_json::from_str(&serialized_json).unwrap();
    assert_eq!(
        deserialized.expose_secret("player.contact", Some("test_user")).unwrap(),
        original_secret
    );
}

#[test]
fn test_performance_overhead_is_minimal() {
    let key_ring = Arc::new(KeyRing::new());
    let audit = Arc::new(EncryptionAuditLogger::new());
    key_ring.add_key("v1", EncryptionKey::generate());
    let protector = PiiDataProtector::new(key_ring, audit);

    let iterations = 10_000;
    let sample = "player_email_for_performance_benchmarking@arenax.gg";

    let start_enc = Instant::now();
    let mut envelopes = Vec::with_capacity(iterations);
    for _ in 0..iterations {
        envelopes.push(protector.encrypt_str(sample, "user.email", None).unwrap());
    }
    let elapsed_enc = start_enc.elapsed();
    let avg_enc_micros = elapsed_enc.as_micros() as f64 / iterations as f64;

    let start_dec = Instant::now();
    for env in envelopes.iter() {
        let _ = protector.decrypt_str(env, "user.email", None).unwrap();
    }
    let elapsed_dec = start_dec.elapsed();
    let avg_dec_micros = elapsed_dec.as_micros() as f64 / iterations as f64;

    println!(
        "Encryption benchmark: {} iterations in {:?}, avg: {:.2} µs/op",
        iterations, elapsed_enc, avg_enc_micros
    );
    println!(
        "Decryption benchmark: {} iterations in {:?}, avg: {:.2} µs/op",
        iterations, elapsed_dec, avg_dec_micros
    );

    // In release mode this is typically 2-10 µs; in unoptimized debug test runs < 500 µs (0.5 ms)
    assert!(avg_enc_micros < 500.0, "Encryption is slower than expected: {:.2} µs", avg_enc_micros);
    assert!(avg_dec_micros < 500.0, "Decryption is slower than expected: {:.2} µs", avg_dec_micros);
}
