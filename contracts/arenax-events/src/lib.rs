//! Shared, versioned event definitions for ArenaX contracts.
//!
//! ## Standardisation rules (issue #490)
//!
//! Every contract domain exposes its events from its own module here, and
//! every module must declare the two associated constants:
//!
//! - `NAMESPACE: &str` — domain name (e.g. `"ArenaXMatch"`).
//! - `VERSION: &str` — schema version (e.g. `"v1"`); bump only on a
//!   breaking change to any event in the module.
//!
//! Topics use the convention `["{NAMESPACE_abbrev}_{VERSION}", "{ACTION}"]`
//! (see existing modules). Off-chain indexers split on `_` to pick up the
//! namespace + version without parsing the action.
//!
//! The [`registry`] module exposes a single machine-readable list of
//! every `(NAMESPACE, VERSION)` shipped by this crate, and the test
//! suite enforces uniqueness so a future PR can't accidentally collide
//! two domains on the same namespace.

#![no_std]

pub mod anti_cheat;
pub mod auth_gateway;
pub mod ax_token;
pub mod contract_registry;
pub mod dispute;
pub mod escrow;
pub mod governance;
pub mod identity;
pub mod match_contract;
pub mod match_lifecycle;
pub mod player_reputation;
pub mod registry;
pub mod reputation;
pub mod reputation_index;
pub mod slashing;
pub mod staking;
pub mod tournament;
pub mod access_control;
pub mod emergency_pause;
pub mod time_lock;
