//! Role hierarchy with inheritance (#1559).
//!
//! Roles form a chain: `SUPER_ADMIN > ADMIN > MODERATOR > PLAYER`. Each
//! role may have an immediate "senior" role recorded in contract storage;
//! a senior role implicitly has every permission assigned to the roles
//! beneath it in the chain, without those permissions needing to be
//! re-assigned explicitly. Because the chain is walked one hop at a time
//! via [`get_role_parent`], inheritance is transitive: if `MODERATOR`'s
//! senior is `ADMIN` and `ADMIN`'s senior is `SUPER_ADMIN`, then
//! `SUPER_ADMIN` inherits `MODERATOR`'s (and `PLAYER`'s) permissions too.
//!
//! The hierarchy is stored under [`crate::DataKey::RoleParent`] so it
//! survives contract upgrades, and is seeded with the canonical default
//! chain on [`crate::AccessControl::initialize`].

use arenax_events::access_control as events;
use soroban_sdk::{Address, Env};

use crate::{DataKey, ROLE_ADMIN, ROLE_MODERATOR};

/// Top of the hierarchy: automatically inherits every permission granted
/// to `ADMIN`, `MODERATOR` and `PLAYER`.
pub const ROLE_SUPER_ADMIN: u32 = 13;
/// Bottom of the hierarchy.
pub const ROLE_PLAYER: u32 = 14;

/// Canonical default hierarchy edges `(role, immediate_senior)`, installed
/// the first time each edge is unset (e.g. on `initialize`).
pub const DEFAULT_HIERARCHY: [(u32, u32); 3] = [
    (ROLE_PLAYER, ROLE_MODERATOR),
    (ROLE_MODERATOR, ROLE_ADMIN),
    (ROLE_ADMIN, ROLE_SUPER_ADMIN),
];

/// The immediate senior of `role`, if the hierarchy defines one.
pub fn get_role_parent(env: &Env, role: u32) -> Option<u32> {
    env.storage().instance().get(&DataKey::RoleParent(role))
}

/// Whether `senior` is `role` itself, or dominates `role` transitively in
/// the hierarchy (i.e. `senior` inherits every permission `role` has).
pub fn role_includes(env: &Env, senior: u32, role: u32) -> bool {
    let mut current = role;
    loop {
        if current == senior {
            return true;
        }
        match get_role_parent(env, current) {
            Some(parent) => current = parent,
            None => return false,
        }
    }
}

/// Set `role`'s immediate senior to `parent`. Rejects the change with a
/// `circular_hierarchy` panic if it would create a cycle (including
/// `role == parent`). Emits `role_hierarchy_updated` on success.
pub fn set_role_parent(env: &Env, role: u32, parent: u32, updated_by: &Address) {
    if role == parent {
        panic!("circular_hierarchy");
    }

    // Walking the existing chain upward from `parent` must never reach
    // `role` again, or the new edge would close a cycle.
    let mut current = parent;
    loop {
        if current == role {
            panic!("circular_hierarchy");
        }
        match get_role_parent(env, current) {
            Some(next) => current = next,
            None => break,
        }
    }

    env.storage()
        .instance()
        .set(&DataKey::RoleParent(role), &parent);

    events::emit_role_hierarchy_updated(env, role, parent, updated_by);
}

/// Seed the canonical `SUPER_ADMIN > ADMIN > MODERATOR > PLAYER` chain.
/// Only installs edges that are not already set, so it never clobbers a
/// hierarchy an admin has customized.
pub fn install_default_hierarchy(env: &Env, installed_by: &Address) {
    for (role, parent) in DEFAULT_HIERARCHY {
        if get_role_parent(env, role).is_none() {
            set_role_parent(env, role, parent, installed_by);
        }
    }
}
