// Service layer module for ArenaX
pub mod auth_service;
pub mod governance_service;
pub mod idempotency_service;
pub mod match_authority_service;
#[cfg(test)]
mod match_authority_service_test;
pub mod match_service;
pub mod reaper_service;
pub mod matchmaker;
pub mod reputation_service;
pub mod reward_settlement_service;
pub mod soroban_service;
pub mod stellar_service;
pub mod tournament_service;
pub mod wallet_service;

pub use auth_service::AuthService;
pub use governance_service::{
    CreateProposalDto, GovernanceService, GovernanceServiceError, ProposalRecord,
    ProposalStatus as GovProposalStatus,
};
pub use idempotency_service::IdempotencyService;
pub use match_authority_service::MatchAuthorityService;
pub use match_service::MatchService;
pub use reaper_service::ReaperService;
pub use matchmaker::{MatchmakerService, EloEngine, MatchmakingConfig};
pub use reputation_service::{PlayerReputation, ReputationService, ReputationTier};
pub use soroban_service::{
    DecodedEvent, NetworkConfig, RetryConfig, SorobanError, SorobanService, SorobanTxResult,
    TxStatus,
};
pub use stellar_service::StellarService;
pub use tournament_service::TournamentService;
pub use wallet_service::WalletService;
pub use crate::realtime::event_bus::EventBus;
