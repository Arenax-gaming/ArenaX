//! Machine-readable registry of every event namespace shipped by this
//! crate.
//!
//! Off-chain indexers (block scanners, replay tooling, the trace
//! analysis dashboard from #478) call into this list to know which
//! `(NAMESPACE, VERSION)` pairs are first-class — anything they see
//! on chain that is *not* in this list should be flagged as either an
//! unregistered event or a version mismatch.

use crate::{
    anti_cheat, auth_gateway, ax_token, contract_registry, dispute, escrow, governance, identity,
    match_contract, match_lifecycle, player_reputation, prize_distribution, registry, reputation,
    reputation_index, slashing, staking, tournament, virtual_economy,
};

/// A single entry in the namespace registry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NamespaceEntry {
    pub namespace: &'static str,
    pub version: &'static str,
}

/// Every `(NAMESPACE, VERSION)` known to this crate. Keep alphabetical
/// by namespace so new entries land in a stable place.
pub const NAMESPACES: &[NamespaceEntry] = &[
    NamespaceEntry { namespace: anti_cheat::NAMESPACE, version: anti_cheat::VERSION },
    NamespaceEntry { namespace: auth_gateway::NAMESPACE, version: auth_gateway::VERSION },
    NamespaceEntry { namespace: ax_token::NAMESPACE, version: ax_token::VERSION },
    NamespaceEntry { namespace: contract_registry::NAMESPACE, version: contract_registry::VERSION },
    NamespaceEntry { namespace: dispute::NAMESPACE, version: dispute::VERSION },
    NamespaceEntry { namespace: escrow::NAMESPACE, version: escrow::VERSION },
    NamespaceEntry { namespace: governance::NAMESPACE, version: governance::VERSION },
    NamespaceEntry { namespace: identity::NAMESPACE, version: identity::VERSION },
    NamespaceEntry { namespace: match_contract::NAMESPACE, version: match_contract::VERSION },
    NamespaceEntry { namespace: match_lifecycle::NAMESPACE, version: match_lifecycle::VERSION },
    NamespaceEntry { namespace: player_reputation::NAMESPACE, version: player_reputation::VERSION },
    NamespaceEntry { namespace: prize_distribution::NAMESPACE, version: prize_distribution::VERSION },
    NamespaceEntry { namespace: registry::NAMESPACE, version: registry::VERSION },
    NamespaceEntry { namespace: reputation::NAMESPACE, version: reputation::VERSION },
    NamespaceEntry { namespace: reputation_index::NAMESPACE, version: reputation_index::VERSION },
    NamespaceEntry { namespace: slashing::NAMESPACE, version: slashing::VERSION },
    NamespaceEntry { namespace: staking::NAMESPACE, version: staking::VERSION },
    NamespaceEntry { namespace: tournament::NAMESPACE, version: tournament::VERSION },
    NamespaceEntry { namespace: virtual_economy::NAMESPACE, version: virtual_economy::VERSION },
];

/// Number of registered namespaces — useful for dashboards that want
/// to surface a "domains tracked" count without iterating.
pub const NAMESPACE_COUNT: usize = NAMESPACES.len();

/// Look up a namespace by name. Returns the registered version if known.
pub fn lookup(namespace: &str) -> Option<&'static str> {
    let mut i = 0;
    while i < NAMESPACES.len() {
        if str_eq(NAMESPACES[i].namespace, namespace) {
            return Some(NAMESPACES[i].version);
        }
        i += 1;
    }
    None
}

/// `no_std`-friendly equality for `&str` — `core::cmp::Eq` is fine but
/// we want this callable from `const fn` callers in the future without
/// changes.
fn str_eq(a: &str, b: &str) -> bool {
    a.as_bytes() == b.as_bytes()
}
