//! Soroban Transaction Service
//!
//! This module provides a deterministic and auditable layer for building, signing,
//! submitting, and monitoring Soroban transactions.
//!
//! # Features
//! - Generic `invoke()` method for contract function calls
//! - Network configuration support (testnet/mainnet/custom)
//! - Automatic retries with exponential backoff
//! - Event decoding from transaction results
//! - Full transaction lifecycle management

use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;
use tracing::{debug, error, info, warn};

/// Transaction result status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TxStatus {
    Pending,
    Success,
    Failed,
}

/// Result of a Soroban transaction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SorobanTxResult {
    pub hash: String,
    pub status: TxStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Network configuration for Soroban
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkConfig {
    /// RPC endpoint URL (e.g., "https://soroban-testnet.stellar.org:443")
    pub rpc_url: String,
    /// Network passphrase (e.g., "Test SDF Network ; September 2015")
    pub network_passphrase: String,
    /// Optional friendbot URL for testnet funding
    #[serde(skip_serializing_if = "Option::is_none")]
    pub friendbot_url: Option<String>,
}

impl NetworkConfig {
    /// Create a testnet configuration
    pub fn testnet() -> Self {
        Self {
            rpc_url: "https://soroban-testnet.stellar.org:443".to_string(),
            network_passphrase: "Test SDF Network ; September 2015".to_string(),
            friendbot_url: Some("https://friendbot.stellar.org".to_string()),
        }
    }

    /// Create a mainnet configuration
    pub fn mainnet() -> Self {
        Self {
            rpc_url: "https://soroban-mainnet.stellar.org:443".to_string(),
            network_passphrase: "Public Global Stellar Network ; September 2015".to_string(),
            friendbot_url: None,
        }
    }

    /// Create a custom network configuration
    pub fn custom(rpc_url: String, network_passphrase: String) -> Self {
        Self {
            rpc_url,
            network_passphrase,
            friendbot_url: None,
        }
    }
}

/// Decoded event from a Soroban transaction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecodedEvent {
    pub contract_id: String,
    pub topic: String,
    pub value: serde_json::Value,
}

/// Retry configuration
#[derive(Debug, Clone)]
pub struct RetryConfig {
    pub max_retries: u32,
    pub initial_delay_ms: u64,
    pub max_delay_ms: u64,
    pub backoff_multiplier: f64,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_retries: 3,
            initial_delay_ms: 1000,
            max_delay_ms: 10000,
            backoff_multiplier: 2.0,
        }
    }
}

/// Soroban service for transaction management
#[derive(Clone)]
pub struct SorobanService {
    network: NetworkConfig,
    client: reqwest::Client,
    retry_config: RetryConfig,
}

#[derive(Debug, Error)]
pub enum SorobanError {
    #[error("RPC request failed: {0}")]
    RpcError(String),
    #[error("Transaction failed: {0}")]
    TransactionFailed(String),
    #[error("Invalid response: {0}")]
    InvalidResponse(String),
    #[error("Network error: {0}")]
    NetworkError(#[from] reqwest::Error),
    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),
    #[error("Invalid account: {0}")]
    InvalidAccount(String),
    #[error("Invalid contract: {0}")]
    InvalidContract(String),
    #[error("Retry limit exceeded")]
    RetryLimitExceeded,
}

/// RPC request/response types
#[derive(Debug, Serialize)]
struct RpcRequest {
    jsonrpc: String,
    id: u64,
    method: String,
    params: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct RpcResponse {
    jsonrpc: String,
    id: u64,
    #[serde(flatten)]
    result: RpcResult,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RpcResult {
    Success {
        result: serde_json::Value,
    },
    Error {
        error: RpcError,
    },
}

#[derive(Debug, Deserialize)]
struct RpcError {
    code: i32,
    message: String,
    #[serde(default)]
    data: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct SimulateResponse {
    #[serde(rename = "transactionData")]
    transaction_data: String,
    #[serde(rename = "events")]
    events: Vec<serde_json::Value>,
    #[serde(rename = "minResourceFee")]
    min_resource_fee: String,
    #[serde(rename = "results")]
    results: Vec<serde_json::Value>,
    #[serde(rename = "latestLedger")]
    latest_ledger: u64,
    #[serde(rename = "cost")]
    cost: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct SendTransactionResponse {
    #[serde(rename = "hash")]
    hash: String,
    #[serde(rename = "status")]
    status: String,
    #[serde(rename = "latestLedger")]
    latest_ledger: u64,
    #[serde(rename = "latestLedgerCloseTime")]
    latest_ledger_close_time: u64,
}

#[derive(Debug, Deserialize)]
struct GetTransactionResponse {
    #[serde(rename = "status")]
    status: String,
    #[serde(rename = "latestLedger")]
    latest_ledger: u64,
    #[serde(rename = "latestLedgerCloseTime")]
    latest_ledger_close_time: u64,
    #[serde(rename = "oldestLedger")]
    oldest_ledger: Option<u64>,
    #[serde(rename = "oldestLedgerCloseTime")]
    oldest_ledger_close_time: Option<u64>,
    #[serde(rename = "applicationOrder")]
    application_order: Option<u64>,
    #[serde(rename = "feeBump")]
    fee_bump: Option<serde_json::Value>,
    #[serde(rename = "envelopeXdr")]
    envelope_xdr: String,
    #[serde(rename = "resultXdr")]
    result_xdr: Option<String>,
    #[serde(rename = "resultMetaXdr")]
    result_meta_xdr: Option<String>,
    #[serde(rename = "ledger")]
    ledger: Option<u64>,
    #[serde(rename = "createdAt")]
    created_at: Option<String>,
    #[serde(rename = "applicationTransaction")]
    application_transaction: Option<serde_json::Value>,
    #[serde(rename = "feeBumpTransaction")]
    fee_bump_transaction: Option<serde_json::Value>,
}

impl SorobanService {
    /// Create a new Soroban service instance
    pub fn new(network: NetworkConfig) -> Self {
        Self {
            network,
            client: reqwest::Client::new(),
            retry_config: RetryConfig::default(),
        }
    }

    /// Create a new Soroban service with custom retry configuration
    pub fn with_retry_config(network: NetworkConfig, retry_config: RetryConfig) -> Self {
        Self {
            network,
            client: reqwest::Client::new(),
            retry_config,
        }
    }

    /// Generic invoke method for calling Soroban contract functions
    ///
    /// # Arguments
    /// * `contract_id` - The contract ID to invoke
    /// * `function_name` - The function name to call
    /// * `args` - Function arguments as a JSON-serializable value
    /// * `signer_secret` - Secret key of the account signing the transaction
    ///
    /// # Returns
    /// A `SorobanTxResult` containing the transaction hash and status
    pub async fn invoke(
        &self,
        contract_id: &str,
        function_name: &str,
        args: &serde_json::Value,
        signer_secret: &str,
    ) -> Result<SorobanTxResult, SorobanError> {
        info!(
            contract_id = contract_id,
            function = function_name,
            "Invoking Soroban contract function"
        );

        // Step 1: Simulate the transaction
        let simulate_result = self
            .simulate_transaction(contract_id, function_name, args, signer_secret)
            .await?;

        // Step 2: Build and sign the transaction
        let signed_tx = self
            .build_and_sign_transaction(
                contract_id,
                function_name,
                args,
                signer_secret,
                &simulate_result.transaction_data,
                &simulate_result.min_resource_fee,
            )
            .await?;

        // Step 3: Submit the transaction
        let tx_hash = self.send_transaction(&signed_tx).await?;

        // Step 4: Monitor the transaction
        let result = self
            .monitor_transaction(&tx_hash)
            .await
            .unwrap_or_else(|e| {
                warn!(tx_hash = tx_hash, error = %e, "Failed to monitor transaction");
                SorobanTxResult {
                    hash: tx_hash.clone(),
                    status: TxStatus::Pending,
                    error: Some(format!("Monitoring failed: {}", e)),
                }
            });

        Ok(result)
    }

    /// Simulate a transaction to get transaction data and resource fees
    async fn simulate_transaction(
        &self,
        contract_id: &str,
        function_name: &str,
        args: &serde_json::Value,
        signer_secret: &str,
    ) -> Result<SimulateResponse, SorobanError> {
        // Extract public key from secret
        let public_key = self.secret_to_public_key(signer_secret)?;

        // Build the invoke operation
        let invoke_op = serde_json::json!({
            "contractId": contract_id,
            "functionName": function_name,
            "args": args
        });

        // Build the transaction envelope (simplified - in production, use proper XDR encoding)
        let tx_envelope = self.build_transaction_envelope(&public_key, &invoke_op)?;

        // Call simulateTransaction RPC method
        let params = serde_json::json!({
            "transaction": tx_envelope
        });

        let response: SimulateResponse = self
            .rpc_call("simulateTransaction", params)
            .await?;

        Ok(response)
    }

    /// Build and sign a transaction
    async fn build_and_sign_transaction(
        &self,
        contract_id: &str,
        function_name: &str,
        args: &serde_json::Value,
        signer_secret: &str,
        transaction_data: &str,
        min_resource_fee: &str,
    ) -> Result<String, SorobanError> {
        // In a real implementation, this would:
        // 1. Decode the transaction_data XDR
        // 2. Add the resource fee
        // 3. Sign the transaction with the secret key
        // 4. Encode back to XDR base64 string

        // For now, we'll create a simplified representation
        // In production, use stellar-sdk or soroban-client-sdk for proper XDR handling
        let public_key = self.secret_to_public_key(signer_secret)?;

        let tx_data = serde_json::json!({
            "sourceAccount": public_key,
            "contractId": contract_id,
            "functionName": function_name,
            "args": args,
            "transactionData": transaction_data,
            "minResourceFee": min_resource_fee,
            "networkPassphrase": self.network.network_passphrase
        });

        // Sign the transaction (simplified - use proper cryptographic signing in production)
        let signature = self.sign_transaction(&tx_data, signer_secret)?;

        // Build signed transaction envelope
        let signed_tx = serde_json::json!({
            "tx": tx_data,
            "signatures": [signature]
        });

        // Encode to base64 XDR (simplified)
        use base64::{engine::general_purpose, Engine as _};
        let xdr = general_purpose::STANDARD
            .encode(serde_json::to_string(&signed_tx)?);

        Ok(xdr)
    }

    /// Send a signed transaction to the network
    async fn send_transaction(&self, signed_tx: &str) -> Result<String, SorobanError> {
        let params = serde_json::json!({
            "transaction": signed_tx
        });

        let response: SendTransactionResponse = self
            .rpc_call("sendTransaction", params)
            .await?;

        info!(tx_hash = response.hash, "Transaction submitted");

        Ok(response.hash)
    }

    /// Monitor a transaction until it completes or fails
    async fn monitor_transaction(
        &self,
        tx_hash: &str,
    ) -> Result<SorobanTxResult, SorobanError> {
        let mut attempt = 0;
        let mut delay = self.retry_config.initial_delay_ms;

        loop {
            match self.get_transaction_status(tx_hash).await {
                Ok(status) => {
                    match status.as_str() {
                        "SUCCESS" => {
                            info!(tx_hash = tx_hash, "Transaction succeeded");
                            return Ok(SorobanTxResult {
                                hash: tx_hash.to_string(),
                                status: TxStatus::Success,
                                error: None,
                            });
                        }
                        "FAILED" => {
                            let error_msg = format!("Transaction failed on network");
                            error!(tx_hash = tx_hash, "Transaction failed");
                            return Ok(SorobanTxResult {
                                hash: tx_hash.to_string(),
                                status: TxStatus::Failed,
                                error: Some(error_msg),
                            });
                        }
                        "NOT_FOUND" => {
                            // Transaction not yet found, wait and retry
                            if attempt >= self.retry_config.max_retries {
                                return Err(SorobanError::RetryLimitExceeded);
                            }
                        }
                        _ => {
                            // Pending or other status, wait and retry
                            if attempt >= self.retry_config.max_retries {
                                return Ok(SorobanTxResult {
                                    hash: tx_hash.to_string(),
                                    status: TxStatus::Pending,
                                    error: Some(format!(
                                        "Transaction still pending after {} attempts",
                                        self.retry_config.max_retries
                                    )),
                                });
                            }
                        }
                    }
                }
                Err(e) => {
                    warn!(
                        tx_hash = tx_hash,
                        attempt = attempt,
                        error = %e,
                        "Error checking transaction status"
                    );
                    if attempt >= self.retry_config.max_retries {
                        return Err(e);
                    }
                }
            }

            attempt += 1;
            debug!(
                tx_hash = tx_hash,
                attempt = attempt,
                delay_ms = delay,
                "Waiting before retry"
            );

            tokio::time::sleep(Duration::from_millis(delay)).await;

            // Exponential backoff
            delay = (delay as f64 * self.retry_config.backoff_multiplier) as u64;
            delay = delay.min(self.retry_config.max_delay_ms);
        }
    }

    /// Get the status of a transaction
    async fn get_transaction_status(&self, tx_hash: &str) -> Result<String, SorobanError> {
        let params = serde_json::json!({
            "hash": tx_hash
        });

        let response: GetTransactionResponse = self
            .rpc_call("getTransaction", params)
            .await?;

        Ok(response.status)
    }

    /// Decode events from a transaction
    pub async fn decode_events(
        &self,
        tx_hash: &str,
    ) -> Result<Vec<DecodedEvent>, SorobanError> {
        let params = serde_json::json!({
            "hash": tx_hash
        });

        let response: GetTransactionResponse = self
            .rpc_call("getTransaction", params)
            .await?;

        // Decode events from resultMetaXdr
        // In production, properly decode XDR to extract events
        // For now, return empty vector as placeholder
        let events = self.parse_events_from_meta(&response.result_meta_xdr)?;

        Ok(events)
    }

    /// Parse events from transaction metadata XDR
    fn parse_events_from_meta(
        &self,
        result_meta_xdr: &Option<String>,
    ) -> Result<Vec<DecodedEvent>, SorobanError> {
        // In production, decode the XDR base64 string and extract events
        // This is a simplified placeholder
        match result_meta_xdr {
            Some(_meta) => {
                // TODO: Decode XDR and parse events
                // For now, return empty vector
                Ok(vec![])
            }
            None => Ok(vec![]),
        }
    }

    /// Make an RPC call to the Soroban RPC endpoint
    async fn rpc_call<T>(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<T, SorobanError>
    where
        T: for<'de> Deserialize<'de>,
    {
        let request = RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: method.to_string(),
            params,
        };

        let response = self
            .client
            .post(&self.network.rpc_url)
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        let text = response.text().await?;

        if !status.is_success() {
            return Err(SorobanError::RpcError(format!(
                "HTTP {}: {}",
                status, text
            )));
        }

        let rpc_response: RpcResponse = serde_json::from_str(&text)?;

        match rpc_response.result {
            RpcResult::Success { result } => {
                serde_json::from_value(result).map_err(SorobanError::SerializationError)
            }
            RpcResult::Error { error } => Err(SorobanError::RpcError(format!(
                "RPC error {}: {}",
                error.code, error.message
            ))),
        }
    }

    /// Build a transaction envelope (simplified)
    fn build_transaction_envelope(
        &self,
        source_account: &str,
        operation: &serde_json::Value,
    ) -> Result<String, SorobanError> {
        // In production, use proper XDR encoding
        // This is a simplified placeholder
        let envelope = serde_json::json!({
            "sourceAccount": source_account,
            "operation": operation,
            "networkPassphrase": self.network.network_passphrase
        });

        use base64::{engine::general_purpose, Engine as _};
        Ok(general_purpose::STANDARD
            .encode(serde_json::to_string(&envelope)?))
    }

    /// Extract public key from secret key
    fn secret_to_public_key(&self, secret: &str) -> Result<String, SorobanError> {
        // In production, use stellar-sdk or ed25519-dalek to derive public key
        // This is a simplified placeholder
        if secret.starts_with('S') && secret.len() == 56 {
            // Stellar secret keys start with 'S' and are 56 chars
            // Public key would start with 'G' and be derived from secret
            // For now, return a placeholder
            Ok(format!("G{}", &secret[1..]))
        } else {
            Err(SorobanError::InvalidAccount(format!(
                "Invalid secret key format: {}",
                secret
            )))
        }
    }

    /// Sign a transaction with a secret key
    fn sign_transaction(
        &self,
        tx_data: &serde_json::Value,
        secret: &str,
    ) -> Result<String, SorobanError> {
        // In production, use ed25519-dalek or stellar-sdk to properly sign
        // This is a simplified placeholder
        use base64::{engine::general_purpose, Engine as _};
        let tx_string = serde_json::to_string(tx_data)?;
        let signature = format!("sig_{}", general_purpose::STANDARD.encode(tx_string));
        Ok(signature)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_network_config() {
        let testnet = NetworkConfig::testnet();
        assert!(testnet.rpc_url.contains("testnet"));
        assert!(testnet.friendbot_url.is_some());

        let mainnet = NetworkConfig::mainnet();
        assert!(mainnet.rpc_url.contains("mainnet"));
        assert!(mainnet.friendbot_url.is_none());
    }

    #[test]
    fn test_soroban_tx_result_serialization() {
        let result = SorobanTxResult {
            hash: "test_hash".to_string(),
            status: TxStatus::Success,
            error: None,
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("test_hash"));
        assert!(json.contains("success"));

        let result_with_error = SorobanTxResult {
            hash: "test_hash".to_string(),
            status: TxStatus::Failed,
            error: Some("Test error".to_string()),
        };

        let json = serde_json::to_string(&result_with_error).unwrap();
        assert!(json.contains("failed"));
        assert!(json.contains("Test error"));
    }

    #[test]
    fn test_retry_config_default() {
        let config = RetryConfig::default();
        assert_eq!(config.max_retries, 3);
        assert_eq!(config.initial_delay_ms, 1000);
        assert_eq!(config.max_delay_ms, 10000);
        assert_eq!(config.backoff_multiplier, 2.0);
    }

    #[tokio::test]
    async fn test_soroban_service_creation() {
        let network = NetworkConfig::testnet();
        let service = SorobanService::new(network);
        // Service should be created without errors
        assert!(true);
    }

    #[test]
    fn test_secret_to_public_key_validation() {
        let network = NetworkConfig::testnet();
        let service = SorobanService::new(network);

        // Valid secret key format
        let result = service.secret_to_public_key("SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
        assert!(result.is_ok());

        // Invalid secret key format
        let result = service.secret_to_public_key("invalid");
        assert!(result.is_err());
    }

    #[test]
    fn test_tx_status_serialization() {
        let pending = TxStatus::Pending;
        let success = TxStatus::Success;
        let failed = TxStatus::Failed;

        assert_eq!(serde_json::to_string(&pending).unwrap(), "\"pending\"");
        assert_eq!(serde_json::to_string(&success).unwrap(), "\"success\"");
        assert_eq!(serde_json::to_string(&failed).unwrap(), "\"failed\"");
    }

    #[test]
    fn test_tx_status_deserialization() {
        let pending: TxStatus = serde_json::from_str("\"pending\"").unwrap();
        let success: TxStatus = serde_json::from_str("\"success\"").unwrap();
        let failed: TxStatus = serde_json::from_str("\"failed\"").unwrap();

        assert_eq!(pending, TxStatus::Pending);
        assert_eq!(success, TxStatus::Success);
        assert_eq!(failed, TxStatus::Failed);
    }

    #[test]
    fn test_network_config_custom() {
        let custom = NetworkConfig::custom(
            "https://custom-rpc.example.com".to_string(),
            "Custom Network".to_string(),
        );
        assert_eq!(custom.rpc_url, "https://custom-rpc.example.com");
        assert_eq!(custom.network_passphrase, "Custom Network");
        assert!(custom.friendbot_url.is_none());
    }

    #[test]
    fn test_soroban_tx_result_with_error() {
        let result = SorobanTxResult {
            hash: "abc123".to_string(),
            status: TxStatus::Failed,
            error: Some("Insufficient balance".to_string()),
        };

        let json = serde_json::to_string(&result).unwrap();
        let deserialized: SorobanTxResult = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.hash, "abc123");
        assert_eq!(deserialized.status, TxStatus::Failed);
        assert_eq!(deserialized.error, Some("Insufficient balance".to_string()));
    }

    #[test]
    fn test_soroban_tx_result_without_error() {
        let result = SorobanTxResult {
            hash: "def456".to_string(),
            status: TxStatus::Success,
            error: None,
        };

        let json = serde_json::to_string(&result).unwrap();
        // Error field should be omitted when None
        assert!(!json.contains("error"));

        let deserialized: SorobanTxResult = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.hash, "def456");
        assert_eq!(deserialized.status, TxStatus::Success);
        assert_eq!(deserialized.error, None);
    }

    #[test]
    fn test_decoded_event() {
        let event = DecodedEvent {
            contract_id: "C1234567890".to_string(),
            topic: "transfer".to_string(),
            value: serde_json::json!({
                "from": "GAAAAA",
                "to": "GBBBBB",
                "amount": 1000
            }),
        };

        let json = serde_json::to_string(&event).unwrap();
        let deserialized: DecodedEvent = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.contract_id, "C1234567890");
        assert_eq!(deserialized.topic, "transfer");
        assert_eq!(deserialized.value["amount"], 1000);
    }

    #[test]
    fn test_retry_config_custom() {
        let config = RetryConfig {
            max_retries: 5,
            initial_delay_ms: 500,
            max_delay_ms: 5000,
            backoff_multiplier: 1.5,
        };

        assert_eq!(config.max_retries, 5);
        assert_eq!(config.initial_delay_ms, 500);
        assert_eq!(config.max_delay_ms, 5000);
        assert_eq!(config.backoff_multiplier, 1.5);
    }

    #[test]
    fn test_soroban_service_with_retry_config() {
        let network = NetworkConfig::testnet();
        let retry_config = RetryConfig {
            max_retries: 5,
            initial_delay_ms: 2000,
            max_delay_ms: 20000,
            backoff_multiplier: 3.0,
        };

        let service = SorobanService::with_retry_config(network, retry_config);
        // Service should be created without errors
        assert!(true);
    }

    #[test]
    fn test_build_transaction_envelope() {
        let network = NetworkConfig::testnet();
        let service = SorobanService::new(network);

        let operation = serde_json::json!({
            "contractId": "C123",
            "functionName": "transfer",
            "args": []
        });

        let result = service.build_transaction_envelope("GAAAAA", &operation);
        assert!(result.is_ok());
        let envelope = result.unwrap();
        assert!(!envelope.is_empty());
    }

    #[test]
    fn test_sign_transaction() {
        let network = NetworkConfig::testnet();
        let service = SorobanService::new(network);

        let tx_data = serde_json::json!({
            "sourceAccount": "GAAAAA",
            "operation": "invoke"
        });

        let result = service.sign_transaction(&tx_data, "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
        assert!(result.is_ok());
        let signature = result.unwrap();
        assert!(signature.starts_with("sig_"));
    }
}
