// Core models
pub mod achievement;
pub mod batch;
pub mod dispute;
pub mod idempotency;
pub mod leaderboard;
pub mod match_authority;
pub mod match_models;
pub mod matchmaker;
pub mod pagination;
pub mod reward_settlement;
pub mod social;
pub mod stellar_account;
pub mod stellar_transaction;
pub mod tournament;
pub mod user;
pub mod wallet;

// Re-export commonly used types - explicit to avoid ambiguity
pub use achievement::*;
// Explicit list (not `dispute::*`): `TicketStatus`/`CreateTicketRequest` are
// deliberately distinct names from match_models' `DisputeStatus`/
// `CreateDisputeRequest` to avoid a glob-export collision between the two
// unrelated dispute systems (see dispute.rs's module doc comment).
pub use dispute::{
    AddEvidenceRequest, AssignDisputeRequest, CreateTicketRequest, Dispute, DisputeDetail,
    DisputeEvidence, DisputeHistoryEntry, EscalateDisputeRequest, EscalationLevel,
    ListDisputesQuery, RejectDisputeRequest, ResolveDisputeRequest, TicketStatus,
};
pub use idempotency::*;
pub use leaderboard::*;
pub use match_authority::*;
pub use match_models::{
    CreateDisputeRequest, DisputeListResponse, DisputeStatus, EloHistory, EloResponse,
    JoinMatchmakingRequest, Match, MatchDispute, MatchResponse, MatchResult, MatchScore,
    MatchStatus, MatchType, MatchmakingQueue, MatchmakingStatusResponse, PlayerInfo, QueueStatus,
    ReportScoreRequest, UserElo,
};
pub use matchmaker::{
    GameModeStats, GameQueueStats, JoinQueueRequest, JoinQueueResponse, LeaveQueueRequest,
    LeaveQueueResponse, MatchCandidate, MatchHistoryResponse, MatchmakingConfig,
    MatchmakingQueueResponse, MatchmakingStats, QueueEntry,
};
pub use pagination::{ApiResponse, PaginatedResponse, PaginationParams, DEFAULT_LIMIT, MAX_LIMIT};
pub use reward_settlement::*;
pub use social::*;
pub use stellar_account::{
    CreateStellarAccountRequest, StellarAccount, StellarAccountResponse, StellarAccountType,
};
pub use stellar_transaction::{
    CreateStellarTransactionRequest, StellarTransaction, StellarTransactionResponse,
    StellarTransactionStatus, StellarTransactionType,
};
pub use tournament::{
    BracketType, CreateTournamentRequest, JoinTournamentRequest, ParticipantStatus, PrizePool,
    RoundStatus, RoundType, Tournament, TournamentListResponse, TournamentMatch,
    TournamentParticipant, TournamentResponse, TournamentRound, TournamentStanding,
    TournamentStatus, TournamentType, TournamentVisibility, UpdateTournamentRequest,
};
pub use user::*;
pub use wallet::{
    CreateWalletRequest, DepositRequest, PaymentMethod, PaymentProvider, Transaction,
    TransactionResponse, TransactionStatus, TransactionType, UpdateWalletRequest, Wallet,
    WalletBalance, WalletResponse, WithdrawalRequest,
};
