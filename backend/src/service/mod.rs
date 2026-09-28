// Service layer module for ArenaX
pub mod achievement_service;
pub mod analytics_service;
pub mod api_key_service;
pub mod audit_service;
pub mod auth_service;
pub mod batch_service;
pub mod dispute_service;
pub mod email_service;
pub mod evidence_storage;
pub mod feature_flags;
pub mod governance_service;
pub mod idempotency_service;
pub mod idempotency_tests;
pub mod leaderboard_service;
pub mod match_authority_service;
pub mod match_authority_service_test;
pub mod match_service;
pub mod match_service_background;
pub mod matchmaker;
pub mod matchmaker_tests;
pub mod notification_service;
pub mod payment_provider;
pub mod player_stats_service;
pub mod push_notification_service;
pub mod reaper_service;
pub mod reputation_service;
pub mod reward_settlement_service;
pub mod social_service;
pub mod soroban_service;
pub mod staking_service;
pub mod stellar_service;
pub mod suspension_service;
pub mod tournament_service;
pub mod user_service;
pub mod wallet_service;

pub use crate::realtime::event_bus::EventBus;
pub use achievement_service::AchievementService;
pub use audit_service::{AuditAction, AuditEntryInput, AuditFilter, AuditService};
pub use dispute_service::DisputeService;
pub use feature_flags::FeatureFlagService;
pub use governance_service::{
    CreateProposalDto, GovernanceService, GovernanceServiceError, ProposalRecord,
    ProposalStatus as GovProposalStatus,
};
pub use idempotency_service::IdempotencyService;
pub use leaderboard_service::LeaderboardService;
pub use match_authority_service::MatchAuthorityService;
pub use match_service::MatchService;
pub use push_notification_service::{DeliveryOutcome, FcmConfig, PushError, PushNotificationService};
pub use reaper_service::ReaperService;
pub use reputation_service::{PlayerReputation, ReputationService, ReputationTier};
pub use social_service::SocialService;
pub use soroban_service::{
    DecodedEvent, NetworkConfig, RetryConfig, SorobanError, SorobanService, SorobanTxResult,
    TxStatus,
};
pub use stellar_service::StellarService;
pub use tournament_service::TournamentService;
pub use user_service::UserService;
pub use wallet_service::WalletService;
