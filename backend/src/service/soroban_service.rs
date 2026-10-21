//! Soroban Transaction Service
//!
//! This module provides a deterministic and auditable layer for building, signing,
//! submitting, and monitoring Soroban transactions.
//!
//! # Features
//! - Generic `invoke()` method for contract function calls
//! - Network configuration support (testnet/mainnet/custom)
//! - Automatic retries with exponential backoff and jitter
//! - Idempotent, exactly-once submission keyed by an idempotency key (#1345)
//! - Event decoding from transaction results
//! - Full transaction lifecycle management

use crate::service::idempotency_service::{
    ReserveOutcome, SubmissionRecord, SubmissionStatus, SubmissionStore, SubmissionStoreError,
    SUBMISSION_RESERVATION_LEASE_SECS,
};
use crate::transaction::BackoffPolicy;
use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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

/// Result of gas estimation
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GasEstimationResult {
    pub cpu_instructions: u64,
    pub memory_bytes: u64,
    pub min_resource_fee: String,
}

/// Retry configuration
#[derive(Debug, Clone)]
pub struct RetryConfig {
    pub max_retries: u32,
    pub initial_delay_ms: u64,
    pub max_delay_ms: u64,
    pub backoff_multiplier: f64,
    /// Fraction (0.0–1.0) of each backoff delay that is randomised, so many
    /// clients retrying after the same outage don't hit the RPC in lock-step.
    pub jitter: f64,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_retries: 3,
            initial_delay_ms: 1000,
            max_delay_ms: 10000,
            backoff_multiplier: 2.0,
            jitter: 0.5,
        }
    }
}

impl RetryConfig {
    /// The equivalent [`BackoffPolicy`].
    pub fn backoff(&self) -> BackoffPolicy {
        BackoffPolicy {
            max_retries: self.max_retries,
            initial_delay: Duration::from_millis(self.initial_delay_ms),
            max_delay: Duration::from_millis(self.max_delay_ms),
            multiplier: self.backoff_multiplier,
            jitter: self.jitter,
        }
    }
}

// =============================================================================
// IDEMPOTENT SUBMISSION (Issue #1345)
// =============================================================================

/// A contract invocation to submit exactly once.
#[derive(Clone)]
pub struct SorobanInvocation {
    pub contract_id: String,
    pub function_name: String,
    pub args: serde_json::Value,
    pub signer_secret: String,
}

impl std::fmt::Debug for SorobanInvocation {
    // Never print the signer secret.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SorobanInvocation")
            .field("contract_id", &self.contract_id)
            .field("function_name", &self.function_name)
            .field("args", &self.args)
            .finish_non_exhaustive()
    }
}

impl SorobanInvocation {
    /// Fingerprint of the request (not the signer), used to reject reuse of
    /// an idempotency key for a different payload.
    pub fn request_hash(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.contract_id.as_bytes());
        hasher.update(b"\n");
        hasher.update(self.function_name.as_bytes());
        hasher.update(b"\n");
        hasher.update(self.args.to_string().as_bytes());
        hex::encode(hasher.finalize())
    }
}

/// A signed transaction that has not necessarily been sent yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedTx {
    pub hash: String,
    pub envelope: String,
}

/// The network-facing steps of a submission, abstracted so the idempotent
/// retry loop can run against the real RPC or a simulated network in tests.
pub trait SubmissionBackend: Send + Sync {
    /// Simulate, build and sign — no network side effects.
    fn prepare<'a>(
        &'a self,
        invocation: &'a SorobanInvocation,
    ) -> BoxFuture<'a, Result<PreparedTx, SorobanError>>;

    /// Final on-ledger result for `tx_hash`, or `None` if the network has not
    /// applied it (unknown or still pending).
    fn lookup<'a>(
        &'a self,
        tx_hash: &'a str,
    ) -> BoxFuture<'a, Result<Option<SorobanTxResult>, SorobanError>>;

    /// Send the signed envelope; returns the hash the network assigned.
    fn send<'a>(&'a self, prepared: &'a PreparedTx) -> BoxFuture<'a, Result<String, SorobanError>>;

    /// Wait for the transaction to reach a final state.
    fn await_result<'a>(
        &'a self,
        tx_hash: &'a str,
    ) -> BoxFuture<'a, Result<SorobanTxResult, SorobanError>>;
}

impl SorobanError {
    /// Whether retrying the same submission may succeed (network blips, RPC
    /// overload, results not yet visible) as opposed to a permanent rejection.
    pub fn is_transient(&self) -> bool {
        matches!(
            self,
            SorobanError::RpcError(_)
                | SorobanError::NetworkError(_)
                | SorobanError::RetryLimitExceeded
        )
    }
}

impl From<SubmissionStoreError> for SorobanError {
    fn from(err: SubmissionStoreError) -> Self {
        match err {
            SubmissionStoreError::PayloadMismatch(key) => SorobanError::IdempotencyConflict(key),
            other => SorobanError::Idempotency(other.to_string()),
        }
    }
}

fn stored_result(record: &SubmissionRecord) -> Result<SorobanTxResult, SorobanError> {
    let value = record.result.clone().ok_or_else(|| {
        SorobanError::Idempotency(format!(
            "submission '{}' is {} but has no stored result",
            record.idempotency_key,
            record.status.as_str()
        ))
    })?;
    Ok(serde_json::from_value(value)?)
}

async fn finish(
    store: &dyn SubmissionStore,
    key: &str,
    result: SorobanTxResult,
) -> Result<SorobanTxResult, SorobanError> {
    let status = match result.status {
        TxStatus::Failed => SubmissionStatus::Failed,
        _ => SubmissionStatus::Completed,
    };
    store
        .mark_finished(key, status, &serde_json::to_value(&result)?)
        .await?;
    // Another worker may have finished first; its result is authoritative.
    match store.get(key).await? {
        Some(record) if record.result.is_some() => stored_result(&record),
        _ => Ok(result),
    }
}

/// Submit `invocation` at most once per `idempotency_key`, retrying transient
/// failures with exponential backoff and jitter.
///
/// 1. The key is persisted (`reserved`) before anything touches the network.
///    A key that already has a terminal result returns that result without
///    re-executing; a key reused for a different payload is rejected.
/// 2. The transaction is signed and its envelope + hash persisted (`signed`)
///    *before* the first send.
/// 3. Every attempt first looks the hash up on the ledger and only re-sends
///    the identical envelope when the network has not applied it, so a lost
///    response (mid-flight failure) never produces a second execution.
/// 4. The final result is persisted (`completed` / `failed`).
///
/// If retries are exhausted the key stays `signed`; calling again with the
/// same key resumes from step 3.
pub async fn submit_idempotent(
    store: &dyn SubmissionStore,
    backend: &dyn SubmissionBackend,
    policy: &BackoffPolicy,
    idempotency_key: &str,
    invocation: &SorobanInvocation,
) -> Result<SorobanTxResult, SorobanError> {
    let request_hash = invocation.request_hash();

    let record = match store.reserve(idempotency_key, &request_hash).await? {
        ReserveOutcome::Reserved(record) => record,
        ReserveOutcome::Existing(record) => {
            if record.status.is_terminal() {
                info!(
                    idempotency_key,
                    status = record.status.as_str(),
                    "Duplicate Soroban submission; returning original result"
                );
                return stored_result(&record);
            }
            let lease_active = record.status == SubmissionStatus::Reserved
                && chrono::Utc::now().signed_duration_since(record.updated_at)
                    < chrono::Duration::seconds(SUBMISSION_RESERVATION_LEASE_SECS);
            if lease_active {
                return Err(SorobanError::SubmissionInProgress(idempotency_key.to_string()));
            }
            record
        }
    };

    // Reuse the persisted envelope when resuming so a retry can only ever
    // re-send the transaction that may already be on the ledger.
    let mut prepared = match (record.tx_hash, record.signed_envelope) {
        (Some(hash), Some(envelope)) => PreparedTx { hash, envelope },
        _ => {
            let prepared = backend.prepare(invocation).await?;
            store
                .mark_signed(idempotency_key, &prepared.hash, &prepared.envelope)
                .await?;
            prepared
        }
    };

    let contract = invocation.contract_id.as_str();
    let method = invocation.function_name.as_str();
    let mut attempt: u32 = 0;
    loop {
        let outcome: Result<SorobanTxResult, SorobanError> = async {
            // Check stored/network status before (re-)submitting.
            if let Some(result) = backend.lookup(&prepared.hash).await? {
                debug!(tx_hash = %prepared.hash, "Transaction already applied; not re-sending");
                return Ok(result);
            }

            store.record_attempt(idempotency_key).await?;
            let network_hash = backend.send(&prepared).await?;
            log_soroban_event(SorobanEventStatus::Submit, &network_hash, contract, method);
            if network_hash != prepared.hash {
                store
                    .mark_signed(idempotency_key, &network_hash, &prepared.envelope)
                    .await?;
                prepared.hash = network_hash;
            }

            let result = backend.await_result(&prepared.hash).await?;
            if result.status == TxStatus::Pending {
                return Err(SorobanError::RetryLimitExceeded);
            }
            Ok::<_, SorobanError>(result)
        }
        .await;

        match outcome {
            Ok(result) => return finish(store, idempotency_key, result).await,
            Err(e) if e.is_transient() && attempt < policy.max_retries => {
                let delay = policy.delay_for(attempt);
                attempt += 1;
                log_soroban_event(SorobanEventStatus::Retry, &prepared.hash, contract, method);
                warn!(
                    idempotency_key,
                    tx_hash = %prepared.hash,
                    attempt,
                    delay_ms = delay.as_millis() as u64,
                    error = %e,
                    "Transient Soroban submission failure; retrying"
                );
                tokio::time::sleep(delay).await;
            }
            Err(e) if e.is_transient() => {
                // Leave the key `signed`: a later call resumes safely.
                log_soroban_event(SorobanEventStatus::Dlq, &prepared.hash, contract, method);
                return Err(e);
            }
            Err(e) => {
                // Permanent rejection: record it so duplicates get the same answer.
                log_soroban_event(SorobanEventStatus::Dlq, &prepared.hash, contract, method);
                let failed = SorobanTxResult {
                    hash: prepared.hash.clone(),
                    status: TxStatus::Failed,
                    error: Some(e.to_string()),
                };
                return finish(store, idempotency_key, failed).await;
            }
        }
    }
}

/// [`SubmissionBackend`] over a live Soroban RPC endpoint.
struct RpcSubmissionBackend<'s> {
    service: &'s SorobanService,
    contract_id: &'s str,
    function_name: &'s str,
}

impl SubmissionBackend for RpcSubmissionBackend<'_> {
    fn prepare<'a>(
        &'a self,
        invocation: &'a SorobanInvocation,
    ) -> BoxFuture<'a, Result<PreparedTx, SorobanError>> {
        Box::pin(async move {
            let simulated = self
                .service
                .simulate_transaction(
                    &invocation.contract_id,
                    &invocation.function_name,
                    &invocation.args,
                    &invocation.signer_secret,
                )
                .await?;
            let envelope = self
                .service
                .build_and_sign_transaction(
                    &invocation.contract_id,
                    &invocation.function_name,
                    &invocation.args,
                    &invocation.signer_secret,
                    &simulated.transaction_data,
                    &simulated.min_resource_fee,
                )
                .await?;
            let hash = hex::encode(Sha256::digest(envelope.as_bytes()));
            Ok(PreparedTx { hash, envelope })
        })
    }

    fn lookup<'a>(
        &'a self,
        tx_hash: &'a str,
    ) -> BoxFuture<'a, Result<Option<SorobanTxResult>, SorobanError>> {
        Box::pin(async move {
            // Deserialize loosely: NOT_FOUND responses omit most fields.
            let response: serde_json::Value = self
                .service
                .rpc_call("getTransaction", serde_json::json!({ "hash": tx_hash }))
                .await?;
            let status = match response.get("status").and_then(|s| s.as_str()) {
                Some("SUCCESS") => TxStatus::Success,
                Some("FAILED") => TxStatus::Failed,
                _ => return Ok(None),
            };
            Ok(Some(SorobanTxResult {
                hash: tx_hash.to_string(),
                status,
                error: (status == TxStatus::Failed)
                    .then(|| "Transaction failed on network".to_string()),
            }))
        })
    }

    fn send<'a>(&'a self, prepared: &'a PreparedTx) -> BoxFuture<'a, Result<String, SorobanError>> {
        Box::pin(async move {
            let response: serde_json::Value = self
                .service
                .rpc_call(
                    "sendTransaction",
                    serde_json::json!({ "transaction": prepared.envelope }),
                )
                .await?;
            let hash = response
                .get("hash")
                .and_then(|h| h.as_str())
                .unwrap_or(&prepared.hash)
                .to_string();
            match response.get("status").and_then(|s| s.as_str()) {
                // DUPLICATE: the identical envelope is already known — not an error.
                Some("PENDING") | Some("DUPLICATE") | None => Ok(hash),
                Some("TRY_AGAIN_LATER") => {
                    Err(SorobanError::RpcError("RPC asked to try again later".to_string()))
                }
                Some(other) => Err(SorobanError::TransactionFailed(format!(
                    "sendTransaction returned {}",
                    other
                ))),
            }
        })
    }

    fn await_result<'a>(
        &'a self,
        tx_hash: &'a str,
    ) -> BoxFuture<'a, Result<SorobanTxResult, SorobanError>> {
        Box::pin(self.service.monitor_transaction(tx_hash, self.contract_id, self.function_name))
    }
}

/// Lifecycle stage of a structured Soroban transaction log line (#1106).
/// `correlation_id` isn't a field here — it's already on the ambient
/// `http.request` tracing span and captured by any subscriber walking the
/// span stack. Never pass a signer secret through here — only identifiers.
#[derive(Debug, Clone, Copy)]
enum SorobanEventStatus {
    Submit,
    Confirm,
    Retry,
    Dlq,
}

impl SorobanEventStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Submit => "submit",
            Self::Confirm => "confirm",
            Self::Retry => "retry",
            Self::Dlq => "dlq",
        }
    }
}

fn log_soroban_event(status: SorobanEventStatus, tx_hash: &str, contract: &str, method: &str) {
    let status_str = status.as_str();
    match status {
        SorobanEventStatus::Submit | SorobanEventStatus::Confirm => {
            info!(tx_hash, contract, method, status = status_str, "Soroban transaction event");
        }
        SorobanEventStatus::Retry => {
            warn!(tx_hash, contract, method, status = status_str, "Soroban transaction retry");
        }
        SorobanEventStatus::Dlq => {
            error!(tx_hash, contract, method, status = status_str, "Soroban transaction moved to dead-letter queue");
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
    #[error("Idempotency key '{0}' was already used with a different payload")]
    IdempotencyConflict(String),
    #[error("Submission for idempotency key '{0}' is already in progress")]
    SubmissionInProgress(String),
    #[error("Idempotency store error: {0}")]
    Idempotency(String),
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
    Success { result: serde_json::Value },
    Error { error: RpcError },
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

    /// Return the network configuration (e.g., to inspect the friendbot URL).
    pub fn network(&self) -> &NetworkConfig {
        &self.network
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

        // Prometheus (#1070): every invocation counts as one submission and
        // ends in exactly one of success (with latency) or failed{reason}.
        crate::metrics::record_soroban_submitted(contract_id, function_name);
        let started = std::time::Instant::now();
        let fail = |reason: &str| {
            crate::metrics::record_soroban_failed(contract_id, function_name, reason)
        };

        // Step 1: Simulate the transaction
        let simulate_result = self
            .simulate_transaction(contract_id, function_name, args, signer_secret)
            .await
            .inspect_err(|_| fail("simulation"))?;

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
            .await
            .inspect_err(|_| fail("build"))?;

        // Step 3: Submit the transaction
        let tx_hash = self.send_transaction(&signed_tx).await?;
        log_soroban_event(SorobanEventStatus::Submit, &tx_hash, contract_id, function_name);

        // Step 4: Monitor the transaction
        let result = self
            .monitor_transaction(&tx_hash, contract_id, function_name)
            .await
            .unwrap_or_else(|e| {
                log_soroban_event(SorobanEventStatus::Dlq, &tx_hash, contract_id, function_name);
                warn!(tx_hash = tx_hash, error = %e, "Failed to monitor transaction");
                fail("monitor_error");
                SorobanTxResult {
                    hash: tx_hash.clone(),
                    status: TxStatus::Pending,
                    error: Some(format!("Monitoring failed: {}", e)),
                }
            });

        Ok(result)
    }

    /// Invoke a contract function exactly once per `idempotency_key`.
    ///
    /// Safe to call repeatedly (client retries, worker restarts): see
    /// [`submit_idempotent`] for the guarantees. Use
    /// [`crate::service::idempotency_service::PgSubmissionStore`] in production
    /// so keys survive restarts.
    pub async fn invoke_idempotent(
        &self,
        store: &dyn SubmissionStore,
        idempotency_key: &str,
        contract_id: &str,
        function_name: &str,
        args: &serde_json::Value,
        signer_secret: &str,
    ) -> Result<SorobanTxResult, SorobanError> {
        crate::metrics::record_soroban_submitted(contract_id, function_name);
        let invocation = SorobanInvocation {
            contract_id: contract_id.to_string(),
            function_name: function_name.to_string(),
            args: args.clone(),
            signer_secret: signer_secret.to_string(),
        };
        let backend = RpcSubmissionBackend {
            service: self,
            contract_id,
            function_name,
        };
        submit_idempotent(
            store,
            &backend,
            &self.retry_config.backoff(),
            idempotency_key,
            &invocation,
        )
        .await
        .inspect_err(|_| {
            crate::metrics::record_soroban_failed(contract_id, function_name, "idempotent_submit")
        })
    }

    /// Estimate gas costs for a transaction pre-execution
    pub async fn estimate_gas(
        &self,
        contract_id: &str,
        function_name: &str,
        args: &serde_json::Value,
        signer_secret: &str,
    ) -> Result<GasEstimationResult, SorobanError> {
        let simulate_result = self
            .simulate_transaction(contract_id, function_name, args, signer_secret)
            .await?;

        let mut cpu_instructions = 0;
        let mut memory_bytes = 0;

        if let Some(cost) = simulate_result.cost {
            if let Some(cpu) = cost.get("cpuInsns") {
                if let Some(cpu_val) = cpu.as_str() {
                    cpu_instructions = cpu_val.parse().unwrap_or(0);
                } else if let Some(cpu_val) = cpu.as_u64() {
                    cpu_instructions = cpu_val;
                }
            }
            if let Some(mem) = cost.get("memBytes") {
                if let Some(mem_val) = mem.as_str() {
                    memory_bytes = mem_val.parse().unwrap_or(0);
                } else if let Some(mem_val) = mem.as_u64() {
                    memory_bytes = mem_val;
                }
            }
        }

        Ok(GasEstimationResult {
            cpu_instructions,
            memory_bytes,
            min_resource_fee: simulate_result.min_resource_fee,
        })
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

        let response: SimulateResponse = self.rpc_call("simulateTransaction", params).await?;

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
        let xdr = general_purpose::STANDARD.encode(serde_json::to_string(&signed_tx)?);

        Ok(xdr)
    }

    /// Send a signed transaction to the network
    async fn send_transaction(&self, signed_tx: &str) -> Result<String, SorobanError> {
        let params = serde_json::json!({
            "transaction": signed_tx
        });

        let response: SendTransactionResponse = self.rpc_call("sendTransaction", params).await?;

        info!(tx_hash = response.hash, "Transaction submitted");

        Ok(response.hash)
    }

    /// Monitor a transaction until it completes or fails
    async fn monitor_transaction(
        &self,
        tx_hash: &str,
        contract_id: &str,
        function_name: &str,
    ) -> Result<SorobanTxResult, SorobanError> {
        let mut attempt = 0;
        let backoff = self.retry_config.backoff();

        loop {
            match self.get_transaction_status(tx_hash).await {
                Ok(status) => {
                    match status.as_str() {
                        "SUCCESS" => {
                            log_soroban_event(SorobanEventStatus::Confirm, tx_hash, contract_id, function_name);
                            return Ok(SorobanTxResult {
                                hash: tx_hash.to_string(),
                                status: TxStatus::Success,
                                error: None,
                            });
                        }
                        "FAILED" => {
                            let error_msg = format!("Transaction failed on network");
                            log_soroban_event(SorobanEventStatus::Dlq, tx_hash, contract_id, function_name);
                            return Ok(SorobanTxResult {
                                hash: tx_hash.to_string(),
                                status: TxStatus::Failed,
                                error: Some(error_msg),
                            });
                        }
                        "NOT_FOUND" => {
                            // Transaction not yet found, wait and retry
                            if attempt >= self.retry_config.max_retries {
                                log_soroban_event(SorobanEventStatus::Dlq, tx_hash, contract_id, function_name);
                                return Err(SorobanError::RetryLimitExceeded);
                            }
                        }
                        _ => {
                            // Pending or other status, wait and retry
                            if attempt >= self.retry_config.max_retries {
                                log_soroban_event(SorobanEventStatus::Dlq, tx_hash, contract_id, function_name);
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
                        log_soroban_event(SorobanEventStatus::Dlq, tx_hash, contract_id, function_name);
                        return Err(e);
                    }
                }
            }

            // Exponential backoff with jitter
            let delay = backoff.delay_for(attempt);
            attempt += 1;
            log_soroban_event(SorobanEventStatus::Retry, tx_hash, contract_id, function_name);
            debug!(
                tx_hash = tx_hash,
                attempt = attempt,
                delay_ms = delay.as_millis() as u64,
                "Waiting before retry"
            );

            tokio::time::sleep(delay).await;
        }
    }

    /// Get the status of a transaction
    async fn get_transaction_status(&self, tx_hash: &str) -> Result<String, SorobanError> {
        let params = serde_json::json!({
            "hash": tx_hash
        });

        let response: GetTransactionResponse = self.rpc_call("getTransaction", params).await?;

        Ok(response.status)
    }

    /// Decode events from a transaction
    pub async fn decode_events(&self, tx_hash: &str) -> Result<Vec<DecodedEvent>, SorobanError> {
        let params = serde_json::json!({
            "hash": tx_hash
        });

        let response: GetTransactionResponse = self.rpc_call("getTransaction", params).await?;

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
    async fn rpc_call<T>(&self, method: &str, params: serde_json::Value) -> Result<T, SorobanError>
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
            return Err(SorobanError::RpcError(format!("HTTP {}: {}", status, text)));
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
        Ok(general_purpose::STANDARD.encode(serde_json::to_string(&envelope)?))
    }

    /// Extract public key from secret key using real ed25519 derivation.
    fn secret_to_public_key(&self, secret: &str) -> Result<String, SorobanError> {
        crate::service::stellar_service::stellar_public_from_secret(secret)
            .map_err(|e| SorobanError::InvalidAccount(e))
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
        let result =
            service.secret_to_public_key("SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
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
            jitter: 0.0,
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
            jitter: 0.5,
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

        let result = service.sign_transaction(
            &tx_data,
            "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        );
        assert!(result.is_ok());
        let signature = result.unwrap();
        assert!(signature.starts_with("sig_"));
    }

    #[test]
    fn test_gas_estimation_result_serialization() {
        let estimation = GasEstimationResult {
            cpu_instructions: 1500000,
            memory_bytes: 45000,
            min_resource_fee: "100".to_string(),
        };

        let json = serde_json::to_string(&estimation).unwrap();
        assert!(json.contains("cpu_instructions"));
        assert!(json.contains("memory_bytes"));
        assert!(json.contains("min_resource_fee"));

        let deserialized: GasEstimationResult = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.cpu_instructions, 1500000);
        assert_eq!(deserialized.memory_bytes, 45000);
        assert_eq!(deserialized.min_resource_fee, "100");
    }
}

/// Exactly-once submission tests against a simulated network (Issue #1345).
#[cfg(test)]
mod idempotent_submission_tests {
    use super::*;
    use crate::service::idempotency_service::InMemorySubmissionStore;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Mutex;

    /// A fake ledger. Applying the same envelope twice is a no-op, like the
    /// real network (the source sequence number is consumed on first apply).
    #[derive(Default)]
    struct SimulatedNetwork {
        ledger: Mutex<HashMap<String, TxStatus>>,
        /// Times contract logic actually ran on the ledger.
        executions: AtomicU32,
        prepares: AtomicU32,
        sends: AtomicU32,
        /// Sends that are applied on-chain but whose response is lost.
        lost_send_responses: AtomicU32,
        /// Lookups that fail with a transient RPC error.
        failing_lookups: AtomicU32,
        /// Reject every send permanently.
        reject_sends: bool,
    }

    fn take(counter: &AtomicU32) -> bool {
        counter
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
            .is_ok()
    }

    fn result_for(hash: &str, status: TxStatus) -> SorobanTxResult {
        SorobanTxResult {
            hash: hash.to_string(),
            status,
            error: None,
        }
    }

    impl SubmissionBackend for SimulatedNetwork {
        fn prepare<'a>(
            &'a self,
            invocation: &'a SorobanInvocation,
        ) -> BoxFuture<'a, Result<PreparedTx, SorobanError>> {
            Box::pin(async move {
                let n = self.prepares.fetch_add(1, Ordering::SeqCst);
                let hash = format!("tx-{}-{}", &invocation.request_hash()[..12], n);
                Ok(PreparedTx {
                    envelope: format!("envelope-for-{}", hash),
                    hash,
                })
            })
        }

        fn lookup<'a>(
            &'a self,
            tx_hash: &'a str,
        ) -> BoxFuture<'a, Result<Option<SorobanTxResult>, SorobanError>> {
            Box::pin(async move {
                if take(&self.failing_lookups) {
                    return Err(SorobanError::RpcError("lookup timed out".into()));
                }
                let ledger = self.ledger.lock().unwrap();
                Ok(ledger.get(tx_hash).map(|s| result_for(tx_hash, *s)))
            })
        }

        fn send<'a>(&'a self, prepared: &'a PreparedTx) -> BoxFuture<'a, Result<String, SorobanError>> {
            Box::pin(async move {
                self.sends.fetch_add(1, Ordering::SeqCst);
                if self.reject_sends {
                    return Err(SorobanError::TransactionFailed("txBAD_AUTH".into()));
                }
                {
                    let mut ledger = self.ledger.lock().unwrap();
                    if !ledger.contains_key(&prepared.hash) {
                        ledger.insert(prepared.hash.clone(), TxStatus::Success);
                        self.executions.fetch_add(1, Ordering::SeqCst);
                    }
                }
                if take(&self.lost_send_responses) {
                    // Applied on-chain, but the client never hears back.
                    return Err(SorobanError::RpcError("connection reset by peer".into()));
                }
                Ok(prepared.hash.clone())
            })
        }

        fn await_result<'a>(
            &'a self,
            tx_hash: &'a str,
        ) -> BoxFuture<'a, Result<SorobanTxResult, SorobanError>> {
            Box::pin(async move {
                let ledger = self.ledger.lock().unwrap();
                Ok(result_for(
                    tx_hash,
                    ledger.get(tx_hash).copied().unwrap_or(TxStatus::Pending),
                ))
            })
        }
    }

    fn invocation() -> SorobanInvocation {
        SorobanInvocation {
            contract_id: "CPRIZE".into(),
            function_name: "distribute".into(),
            args: serde_json::json!({ "tournament": "t-1", "amount": 500 }),
            signer_secret: "SSECRET".into(),
        }
    }

    fn fast_policy(max_retries: u32) -> BackoffPolicy {
        BackoffPolicy {
            max_retries,
            initial_delay: Duration::from_millis(1),
            max_delay: Duration::from_millis(5),
            multiplier: 2.0,
            jitter: 0.5,
        }
    }

    #[tokio::test]
    async fn mid_flight_failure_executes_exactly_once() {
        let store = InMemorySubmissionStore::new();
        let network = SimulatedNetwork::default();
        network.lost_send_responses.store(1, Ordering::SeqCst);

        let result = submit_idempotent(&store, &network, &fast_policy(3), "idem-key-1", &invocation())
            .await
            .expect("retry should recover the applied transaction");

        assert_eq!(result.status, TxStatus::Success);
        assert_eq!(network.executions.load(Ordering::SeqCst), 1, "executed exactly once");
        assert_eq!(network.sends.load(Ordering::SeqCst), 1, "lookup prevented a re-send");
        assert_eq!(network.prepares.load(Ordering::SeqCst), 1);

        let record = store.get("idem-key-1").await.unwrap().unwrap();
        assert_eq!(record.status, SubmissionStatus::Completed);
        assert_eq!(record.tx_hash.as_deref(), Some(result.hash.as_str()));
        assert_eq!(record.attempts, 1);
    }

    #[tokio::test]
    async fn duplicate_key_returns_original_result_without_reexecuting() {
        let store = InMemorySubmissionStore::new();
        let network = SimulatedNetwork::default();
        let policy = fast_policy(3);

        let first = submit_idempotent(&store, &network, &policy, "idem-key-2", &invocation())
            .await
            .unwrap();
        let second = submit_idempotent(&store, &network, &policy, "idem-key-2", &invocation())
            .await
            .unwrap();

        assert_eq!(first.hash, second.hash);
        assert_eq!(second.status, TxStatus::Success);
        assert_eq!(network.prepares.load(Ordering::SeqCst), 1);
        assert_eq!(network.sends.load(Ordering::SeqCst), 1);
        assert_eq!(network.executions.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn exhausted_retries_resume_on_next_call_without_double_execution() {
        let store = InMemorySubmissionStore::new();
        let network = SimulatedNetwork::default();
        network.lost_send_responses.store(1, Ordering::SeqCst);

        // No retries: the lost response surfaces as a transient error, and the
        // key is left `signed` with the envelope persisted.
        let err = submit_idempotent(&store, &network, &fast_policy(0), "idem-key-3", &invocation())
            .await
            .unwrap_err();
        assert!(err.is_transient());
        let record = store.get("idem-key-3").await.unwrap().unwrap();
        assert_eq!(record.status, SubmissionStatus::Signed);

        // The client retries with the same key (e.g. after a worker restart).
        let result = submit_idempotent(&store, &network, &fast_policy(3), "idem-key-3", &invocation())
            .await
            .unwrap();
        assert_eq!(result.status, TxStatus::Success);
        assert_eq!(network.executions.load(Ordering::SeqCst), 1);
        assert_eq!(network.prepares.load(Ordering::SeqCst), 1, "persisted envelope reused");
        assert_eq!(network.sends.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn transient_lookup_failures_are_retried() {
        let store = InMemorySubmissionStore::new();
        let network = SimulatedNetwork::default();
        network.failing_lookups.store(2, Ordering::SeqCst);

        let result = submit_idempotent(&store, &network, &fast_policy(3), "idem-key-4", &invocation())
            .await
            .unwrap();
        assert_eq!(result.status, TxStatus::Success);
        assert_eq!(network.executions.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn retries_stop_at_max_retries() {
        let store = InMemorySubmissionStore::new();
        let network = SimulatedNetwork::default();
        network.failing_lookups.store(10, Ordering::SeqCst);

        let err = submit_idempotent(&store, &network, &fast_policy(2), "idem-key-5", &invocation())
            .await
            .unwrap_err();
        assert!(matches!(err, SorobanError::RpcError(_)));
        // 1 initial attempt + 2 retries consumed 3 failing lookups.
        assert_eq!(network.failing_lookups.load(Ordering::SeqCst), 7);
        assert_eq!(network.sends.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn key_reuse_with_different_payload_is_rejected() {
        let store = InMemorySubmissionStore::new();
        let network = SimulatedNetwork::default();
        let policy = fast_policy(1);

        submit_idempotent(&store, &network, &policy, "idem-key-6", &invocation())
            .await
            .unwrap();

        let mut other = invocation();
        other.args = serde_json::json!({ "tournament": "t-1", "amount": 9_999 });
        let err = submit_idempotent(&store, &network, &policy, "idem-key-6", &other)
            .await
            .unwrap_err();
        assert!(matches!(err, SorobanError::IdempotencyConflict(_)));
        assert_eq!(network.executions.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn permanent_rejection_is_recorded_and_replayed() {
        let store = InMemorySubmissionStore::new();
        let network = SimulatedNetwork {
            reject_sends: true,
            ..Default::default()
        };
        let policy = fast_policy(3);

        let first = submit_idempotent(&store, &network, &policy, "idem-key-7", &invocation())
            .await
            .unwrap();
        assert_eq!(first.status, TxStatus::Failed);
        assert_eq!(network.sends.load(Ordering::SeqCst), 1, "permanent errors are not retried");

        let second = submit_idempotent(&store, &network, &policy, "idem-key-7", &invocation())
            .await
            .unwrap();
        assert_eq!(second.status, TxStatus::Failed);
        assert_eq!(second.error, first.error);
        assert_eq!(network.sends.load(Ordering::SeqCst), 1);
        assert_eq!(network.executions.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn concurrent_reservation_reports_in_progress() {
        let store = InMemorySubmissionStore::new();
        let network = SimulatedNetwork::default();
        // Another worker just reserved the key and hasn't signed yet.
        store
            .reserve("idem-key-8", &invocation().request_hash())
            .await
            .unwrap();

        let err = submit_idempotent(&store, &network, &fast_policy(1), "idem-key-8", &invocation())
            .await
            .unwrap_err();
        assert!(matches!(err, SorobanError::SubmissionInProgress(_)));
        assert_eq!(network.prepares.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn invocation_debug_redacts_signer_secret() {
        let rendered = format!("{:?}", invocation());
        assert!(!rendered.contains("SSECRET"));
    }
}
