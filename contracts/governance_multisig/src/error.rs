//! Error types for the Governance Multisig contract

use soroban_sdk::contracterror;

/// Governance contract errors
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum GovernanceError {
    /// Contract has already been initialized
    AlreadyInitialized = 1,
    /// Contract has not been initialized
    NotInitialized = 2,
    /// Caller is not authorized for this operation
    Unauthorized = 3,
    /// Caller is not an active signer
    NotASigner = 4,
    /// Proposal with given ID was not found
    ProposalNotFound = 5,
    /// Proposal with given ID already exists
    ProposalAlreadyExists = 6,
    /// Proposal has already been executed
    ProposalAlreadyExecuted = 7,
    /// Proposal has expired
    ProposalExpired = 8,
    /// Proposal has been cancelled
    ProposalCancelled = 10,
    /// Signer has already approved this proposal
    AlreadyApproved = 11,
    /// Signer has not approved this proposal
    NotApproved = 12,
    /// Proposal does not have enough approvals to execute
    InsufficientApprovals = 13,
    /// Execution time delay has not passed yet
    ExecutionTooEarly = 14,
    /// Contract cannot call itself directly (must use internal functions)
    SelfCallNotAllowed = 15,
    /// Threshold must be greater than zero and less than or equal to signer count
    InvalidThreshold = 17,
    /// New threshold would exceed the number of signers
    ThresholdExceedsSigners = 18,
    /// Maximum number of signers has been reached
    MaxSignersReached = 19,
    /// Signer already exists in the signer list
    SignerAlreadyExists = 20,
    /// Signer was not found in the signer list
    SignerNotFound = 21,
    /// Cannot remove the last signer
    CannotRemoveLastSigner = 22,
    /// Signer list cannot be empty
    EmptySignerList = 25,
}
