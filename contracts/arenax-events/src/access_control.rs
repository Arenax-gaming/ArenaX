use soroban_sdk::{contractevent, Address, Env};

#[contractevent(topics = ["AccessControl", "GRANTED"])]
pub struct RoleGranted {
    pub account: Address,
    pub role: u32,
    pub granted_by: Address,
}

#[contractevent(topics = ["AccessControl", "REVOKED"])]
pub struct RoleRevoked {
    pub account: Address,
    pub role: u32,
    pub revoked_by: Address,
}

#[contractevent(topics = ["AccessControl", "DELEGATED"])]
pub struct PermissionDelegated {
    pub delegator: Address,
    pub delegatee: Address,
    pub role: u32,
    pub expires_at: u64,
}

#[contractevent(topics = ["AccessControl", "DEL_REVOKED"])]
pub struct DelegationRevoked {
    pub delegator: Address,
    pub delegatee: Address,
    pub role: u32,
}

/// Emitted when a role's position in the role hierarchy (its immediate
/// senior role) is created or changed (#1559).
#[contractevent(topics = ["AccessControl", "HIERARCHY"])]
pub struct RoleHierarchyUpdated {
    pub role: u32,
    pub parent_role: u32,
    pub updated_by: Address,
}

pub fn emit_role_granted(env: &Env, account: &Address, role: u32, granted_by: &Address) {
    RoleGranted {
        account: account.clone(),
        role,
        granted_by: granted_by.clone(),
    }
    .publish(env);
}

pub fn emit_role_revoked(env: &Env, account: &Address, role: u32, revoked_by: &Address) {
    RoleRevoked {
        account: account.clone(),
        role,
        revoked_by: revoked_by.clone(),
    }
    .publish(env);
}

pub fn emit_permission_delegated(
    env: &Env,
    delegator: &Address,
    delegatee: &Address,
    role: u32,
    expires_at: u64,
) {
    PermissionDelegated {
        delegator: delegator.clone(),
        delegatee: delegatee.clone(),
        role,
        expires_at,
    }
    .publish(env);
}

pub fn emit_delegation_revoked(env: &Env, delegator: &Address, delegatee: &Address, role: u32) {
    DelegationRevoked {
        delegator: delegator.clone(),
        delegatee: delegatee.clone(),
        role,
    }
    .publish(env);
}

pub fn emit_role_hierarchy_updated(env: &Env, role: u32, parent_role: u32, updated_by: &Address) {
    RoleHierarchyUpdated {
        role,
        parent_role,
        updated_by: updated_by.clone(),
    }
    .publish(env);
}
