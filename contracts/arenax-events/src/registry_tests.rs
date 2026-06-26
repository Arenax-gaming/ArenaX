//! Tests for the event namespace registry (#490).
//!
//! These tests guard the standard event schema — they fail if a future
//! PR introduces an event module that:
//!
//! - Forgets to add itself to [`events_registry::NAMESPACES`],
//! - Reuses an existing `NAMESPACE` string under a different module,
//! - Drops or empties either `NAMESPACE` or `VERSION`,
//! - Uses a `VERSION` outside the `vN` convention.

extern crate alloc;
use alloc::collections::BTreeSet;
use alloc::string::ToString;

use crate::events_registry::{lookup, NamespaceEntry, NAMESPACES, NAMESPACE_COUNT};

#[test]
fn registry_is_not_empty() {
    assert!(NAMESPACE_COUNT > 0, "events_registry must list at least one namespace");
    assert_eq!(NAMESPACE_COUNT, NAMESPACES.len());
}

#[test]
fn every_namespace_has_non_empty_name_and_version() {
    for entry in NAMESPACES {
        assert!(!entry.namespace.is_empty(), "empty namespace: {:?}", entry);
        assert!(!entry.version.is_empty(), "empty version for {}", entry.namespace);
    }
}

#[test]
fn versions_follow_vN_convention() {
    for entry in NAMESPACES {
        let v = entry.version;
        assert!(
            v.len() >= 2 && v.starts_with('v'),
            "{} version {:?} should be vN (e.g. v1)",
            entry.namespace,
            v,
        );
        // The chars after the leading 'v' must be ascii digits.
        for c in v.chars().skip(1) {
            assert!(c.is_ascii_digit(), "{} version has non-digit: {:?}", entry.namespace, v);
        }
    }
}

#[test]
fn namespaces_are_unique() {
    let mut seen = BTreeSet::new();
    for entry in NAMESPACES {
        let inserted = seen.insert(entry.namespace.to_string());
        assert!(inserted, "duplicate namespace: {}", entry.namespace);
    }
}

#[test]
fn lookup_round_trips_for_every_entry() {
    for entry in NAMESPACES {
        let got = lookup(entry.namespace);
        assert_eq!(got, Some(entry.version), "lookup failed for {}", entry.namespace);
    }
}

#[test]
fn lookup_returns_none_for_unknown_namespace() {
    assert_eq!(lookup("DefinitelyNotARealArenaXNamespace"), None);
}

#[test]
fn entry_partial_eq_works() {
    // Smoke-test the derived PartialEq so the registry is structurally
    // comparable (used by the off-chain indexer's diff logic).
    let a = NamespaceEntry { namespace: "X", version: "v1" };
    let b = NamespaceEntry { namespace: "X", version: "v1" };
    let c = NamespaceEntry { namespace: "Y", version: "v1" };
    assert_eq!(a, b);
    assert_ne!(a, c);
}
