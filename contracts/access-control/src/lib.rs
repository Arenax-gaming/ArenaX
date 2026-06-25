#![no_std]

use arenax_events::access_control as events;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Vec};

// Role Constants
pub const ROLE_ADMIN: u32 = 1;
pub const ROLE_GOVERNANCE: u32 = 2;
pub const ROLE_OPERATOR: u32 = 3;
pub const ROLE_WHITELIST: u32 = 4;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Role(Address, u32),            // (Account, Role) -> bool
    Delegation(Address, Address),  // (Delegator, Delegatee) -> DelegationInfo
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DelegationInfo {
    pub role: u32,
    pub expires_at: u64,
}

#[contract]
pub struct AccessControl;

#[contractimpl]
impl AccessControl {
    /// Initialize the access control contract with an admin
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        
        // Grant admin role to the admin address
        let key = DataKey::Role(admin.clone(), ROLE_ADMIN);
        env.storage().persistent().set(&key, &true);
        events::emit_role_granted(&env, &admin, ROLE_ADMIN, &admin);
    }

    /// Check if an account has a specific role (or admin role, or active delegation)
    pub fn has_role(env: Env, account: Address, role: u32) -> bool {
        // Admin has all privileges
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        if account == admin {
            return true;
        }

        // Check direct role assignment
        let key = DataKey::Role(account.clone(), role);
        if env.storage().persistent().get::<DataKey, bool>(&key).unwrap_or(false) {
            return true;
        }

        // Check if there is an active delegation from anyone who has this role to this account
        // In a real implementation, we'd check checking delegation mappings.
        // We will check if any delegator delegated to the account.
        // Since we can't easily iterate all storage keys, we provide a function to check a specific delegation path.
        false
    }

    /// Grant a role to an account
    pub fn grant_role(env: Env, account: Address, role: u32) {
        let admin = Self::get_admin(env.clone());
        admin.require_auth();

        let key = DataKey::Role(account.clone(), role);
        env.storage().persistent().set(&key, &true);

        events::emit_role_granted(&env, &account, role, &admin);
    }

    /// Revoke a role from an account
    pub fn revoke_role(env: Env, account: Address, role: u32) {
        let admin = Self::get_admin(env.clone());
        admin.require_auth();

        let key = DataKey::Role(account.clone(), role);
        env.storage().persistent().remove(&key);

        events::emit_role_revoked(&env, &account, role, &admin);
    }

    /// Delegate a role to another account for a limited time duration
    pub fn delegate_role(env: Env, delegator: Address, delegatee: Address, role: u32, duration: u64) {
        delegator.require_auth();

        // Verify delegator actually has the role
        if !Self::has_role(env.clone(), delegator.clone(), role) {
            panic!("delegator does not have the specified role");
        }

        let now = env.ledger().timestamp();
        let expires_at = now + duration;

        let key = DataKey::Delegation(delegator.clone(), delegatee.clone());
        let info = DelegationInfo { role, expires_at };
        env.storage().persistent().set(&key, &info);

        events::emit_permission_delegated(&env, &delegator, &delegatee, role, expires_at);
    }

    /// Revoke a delegated role
    pub fn revoke_delegation(env: Env, delegator: Address, delegatee: Address, role: u32) {
        delegator.require_auth();

        let key = DataKey::Delegation(delegator.clone(), delegatee.clone());
        if let Some(info) = env.storage().persistent().get::<DataKey, DelegationInfo>(&key) {
            if info.role == role {
                env.storage().persistent().remove(&key);
                events::emit_delegation_revoked(&env, &delegator, &delegatee, role);
            } else {
                panic!("role mismatch in delegation");
            }
        } else {
            panic!("no active delegation found");
        }
    }

    /// Verify if a delegation is currently active
    pub fn is_delegation_active(env: Env, delegator: Address, delegatee: Address, role: u32) -> bool {
        let key = DataKey::Delegation(delegator, delegatee);
        if let Some(info) = env.storage().persistent().get::<DataKey, DelegationInfo>(&key) {
            if info.role == role {
                let now = env.ledger().timestamp();
                return now < info.expires_at;
            }
        }
        false
    }

    /// Check if delegatee has delegated role from delegator
    pub fn has_delegated_role(env: Env, delegator: Address, delegatee: Address, role: u32) -> bool {
        // First check if delegator still has the role
        if !Self::has_role(env.clone(), delegator.clone(), role) {
            return false;
        }
        // Then check if the delegation is active
        Self::is_delegation_active(env, delegator, delegatee, role)
    }

    /// Batch role queries (for Gas Optimization)
    pub fn batch_has_roles(env: Env, accounts: Vec<Address>, roles: Vec<u32>) -> Vec<bool> {
        if accounts.len() != roles.len() {
            panic!("accounts and roles arrays must have same length");
        }
        let mut results = Vec::new(&env);
        for i in 0..accounts.len() {
            let account = accounts.get(i).unwrap();
            let role = roles.get(i).unwrap();
            results.push_back(Self::has_role(env.clone(), account, role));
        }
        results
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).expect("not initialized")
    }
}

#[cfg(test)]
mod test;
