use crate::models::{StellarAccount, StellarTransaction};
use anyhow::Result;
use chrono::Utc;
use ed25519_dalek::{SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use redis::Client as RedisClient;
use sqlx::PgPool;
use std::sync::Arc;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum StellarError {
    #[error("Stellar account not found")]
    AccountNotFound,
    #[error("Insufficient XLM balance")]
    InsufficientBalance,
    #[error("Transaction failed: {0}")]
    TransactionFailed(String),
    #[error("Invalid public key")]
    InvalidPublicKey,
    #[error("Account not funded")]
    AccountNotFunded,
    #[error("Database error: {0}")]
    DatabaseError(#[from] sqlx::Error),
    #[error("Stellar SDK error: {0}")]
    StellarSdkError(String),
}

pub type DbPool = Arc<PgPool>;

#[derive(Clone)]
pub struct StellarService {
    db_pool: DbPool,
    redis_client: Option<Arc<RedisClient>>,
    horizon_url: String,
    network_passphrase: String,
    admin_secret: Option<String>,
}

impl StellarService {
    pub fn new(
        db_pool: DbPool,
        redis_client: Option<Arc<RedisClient>>,
        horizon_url: String,
        network_passphrase: String,
        admin_secret: Option<String>,
    ) -> Self {
        Self {
            db_pool,
            redis_client,
            horizon_url,
            network_passphrase,
            admin_secret,
        }
    }

    // ========================================================================
    // ACCOUNT MANAGEMENT
    // ========================================================================

    /// Create a new Stellar account for a user
    pub async fn create_stellar_account(
        &self,
        user_id: Uuid,
        account_type: &str,
    ) -> Result<StellarAccount, StellarError> {
        // Generate a new Stellar keypair
        let (public_key, secret_key) = self.generate_keypair()?;

        // Encrypt the secret key before storing
        let encrypted_secret = self.encrypt_secret_key(&secret_key)?;

        // Store in database
        let account = sqlx::query_as!(
            StellarAccount,
            r#"
            INSERT INTO stellar_accounts (
                id, user_id, public_key, encrypted_secret_key, account_type,
                is_funded, is_active, balance_xlm, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
            "#,
            Uuid::new_v4(),
            user_id,
            public_key,
            Some(encrypted_secret),
            account_type,
            false,
            true,
            0i64,
            Utc::now(),
            Utc::now()
        )
        .fetch_one(&*self.db_pool)
        .await?;

        tracing::info!(
            "Created Stellar account {} for user {}",
            public_key,
            user_id
        );

        Ok(account)
    }

    /// Get Stellar account by user ID
    pub async fn get_account(&self, user_id: Uuid) -> Result<StellarAccount, StellarError> {
        let account = sqlx::query_as!(
            StellarAccount,
            r#"
            SELECT * FROM stellar_accounts
            WHERE user_id = $1 AND is_active = true
            ORDER BY created_at DESC
            LIMIT 1
            "#,
            user_id
        )
        .fetch_optional(&*self.db_pool)
        .await?;

        account.ok_or(StellarError::AccountNotFound)
    }

    /// Get Stellar account by public key
    pub async fn get_account_by_public_key(
        &self,
        public_key: &str,
    ) -> Result<StellarAccount, StellarError> {
        let account = sqlx::query_as!(
            StellarAccount,
            r#"
            SELECT * FROM stellar_accounts
            WHERE public_key = $1
            "#,
            public_key
        )
        .fetch_optional(&*self.db_pool)
        .await?;

        account.ok_or(StellarError::AccountNotFound)
    }

    /// Fund a Stellar account.
    ///
    /// On testnet (`horizon_url` contains "testnet"), uses Friendbot to fund
    /// the account for free.  On mainnet, this method returns an error asking
    /// the caller to fund the account from the admin key via Horizon — the
    /// actual payment-operation submission is handled by the admin flow.
    pub async fn fund_account(
        &self,
        public_key: &str,
        amount: i64,
    ) -> Result<String, StellarError> {
        tracing::info!("Funding account {} with {} stroops", public_key, amount);

        let tx_hash = if self.horizon_url.contains("testnet") {
            // ----------------------------------------------------------------
            // Testnet: use Friendbot — no admin key required
            // ----------------------------------------------------------------
            let friendbot_url = format!(
                "https://friendbot.stellar.org?addr={}",
                urlencoding_encode(public_key)
            );
            let client = reqwest::Client::new();
            let response = client
                .get(&friendbot_url)
                .send()
                .await
                .map_err(|e| StellarError::TransactionFailed(e.to_string()))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(StellarError::TransactionFailed(format!(
                    "Friendbot returned {}: {}",
                    status, body
                )));
            }

            let body: serde_json::Value = response
                .json()
                .await
                .map_err(|e| StellarError::TransactionFailed(e.to_string()))?;

            body["hash"]
                .as_str()
                .unwrap_or("friendbot-tx")
                .to_string()
        } else {
            // ----------------------------------------------------------------
            // Mainnet / custom network: the admin must fund the account.
            // Full XDR-signed CreateAccount + Payment ops are outside the
            // scope of this service stub — return an actionable error so the
            // caller knows what to do.
            // ----------------------------------------------------------------
            return Err(StellarError::TransactionFailed(
                "Mainnet account funding requires submitting a CreateAccount \
                 operation from the admin account via Horizon. \
                 Ensure STELLAR_ADMIN_SECRET is set and implement the \
                 XDR transaction builder."
                    .to_string(),
            ));
        };

        // Mark account as funded in the database
        sqlx::query!(
            r#"
            UPDATE stellar_accounts
            SET is_funded = true, balance_xlm = $1, updated_at = $2
            WHERE public_key = $3
            "#,
            amount,
            Utc::now(),
            public_key
        )
        .execute(&*self.db_pool)
        .await?;

        Ok(tx_hash)
    }

    /// Update account balance
    pub async fn update_account_balance(
        &self,
        public_key: &str,
        balance_xlm: i64,
    ) -> Result<(), StellarError> {
        sqlx::query!(
            r#"
            UPDATE stellar_accounts
            SET balance_xlm = $1, updated_at = $2
            WHERE public_key = $3
            "#,
            balance_xlm,
            Utc::now(),
            public_key
        )
        .execute(&*self.db_pool)
        .await?;

        Ok(())
    }

    // ========================================================================
    // PRIZE POOL OPERATIONS
    // ========================================================================

    /// Create a prize pool account for a tournament
    pub async fn create_prize_pool_account(&self) -> Result<String, StellarError> {
        let tournament_id = Uuid::new_v4(); // This should be passed as parameter in real implementation

        // Create a new Stellar account for the prize pool
        let account = self
            .create_stellar_account(tournament_id, "prize_pool")
            .await?;

        // Fund the account with minimum balance (2 XLM in stroops)
        let min_balance = 20_000_000; // 2 XLM
        self.fund_account(&account.public_key, min_balance).await?;

        Ok(account.public_key)
    }

    /// Escrow entry fees to prize pool
    pub async fn escrow_entry_fees(
        &self,
        tournament_id: Uuid,
        prize_pool_account: &str,
        amount: i64,
    ) -> Result<String, StellarError> {
        // TODO: Implement actual Stellar payment transaction
        // This would:
        // 1. Get the admin account keypair
        // 2. Build a payment operation
        // 3. Sign and submit the transaction
        // 4. Record the transaction in the database

        tracing::info!(
            "Escrowing {} stroops to prize pool {} for tournament {}",
            amount,
            prize_pool_account,
            tournament_id
        );

        let tx_hash = format!("escrow-{}", Uuid::new_v4());

        // Record transaction
        self.record_transaction(
            &tx_hash,
            self.admin_secret.as_deref().unwrap_or("admin"),
            prize_pool_account,
            amount,
            "XLM",
            None,
            "payment",
            Some(format!("Entry fee escrow for tournament {}", tournament_id)),
            None,
        )
        .await?;

        Ok(tx_hash)
    }

    /// Distribute prizes to winners
    pub async fn distribute_prizes(
        &self,
        tournament_id: Uuid,
        prize_pool_account: &str,
        winners: Vec<(Uuid, i64)>, // (user_id, amount)
    ) -> Result<Vec<String>, StellarError> {
        let mut transaction_hashes = Vec::new();

        for (user_id, amount) in winners {
            // Get user's Stellar account
            let user_account = self.get_account(user_id).await?;

            // TODO: Implement actual Stellar payment
            // This would:
            // 1. Decrypt the prize pool secret key
            // 2. Build a payment operation
            // 3. Sign and submit the transaction

            tracing::info!(
                "Distributing {} stroops to user {} (account: {})",
                amount,
                user_id,
                user_account.public_key
            );

            let tx_hash = format!("prize-{}", Uuid::new_v4());

            // Record transaction
            self.record_transaction(
                &tx_hash,
                prize_pool_account,
                &user_account.public_key,
                amount,
                "XLM",
                None,
                "payment",
                Some(format!(
                    "Prize distribution for tournament {}",
                    tournament_id
                )),
                Some(user_id),
            )
            .await?;

            transaction_hashes.push(tx_hash);
        }

        Ok(transaction_hashes)
    }

    // ========================================================================
    // TOKEN OPERATIONS
    // ========================================================================

    /// Issue ArenaX token (one-time setup)
    pub async fn issue_arenax_token(&self) -> Result<(), StellarError> {
        // TODO: Implement token issuance
        // This would:
        // 1. Create issuing account
        // 2. Create distribution account
        // 3. Create trustline from distribution to issuing account
        // 4. Issue tokens from issuing to distribution account
        // 5. Lock issuing account

        tracing::info!("ArenaX token issuance not implemented yet");
        Ok(())
    }

    /// Transfer ArenaX tokens between accounts
    pub async fn transfer_tokens(
        &self,
        from_user_id: Uuid,
        to_public_key: &str,
        amount: i64,
    ) -> Result<String, StellarError> {
        // Get sender's account
        let from_account = self.get_account(from_user_id).await?;

        // TODO: Implement actual token transfer
        // This would:
        // 1. Decrypt sender's secret key
        // 2. Build a payment operation with asset type
        // 3. Sign and submit the transaction

        tracing::info!(
            "Transferring {} ArenaX tokens from {} to {}",
            amount,
            from_account.public_key,
            to_public_key
        );

        let tx_hash = format!("token-{}", Uuid::new_v4());

        // Record transaction
        self.record_transaction(
            &tx_hash,
            &from_account.public_key,
            to_public_key,
            amount,
            "ARENAX",
            Some("ISSUER_PUBLIC_KEY"), // Replace with actual issuer
            "payment",
            Some("ArenaX token transfer".to_string()),
            Some(from_user_id),
        )
        .await?;

        Ok(tx_hash)
    }

    // ========================================================================
    // TRANSACTION TRACKING
    // ========================================================================

    /// Record a Stellar transaction in the database
    pub async fn record_transaction(
        &self,
        tx_hash: &str,
        source_account: &str,
        destination_account: &str,
        amount: i64,
        asset_code: &str,
        asset_issuer: Option<&str>,
        operation_type: &str,
        memo: Option<String>,
        user_id: Option<Uuid>,
    ) -> Result<StellarTransaction, StellarError> {
        let transaction = sqlx::query_as!(
            StellarTransaction,
            r#"
            INSERT INTO stellar_transactions (
                id, user_id, transaction_hash, source_account, destination_account,
                amount, asset_code, asset_issuer, operation_type, memo,
                status, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
            "#,
            Uuid::new_v4(),
            user_id,
            tx_hash,
            source_account,
            destination_account,
            amount,
            asset_code,
            asset_issuer,
            operation_type,
            memo,
            "pending",
            Utc::now()
        )
        .fetch_one(&*self.db_pool)
        .await?;

        Ok(transaction)
    }

    /// Verify a Stellar transaction on the network
    pub async fn verify_transaction(&self, tx_hash: &str) -> Result<bool, StellarError> {
        // TODO: Implement actual verification by querying Horizon
        // let client = reqwest::Client::new();
        // let response = client
        //     .get(&format!("{}/transactions/{}", self.horizon_url, tx_hash))
        //     .send()
        //     .await
        //     .map_err(|e| StellarError::TransactionFailed(e.to_string()))?;

        // if response.status().is_success() {
        //     // Update transaction status in database
        //     sqlx::query!(
        //         r#"
        //         UPDATE stellar_transactions
        //         SET status = 'completed', completed_at = $1
        //         WHERE transaction_hash = $2
        //         "#,
        //         Utc::now(),
        //         tx_hash
        //     )
        //     .execute(&*self.db_pool)
        //     .await?;
        //     return Ok(true);
        // }

        tracing::warn!("Transaction verification not implemented, returning true");
        Ok(true)
    }

    /// Get transaction by hash
    pub async fn get_transaction(&self, tx_hash: &str) -> Result<StellarTransaction, StellarError> {
        let transaction = sqlx::query_as!(
            StellarTransaction,
            r#"
            SELECT * FROM stellar_transactions
            WHERE transaction_hash = $1
            "#,
            tx_hash
        )
        .fetch_optional(&*self.db_pool)
        .await?;

        transaction.ok_or(StellarError::TransactionFailed(
            "Transaction not found".to_string(),
        ))
    }

    // ========================================================================
    // HELPER FUNCTIONS
    // ========================================================================

    /// Generate a new Stellar keypair using ed25519-dalek.
    ///
    /// Returns `(public_key_strkey, secret_key_strkey)` in standard Stellar
    /// StrKey encoding (public key starts with `G`, secret key starts with `S`).
    fn generate_keypair(&self) -> Result<(String, String), StellarError> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key: VerifyingKey = signing_key.verifying_key();

        let public_key = stellar_strkey_encode(6 << 3, verifying_key.as_bytes())
            .map_err(|e| StellarError::StellarSdkError(e))?;
        let secret_key = stellar_strkey_encode(18 << 3, signing_key.as_bytes())
            .map_err(|e| StellarError::StellarSdkError(e))?;

        Ok((public_key, secret_key))
    }

    /// Encrypt a secret key for storage
    fn encrypt_secret_key(&self, secret_key: &str) -> Result<String, StellarError> {
        // TODO: Implement actual encryption using app secret
        // For now, just base64 encode (NOT SECURE - implement proper encryption)
        use base64::{engine::general_purpose, Engine as _};
        Ok(general_purpose::STANDARD.encode(secret_key))
    }

    /// Decrypt a secret key from storage
    fn decrypt_secret_key(&self, encrypted: &str) -> Result<String, StellarError> {
        // TODO: Implement actual decryption
        // For now, just base64 decode (NOT SECURE - implement proper decryption)
        use base64::{engine::general_purpose, Engine as _};
        general_purpose::STANDARD
            .decode(encrypted)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .ok_or(StellarError::InvalidPublicKey)
    }

    /// Convert XLM to stroops (1 XLM = 10,000,000 stroops)
    pub fn xlm_to_stroops(xlm: f64) -> i64 {
        (xlm * 10_000_000.0) as i64
    }

    /// Convert stroops to XLM
    pub fn stroops_to_xlm(stroops: i64) -> f64 {
        stroops as f64 / 10_000_000.0
    }
}

// ============================================================================
// Stellar StrKey encoding (RFC 4648 base32, no external dependency required)
// ============================================================================

/// Encode a raw 32-byte key as a Stellar StrKey.
///
/// `version_byte`:
///   - `6 << 3`  (= 0x30)  → public key  → starts with `G`
///   - `18 << 3` (= 0x90)  → secret key  → starts with `S`
///
/// The format is: base32( version_byte || payload || crc16(version_byte || payload) )
pub fn stellar_strkey_encode(version_byte: u8, payload: &[u8]) -> Result<String, String> {
    if payload.len() != 32 {
        return Err(format!(
            "stellar_strkey_encode: expected 32-byte payload, got {}",
            payload.len()
        ));
    }

    // Build the data to checksum: version_byte || payload
    let mut data = Vec::with_capacity(1 + payload.len());
    data.push(version_byte);
    data.extend_from_slice(payload);

    // CRC-16/XMODEM (initial value 0x0000, poly 0x1021, no reflection)
    let checksum = crc16_xmodem(&data);
    data.push((checksum & 0xFF) as u8);     // little-endian
    data.push((checksum >> 8) as u8);

    Ok(base32_encode(&data))
}

/// Decode a Stellar StrKey back to (version_byte, payload).
/// Returns an error if the checksum does not match.
pub fn stellar_strkey_decode(encoded: &str) -> Result<(u8, Vec<u8>), String> {
    let data = base32_decode(encoded)?;
    if data.len() < 3 {
        return Err("stellar_strkey_decode: encoded value too short".to_string());
    }

    let (payload_with_version, checksum_bytes) = data.split_at(data.len() - 2);
    let expected = crc16_xmodem(payload_with_version);
    let actual = (checksum_bytes[0] as u16) | ((checksum_bytes[1] as u16) << 8);
    if expected != actual {
        return Err(format!(
            "stellar_strkey_decode: checksum mismatch (expected {:#06x}, got {:#06x})",
            expected, actual
        ));
    }

    let version = payload_with_version[0];
    let payload = payload_with_version[1..].to_vec();
    Ok((version, payload))
}

/// Derive the Stellar public key StrKey from a secret key StrKey.
///
/// Decodes the ed25519 seed from the secret key, derives the verifying key,
/// and re-encodes it as a Stellar public key.
pub fn stellar_public_from_secret(secret_strkey: &str) -> Result<String, String> {
    let (version, seed_bytes) = stellar_strkey_decode(secret_strkey)?;
    if version != 18 << 3 {
        return Err(format!(
            "stellar_public_from_secret: expected secret key version {:#04x}, got {:#04x}",
            18u8 << 3,
            version
        ));
    }
    let seed: [u8; 32] = seed_bytes.try_into().map_err(|_| {
        "stellar_public_from_secret: seed must be 32 bytes".to_string()
    })?;
    let signing_key = ed25519_dalek::SigningKey::from_bytes(&seed);
    let verifying_key = signing_key.verifying_key();
    stellar_strkey_encode(6 << 3, verifying_key.as_bytes())
}

// ============================================================================
// Base32 (RFC 4648, uppercase, no padding) — used by Stellar StrKey
// ============================================================================

const BASE32_ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

fn base32_encode(data: &[u8]) -> String {
    let mut output = String::new();
    let mut buffer: u64 = 0;
    let mut bits_in_buffer: u32 = 0;

    for &byte in data {
        buffer = (buffer << 8) | (byte as u64);
        bits_in_buffer += 8;
        while bits_in_buffer >= 5 {
            bits_in_buffer -= 5;
            let index = ((buffer >> bits_in_buffer) & 0x1F) as usize;
            output.push(BASE32_ALPHABET[index] as char);
        }
    }
    // Remaining bits (left-aligned)
    if bits_in_buffer > 0 {
        let index = ((buffer << (5 - bits_in_buffer)) & 0x1F) as usize;
        output.push(BASE32_ALPHABET[index] as char);
    }
    output
}

fn base32_decode(encoded: &str) -> Result<Vec<u8>, String> {
    let mut buffer: u64 = 0;
    let mut bits_in_buffer: u32 = 0;
    let mut output = Vec::new();

    for ch in encoded.chars() {
        if ch == '=' {
            break; // ignore padding
        }
        let value = BASE32_ALPHABET
            .iter()
            .position(|&c| c == ch as u8)
            .ok_or_else(|| format!("base32_decode: invalid character '{}'", ch))?;
        buffer = (buffer << 5) | (value as u64);
        bits_in_buffer += 5;
        if bits_in_buffer >= 8 {
            bits_in_buffer -= 8;
            output.push((buffer >> bits_in_buffer) as u8 & 0xFF);
        }
    }
    Ok(output)
}

// ============================================================================
// CRC-16/XMODEM (poly 0x1021, initial value 0x0000, no input/output reflection)
// ============================================================================

fn crc16_xmodem(data: &[u8]) -> u16 {
    let mut crc: u16 = 0x0000;
    for &byte in data {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            if crc & 0x8000 != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

// ============================================================================
// Minimal percent-encoding for the public key in Friendbot URLs
// ============================================================================

fn urlencoding_encode(input: &str) -> String {
    let mut encoded = String::new();
    for byte in input.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{:02X}", byte));
        }
    }
    encoded
}

#[cfg(test)]
mod stellar_strkey_tests {
    use super::*;

    #[test]
    fn test_keypair_generates_valid_strkeys() {
        // Public key must start with 'G' and be 56 chars
        // Secret key must start with 'S' and be 56 chars
        let signing_key = ed25519_dalek::SigningKey::generate(&mut rand::rngs::OsRng);
        let verifying_key = signing_key.verifying_key();

        let pub_strkey = stellar_strkey_encode(6 << 3, verifying_key.as_bytes()).unwrap();
        let sec_strkey = stellar_strkey_encode(18 << 3, signing_key.as_bytes()).unwrap();

        assert_eq!(pub_strkey.len(), 56, "public key strkey must be 56 chars");
        assert!(pub_strkey.starts_with('G'), "public key must start with G");
        assert_eq!(sec_strkey.len(), 56, "secret key strkey must be 56 chars");
        assert!(sec_strkey.starts_with('S'), "secret key must start with S");
    }

    #[test]
    fn test_public_from_secret_roundtrip() {
        let signing_key = ed25519_dalek::SigningKey::generate(&mut rand::rngs::OsRng);
        let verifying_key = signing_key.verifying_key();

        let sec_strkey = stellar_strkey_encode(18 << 3, signing_key.as_bytes()).unwrap();
        let pub_strkey_direct = stellar_strkey_encode(6 << 3, verifying_key.as_bytes()).unwrap();
        let pub_strkey_derived = stellar_public_from_secret(&sec_strkey).unwrap();

        assert_eq!(
            pub_strkey_direct, pub_strkey_derived,
            "derived public key must match directly encoded public key"
        );
    }

    #[test]
    fn test_decode_roundtrip() {
        let payload = [0xABu8; 32];
        let encoded = stellar_strkey_encode(6 << 3, &payload).unwrap();
        let (version, decoded_payload) = stellar_strkey_decode(&encoded).unwrap();
        assert_eq!(version, 6 << 3);
        assert_eq!(decoded_payload, payload);
    }
}
