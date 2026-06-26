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

pub fn emit_permission_delegated(env: &Env, delegator: &Address, delegatee: &Address, role: u32, expires_at: u64) {
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
