//! Stellar SDK integration service (`soroban-client` crate) — issue #1283.
//!
//! Implements the acceptance criteria for the Stellar Rust SDK integration:
//! - Account creation and management (keypair generation, funding, lookup)
//! - Asset issuance (create asset, establish trustline, issue payments)
//! - Transaction building, signing, submission, and confirmation via Stellar RPC
//! - Soroban contract invocation (simulate + submit)
//!
//! All network-facing methods are async and talk to a Stellar RPC endpoint.
//! Testnet helpers use the official friendbot faucet. Integration tests that
//! hit the live testnet are `#[ignore]`d so CI never depends on the network.

use std::time::Duration;

use soroban_client::{
    account::Account,
    address::{Address, AddressTrait},
    asset::{Asset, AssetBehavior},
    contract::{ContractBehavior, Contracts},
    error::Error as SdkError,
    keypair::{Keypair, KeypairBehavior},
    network::{NetworkPassphrase, Networks},
    operation::Operation,
    soroban_rpc::{SendTransactionStatus, TransactionStatus},
    transaction::{Transaction, TransactionBehavior},
    transaction_builder::{TransactionBuilder, TransactionBuilderBehavior},
    xdr::{Limits, ScVal, WriteXdr},
    Options, Server,
};
use thiserror::Error;

/// Errors produced by the Stellar SDK service.
#[derive(Debug, Error)]
pub enum StellarSdkError {
    #[error("SDK error: {0}")]
    Sdk(String),
    #[error("invalid keypair: {0}")]
    Keypair(String),
    #[error("invalid address: {0}")]
    Address(String),
    #[error("invalid asset: {0}")]
    Asset(String),
    #[error("transaction failed on-chain")]
    TransactionFailed,
    #[error("transaction rejected by RPC: {0}")]
    RpcRejected(String),
    #[error("timeout waiting for transaction confirmation")]
    Timeout,
    #[error("RPC error: {0}")]
    Rpc(String),
}

impl From<SdkError> for StellarSdkError {
    fn from(e: SdkError) -> Self {
        StellarSdkError::Sdk(e.to_string())
    }
}

/// High-level client wrapping `soroban_client::Server` for ArenaX blockchain ops.
pub struct StellarSdkService {
    server: Server,
    network_passphrase: String,
    timeout_secs: u64,
}

impl std::fmt::Debug for StellarSdkService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StellarSdkService")
            .field("network_passphrase", &self.network_passphrase)
            .field("timeout_secs", &self.timeout_secs)
            .finish_non_exhaustive()
    }
}

impl StellarSdkService {
    /// Connect to the given RPC URL on the Stellar **testnet**.
    pub fn testnet(rpc_url: &str) -> Result<Self, StellarSdkError> {
        Self::connect(rpc_url, Networks::testnet())
    }

    /// Connect to the given RPC URL on **public** network.
    pub fn public(rpc_url: &str) -> Result<Self, StellarSdkError> {
        Self::connect(rpc_url, Networks::public())
    }

    fn connect(rpc_url: &str, network_passphrase: &str) -> Result<Self, StellarSdkError> {
        let opts = Options {
            allow_http: rpc_url.starts_with("http://"),
            timeout: 10,
            ..Default::default()
        };
        let server =
            Server::new(rpc_url, opts).map_err(|e| StellarSdkError::Sdk(e.to_string()))?;
        Ok(Self {
            server,
            network_passphrase: network_passphrase.to_string(),
            timeout_secs: 30,
        })
    }

    // ------------------------------------------------------------------
    // Account creation and management
    // ------------------------------------------------------------------

    /// Generate a fresh ed25519 keypair. Returns `(public_key, secret_seed)`.
    pub fn generate_account() -> Result<(String, String), StellarSdkError> {
        let kp = Keypair::random().map_err(|e| StellarSdkError::Keypair(e.to_string()))?;
        Ok((kp.public_key(), kp.secret_key().map_err(|e| StellarSdkError::Keypair(e.to_string()))?))
    }

    fn keypair_from_secret(secret: &str) -> Result<Keypair, StellarSdkError> {
        // NOTE: `Keypair::from_secret` unwraps internally and panics on
        // malformed strkeys, so guard the call with catch_unwind.
        let owned = secret.to_string();
        std::panic::catch_unwind(move || Keypair::from_secret(&owned))
            .map_err(|_| StellarSdkError::Keypair("malformed secret key".into()))?
            .map_err(|e| StellarSdkError::Keypair(e.to_string()))
    }

    /// Fetch the current on-chain state (sequence number) for `public_key`.
    pub async fn get_account(&self, public_key: &str) -> Result<Account, StellarSdkError> {
        self.server
            .get_account(public_key)
            .await
            .map_err(|e| StellarSdkError::Rpc(e.to_string()))
    }

    /// Fund `public_key` from the testnet friendbot faucet.
    pub async fn fund_testnet_account(
        &self,
        public_key: &str,
    ) -> Result<Account, StellarSdkError> {
        self.server
            .request_airdrop(public_key)
            .await
            .map_err(|e| StellarSdkError::Rpc(e.to_string()))
    }

    /// Build a create-account transaction: `source_secret` funds a new account
    /// at `new_public_key` with `starting_balance_stroops` (1 XLM = 10_000_000).
    /// Returns the base64-encoded signed envelope ready for submission.
    pub async fn build_create_account_tx(
        &self,
        source_secret: &str,
        new_public_key: &str,
        starting_balance_stroops: i64,
    ) -> Result<String, StellarSdkError> {
        let kp = Self::keypair_from_secret(source_secret)?;
        let mut account = self.get_account(&kp.public_key()).await?;
        let op = Operation::new()
            .create_account(new_public_key, starting_balance_stroops)
            .map_err(|e| StellarSdkError::Sdk(format!("{e:?}")))?;
        let mut tx = TransactionBuilder::new(&mut account, &self.network_passphrase, None)
            .fee(100u32)
            .add_operation(op)
            .build();
        tx.sign(&[kp]);
        self.envelope_base64(&tx)
    }

    // ------------------------------------------------------------------
    // Asset issuance
    // ------------------------------------------------------------------

    /// Build an asset issuance transaction: the issuer (`issuer_secret`) pays
    /// `amount_stroops` of the custom asset `code` to `destination`. The
    /// destination must already hold a trustline for the asset.
    pub async fn build_asset_issue_tx(
        &self,
        issuer_secret: &str,
        code: &str,
        destination: &str,
        amount_stroops: i64,
    ) -> Result<String, StellarSdkError> {
        let kp = Self::keypair_from_secret(issuer_secret)?;
        let issuer_public = kp.public_key();
        let asset = Asset::new(code, Some(&issuer_public))
            .map_err(|e| StellarSdkError::Asset(e.to_string()))?;
        let mut account = self.get_account(&issuer_public).await?;
        let op = Operation::new()
            .payment(destination, &asset, amount_stroops)
            .map_err(|e| StellarSdkError::Sdk(format!("{e:?}")))?;
        let mut tx = TransactionBuilder::new(&mut account, &self.network_passphrase, None)
            .fee(100u32)
            .add_operation(op)
            .build();
        tx.sign(&[kp]);
        self.envelope_base64(&tx)
    }

    /// Build a change-trust transaction so `holder_secret` can hold `code`
    /// issued by `issuer_public`.
    pub async fn build_change_trust_tx(
        &self,
        holder_secret: &str,
        code: &str,
        issuer_public: &str,
    ) -> Result<String, StellarSdkError> {
        let kp = Self::keypair_from_secret(holder_secret)?;
        let asset = Asset::new(code, Some(issuer_public))
            .map_err(|e| StellarSdkError::Asset(e.to_string()))?;
        let mut account = self.get_account(&kp.public_key()).await?;
        let op = Operation::new()
            .change_trust(asset, None::<i64>)
            .map_err(|e| StellarSdkError::Sdk(format!("{e:?}")))?;
        let mut tx = TransactionBuilder::new(&mut account, &self.network_passphrase, None)
            .fee(100u32)
            .add_operation(op)
            .build();
        tx.sign(&[kp]);
        self.envelope_base64(&tx)
    }

    // ------------------------------------------------------------------
    // Transaction building, submission, and confirmation
    // ------------------------------------------------------------------

    /// Build a native-XLM payment transaction envelope (base64).
    pub async fn build_payment_tx(
        &self,
        source_secret: &str,
        destination: &str,
        amount_stroops: i64,
    ) -> Result<String, StellarSdkError> {
        let kp = Self::keypair_from_secret(source_secret)?;
        let mut account = self.get_account(&kp.public_key()).await?;
        let op = Operation::new()
            .payment(destination, &Asset::native(), amount_stroops)
            .map_err(|e| StellarSdkError::Sdk(format!("{e:?}")))?;
        let mut tx = TransactionBuilder::new(&mut account, &self.network_passphrase, None)
            .fee(100u32)
            .add_operation(op)
            .build();
        tx.sign(&[kp]);
        self.envelope_base64(&tx)
    }

    /// Sign a prepared transaction envelope (base64) with `secret` and submit
    /// it to the network. Returns the transaction hash.
    pub async fn submit_envelope(
        &self,
        envelope_base64: &str,
        secret: &str,
    ) -> Result<String, StellarSdkError> {
        let kp = Self::keypair_from_secret(secret)?;
        let mut tx = Transaction::from_xdr_envelope(envelope_base64, &self.network_passphrase);
        tx.sign(&[kp]);
        let response = self.server.send_transaction(tx).await?;
        match response.status {
            SendTransactionStatus::Pending | SendTransactionStatus::Duplicate => {
                Ok(response.hash)
            }
            SendTransactionStatus::Error => Err(StellarSdkError::RpcRejected(
                response
                    .to_error_result()
                    .map(|r| format!("{r:?}"))
                    .unwrap_or_else(|| "unknown RPC error".into()),
            )),
            SendTransactionStatus::TryAgainLater => {
                Err(StellarSdkError::RpcRejected("try again later".into()))
            }
        }
    }

    /// Submit an envelope and wait until the transaction is included on-chain.
    /// Returns `(tx_hash, TransactionStatus)`.
    pub async fn submit_and_confirm(
        &self,
        envelope_base64: &str,
        secret: &str,
    ) -> Result<(String, TransactionStatus), StellarSdkError> {
        let hash = self.submit_envelope(envelope_base64, secret).await?;
        let max_wait = Duration::from_secs(self.timeout_secs);
        let result = self
            .server
            .wait_transaction(&hash, max_wait)
            .await
            .map_err(|(e, _)| StellarSdkError::Rpc(e.to_string()))?;
        match result.status {
            TransactionStatus::Success => Ok((hash, TransactionStatus::Success)),
            TransactionStatus::Failed => Err(StellarSdkError::TransactionFailed),
            TransactionStatus::NotFound => Err(StellarSdkError::Timeout),
        }
    }

    // ------------------------------------------------------------------
    // Soroban contract invocation
    // ------------------------------------------------------------------

    /// Build, sign, and submit a Soroban contract invocation. The transaction
    /// is first prepared (simulated) so footprint/resource fees are attached
    /// automatically by the RPC server. Returns the transaction hash.
    pub async fn invoke_contract(
        &self,
        caller_secret: &str,
        contract_id: &str,
        method: &str,
        args: Vec<ScVal>,
    ) -> Result<String, StellarSdkError> {
        let kp = Self::keypair_from_secret(caller_secret)?;
        let mut account = self.get_account(&kp.public_key()).await?;
        let contract = Contracts::new(contract_id)
            .map_err(|e| StellarSdkError::Sdk(e.to_string()))?;
        let invoke_op = contract.call(method, Some(args));
        let tx = TransactionBuilder::new(&mut account, &self.network_passphrase, None)
            .fee(100u32)
            .add_operation(invoke_op)
            .build();
        let mut prepared = self.server.prepare_transaction(&tx).await?;
        prepared.sign(&[kp]);
        let response = self.server.send_transaction(prepared).await?;
        match response.status {
            SendTransactionStatus::Pending | SendTransactionStatus::Duplicate => {
                Ok(response.hash)
            }
            SendTransactionStatus::Error => Err(StellarSdkError::RpcRejected(
                response
                    .to_error_result()
                    .map(|r| format!("{r:?}"))
                    .unwrap_or_else(|| "unknown RPC error".into()),
            )),
            SendTransactionStatus::TryAgainLater => {
                Err(StellarSdkError::RpcRejected("try again later".into()))
            }
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    fn envelope_base64(&self, tx: &Transaction) -> Result<String, StellarSdkError> {
        let envelope = tx
            .to_envelope()
            .map_err(|e| StellarSdkError::Sdk(e.to_string()))?;
        envelope
            .to_xdr_base64(Limits::none())
            .map_err(|e| StellarSdkError::Sdk(e.to_string()))
    }

    /// Convert a string address into a Soroban `ScVal` (for contract args).
    pub fn address_to_scval(address: &str) -> Result<ScVal, StellarSdkError> {
        let addr = Address::new(address).map_err(|e| StellarSdkError::Address(e.to_string()))?;
        addr.to_sc_val()
            .map_err(|e| StellarSdkError::Address(e.to_string()))
    }
}

// Re-export commonly needed types so callers don't need a direct soroban-client dep.
pub use soroban_client::account::Account as SdkAccount;
pub use soroban_client::asset::Asset as SdkAsset;
pub use soroban_client::soroban_rpc::TransactionStatus as SdkTxStatus;
pub use soroban_client::transaction::Transaction as SdkTransaction;
pub use soroban_client::xdr::ScVal as SdkScVal;

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_client::account::AccountBehavior;

    #[test]
    fn generates_valid_ed25519_keypair() {
        let (public, secret) = StellarSdkService::generate_account().unwrap();
        assert!(public.starts_with('G'), "public key should start with G: {public}");
        assert!(secret.starts_with('S'), "secret should start with S: {secret}");
        // Round-trip through keypair construction validates checksums.
        assert!(StellarSdkService::keypair_from_secret(&secret).is_ok());
    }

    #[test]
    fn rejects_invalid_secret() {
        assert!(StellarSdkService::keypair_from_secret("not-a-secret").is_err());
    }

    #[test]
    fn builds_service_for_testnet() {
        let svc = StellarSdkService::testnet("https://soroban-testnet.stellar.org");
        assert!(svc.is_ok());
    }

    #[tokio::test]
    async fn builds_payment_transaction_offline() {
        // Build a payment envelope using a locally-known account (sequence 0)
        // without hitting the network — validates tx construction + signing.
        let kp = Keypair::random().unwrap();
        let dest = Keypair::random().unwrap();
        let mut account = Account::new(&kp.public_key(), "0").unwrap();
        let op = Operation::new()
            .payment(&dest.public_key(), &Asset::native(), 10_000_000)
            .unwrap();
        let mut tx = TransactionBuilder::new(&mut account, Networks::testnet(), None)
            .fee(100u32)
            .add_operation(op)
            .build();
        tx.sign(&[kp]);
        let hash = tx.hash();
        assert_ne!(hash, [0u8; 32], "transaction hash should not be all zeros");
    }

    #[test]
    fn creates_credit_asset() {
        let kp = Keypair::random().unwrap();
        let asset = Asset::new("ARENA", Some(&kp.public_key()));
        assert!(asset.is_ok());
        assert!(Asset::new("", Some(&kp.public_key())).is_err());
    }

    #[test]
    fn address_to_scval_roundtrip() {
        let (public, _) = StellarSdkService::generate_account().unwrap();
        let scval = StellarSdkService::address_to_scval(&public);
        assert!(scval.is_ok());
    }

    /// Live testnet smoke test — ignored by default so CI stays hermetic.
    /// Run locally with: `cargo test -- --ignored testnet_`
    #[tokio::test]
    #[ignore]
    async fn testnet_get_network_health() {
        let svc = StellarSdkService::testnet("https://soroban-testnet.stellar.org").unwrap();
        let health = svc.server.get_health().await.unwrap();
        assert_eq!(health.status, "healthy");
    }

    /// Live testnet account lifecycle: generate → fund → read sequence.
    #[tokio::test]
    #[ignore]
    async fn testnet_account_funding_and_lookup() {
        let svc = StellarSdkService::testnet("https://soroban-testnet.stellar.org").unwrap();
        let (public, _secret) = StellarSdkService::generate_account().unwrap();
        let account = svc.fund_testnet_account(&public).await.unwrap();
        assert!(!account.sequence_number().is_empty());
    }
}
