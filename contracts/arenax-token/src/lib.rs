#![no_std]

//! ArenaX Token Contract
//!
//! A SEP-41 compliant token implementation for the ArenaX gaming platform.
//! This contract implements the standard Soroban token interface with:
//! - Minting (admin only)
//! - Burning
//! - Transfers
//! - Approvals with expiration
//! - Balance queries
//! - Metadata (name, symbol, decimals)
mod admin;
mod allowance;
mod balance;
mod contract;
mod errors;
mod event;
mod metadata;
mod storage_types;

pub use contract::*;
pub use errors::TokenError;

#[cfg(test)]
mod test;
