// Core models
pub mod match_authority;
pub mod match_models;
pub mod matchmaker;
pub mod reward_settlement;
pub mod stellar_account;
pub mod stellar_transaction;
pub mod tournament;
pub mod user;
pub mod wallet;

// Re-export commonly used types - explicit to avoid ambiguity
pub use match_authority::*;
pub use match_models::{
    CreateDisputeRequest, DisputeListResponse, DisputeStatus, EloHistory, EloResponse,
    JoinMatchmakingRequest, Match, MatchDispute, MatchResponse, MatchResult, MatchScore,
    MatchStatus, MatchType, MatchmakingQueue, MatchmakingStatusResponse, PlayerInfo, QueueStatus,
    ReportScoreRequest, UserElo,
};
pub use matchmaker::{
    DisputeStatus, EloHistory, EloResponse, GameModeStats, GameQueueStats, JoinQueueRequest,
    JoinQueueResponse, LeaveQueueRequest, LeaveQueueResponse, Match, MatchCandidate, MatchDispute,
    MatchHistoryResponse, MatchmakingConfig, MatchmakingQueue, MatchmakingQueueResponse,
    MatchmakingStats, MatchmakingStatsResponse, MatchmakingStatusResponse, MatchResult, MatchScore,
    MatchStatus, MatchType, PlayerInfo, QueueEntry, QueueStatus, ReportScoreRequest, UserElo,
};
pub use reward_settlement::*;
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
