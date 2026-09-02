#![no_std]

use arenax_events::{access_control as events, emergency_pause as ep_events};
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol, Vec};

// Role Constants
pub const ROLE_ADMIN: u32 = 1;
pub const ROLE_GOVERNANCE: u32 = 2;
pub const ROLE_OPERATOR: u32 = 3;
pub const ROLE_WHITELIST: u32 = 4;
pub const ROLE_MODERATOR: u32 = 5;
pub const ROLE_TOURNAMENT_ORGANIZER: u32 = 6;
pub const ROLE_GAME_DEVELOPER: u32 = 7;
pub const ROLE_ANALYTICS_VIEWER: u32 = 8;
pub const ROLE_ANALYST: u32 = 8; // Central RBAC Analyst role
pub const ROLE_STAKING_MANAGER: u32 = 9;
pub const ROLE_CROSS_GAME_ADMIN: u32 = 10;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Role(Address, u32),               // (Account, Role) -> bool
    Delegation(Address, Address),     // (Delegator, Delegatee) -> DelegationInfo
    Permission(String),               // (PermissionName) -> PermissionDefinition
    RolePermissions(u32),             // (Role) -> Vec<String>
    PermissionCache(Address, String), // (Account, PermissionName) -> bool
    TimeRestriction(Address, u32),    // (Account, Role) -> TimeRestriction
    AuditLog(u64),                    // (EntryId) -> AuditEntry
    AuditCounter,
    Paused,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DelegationInfo {
    pub role: u32,
    pub expires_at: u64,
    pub max_uses: u64,
    pub current_uses: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PermissionDefinition {
    pub name: String,
    pub description: String,
    pub resource: String,
    pub action: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TimeRestriction {
    pub start_time: u64,
    pub end_time: u64,
    pub allowed_days: Vec<u32>,   // 0=Sunday, 6=Saturday
    pub allowed_hours_start: u32, // 0-23
    pub allowed_hours_end: u32,   // 0-23
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuditEntry {
    pub id: u64,
    pub actor: Address,
    pub action: String,
    pub target: Address,
    pub timestamp: u64,
    pub details: String,
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

        env.storage().instance().set(&DataKey::Paused, &false);

        Self::record_audit_entry_internal(
            &env,
            admin.clone(),
            String::from_str(&env, "INITIALIZE"),
            admin.clone(),
            String::from_str(&env, "Initialized RBAC contract with admin"),
        );
    }

    /// Check if an account has a specific role (or admin role)
    pub fn has_role(env: Env, account: Address, role: u32) -> bool {
        // Admin has all privileges
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        if account == admin {
            return true;
        }

        // Check direct role assignment
        let key = DataKey::Role(account.clone(), role);
        if env
            .storage()
            .persistent()
            .get::<DataKey, bool>(&key)
            .unwrap_or(false)
        {
            return true;
        }

        false
    }

    /// Grant a role to an account
    pub fn grant_role(env: Env, account: Address, role: u32) {
        Self::require_not_paused(&env);
        let admin = Self::get_admin(env.clone());
        admin.require_auth();

        let key = DataKey::Role(account.clone(), role);
        env.storage().persistent().set(&key, &true);

        events::emit_role_granted(&env, &account, role, &admin);

        Self::record_audit_entry_internal(
            &env,
            admin.clone(),
            String::from_str(&env, "GRANT_ROLE"),
            account.clone(),
            String::from_str(&env, "Role granted by admin"),
        );
    }

    /// Revoke a role from an account
    pub fn revoke_role(env: Env, account: Address, role: u32) {
        Self::require_not_paused(&env);
        let admin = Self::get_admin(env.clone());
        admin.require_auth();

        let key = DataKey::Role(account.clone(), role);
        env.storage().persistent().remove(&key);

        events::emit_role_revoked(&env, &account, role, &admin);

        Self::record_audit_entry_internal(
            &env,
            admin.clone(),
            String::from_str(&env, "REVOKE_ROLE"),
            account.clone(),
            String::from_str(&env, "Role revoked by admin"),
        );
    }

    /// Delegate a role to another account for a limited time duration
    pub fn delegate_role(
        env: Env,
        delegator: Address,
        delegatee: Address,
        role: u32,
        duration: u64,
    ) {
        Self::require_not_paused(&env);
        delegator.require_auth();

        if !Self::has_role(env.clone(), delegator.clone(), role) {
            panic!("delegator does not have the specified role");
        }

        let now = env.ledger().timestamp();
        let expires_at = now + duration;

        let key = DataKey::Delegation(delegator.clone(), delegatee.clone());
        let info = DelegationInfo {
            role,
            expires_at,
            max_uses: 0,
            current_uses: 0,
        };
        env.storage().persistent().set(&key, &info);

        events::emit_permission_delegated(&env, &delegator, &delegatee, role, expires_at);

        Self::record_audit_entry_internal(
            &env,
            delegator.clone(),
            String::from_str(&env, "DELEGATE_ROLE"),
            delegatee.clone(),
            String::from_str(&env, "Role delegated"),
        );
    }

    /// Revoke a delegated role
    pub fn revoke_delegation(env: Env, delegator: Address, delegatee: Address, role: u32) {
        Self::require_not_paused(&env);
        delegator.require_auth();

        let key = DataKey::Delegation(delegator.clone(), delegatee.clone());
        if let Some(info) = env
            .storage()
            .persistent()
            .get::<DataKey, DelegationInfo>(&key)
        {
            if info.role == role {
                env.storage().persistent().remove(&key);
                events::emit_delegation_revoked(&env, &delegator, &delegatee, role);

                Self::record_audit_entry_internal(
                    &env,
                    delegator.clone(),
                    String::from_str(&env, "REVOKE_DELEGATION"),
                    delegatee.clone(),
                    String::from_str(&env, "Delegation revoked"),
                );
            } else {
                panic!("role mismatch in delegation");
            }
        } else {
            panic!("no active delegation found");
        }
    }

    /// Verify if a delegation is currently active
    pub fn is_delegation_active(
        env: Env,
        delegator: Address,
        delegatee: Address,
        role: u32,
    ) -> bool {
        let key = DataKey::Delegation(delegator, delegatee);
        if let Some(info) = env
            .storage()
            .persistent()
            .get::<DataKey, DelegationInfo>(&key)
        {
            if info.role == role {
                let now = env.ledger().timestamp();
                return now < info.expires_at;
            }
        }
        false
    }

    /// Check if delegatee has delegated role from delegator
    pub fn has_delegated_role(env: Env, delegator: Address, delegatee: Address, role: u32) -> bool {
        if !Self::has_role(env.clone(), delegator.clone(), role) {
            return false;
        }
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

    // ── Permission Management & Storage Caching ─────────────────────────────

    /// Define a new permission
    pub fn define_permission(
        env: Env,
        name: String,
        description: String,
        resource: String,
        action: String,
    ) {
        Self::require_not_paused(&env);
        Self::require_admin(&env);
        let perm = PermissionDefinition {
            name: name.clone(),
            description,
            resource,
            action,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Permission(name), &perm);
    }

    /// Assign a permission to a role
    pub fn assign_permission_to_role(env: Env, role: u32, permission_name: String) {
        Self::require_not_paused(&env);
        Self::require_admin(&env);
        let key = DataKey::RolePermissions(role);
        let mut perms: Vec<String> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));

        let mut i = 0;
        while i < perms.len() {
            if perms.get(i).unwrap() == permission_name {
                return;
            }
            i += 1;
        }
        perms.push_back(permission_name.clone());
        env.storage().persistent().set(&key, &perms);

        Self::record_audit_entry_internal(
            &env,
            Self::get_admin(env.clone()),
            String::from_str(&env, "ASSIGN_PERMISSION"),
            Self::get_admin(env.clone()),
            permission_name,
        );
    }

    /// Remove a permission from a role
    pub fn remove_permission_from_role(env: Env, role: u32, permission_name: String) {
        Self::require_not_paused(&env);
        Self::require_admin(&env);
        let key = DataKey::RolePermissions(role);
        let perms: Vec<String> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));
        let mut new_perms = Vec::new(&env);
        let mut i = 0;
        while i < perms.len() {
            let p = perms.get(i).unwrap();
            if p != permission_name {
                new_perms.push_back(p);
            }
            i += 1;
        }
        env.storage().persistent().set(&key, &new_perms);

        Self::record_audit_entry_internal(
            &env,
            Self::get_admin(env.clone()),
            String::from_str(&env, "REMOVE_PERMISSION"),
            Self::get_admin(env.clone()),
            permission_name,
        );
    }

    /// Check if a role has a specific permission
    pub fn has_permission(env: Env, role: u32, permission_name: String) -> bool {
        let key = DataKey::RolePermissions(role);
        let perms: Vec<String> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));
        let mut i = 0;
        while i < perms.len() {
            if perms.get(i).unwrap() == permission_name {
                return true;
            }
            i += 1;
        }
        false
    }

    /// Get all permissions for a role
    pub fn get_role_permissions(env: Env, role: u32) -> Vec<String> {
        let key = DataKey::RolePermissions(role);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env))
    }

    /// Check if an account has a specific permission (with storage caching)
    pub fn account_has_permission(env: Env, account: Address, permission_name: String) -> bool {
        let cache_key = DataKey::PermissionCache(account.clone(), permission_name.clone());
        if let Some(cached) = env.storage().persistent().get::<DataKey, bool>(&cache_key) {
            return cached;
        }

        let roles_to_check = soroban_sdk::vec![
            &env,
            ROLE_ADMIN,
            ROLE_GOVERNANCE,
            ROLE_OPERATOR,
            ROLE_WHITELIST,
            ROLE_MODERATOR,
            ROLE_TOURNAMENT_ORGANIZER,
            ROLE_GAME_DEVELOPER,
            ROLE_ANALYTICS_VIEWER,
            ROLE_ANALYST,
            ROLE_STAKING_MANAGER,
            ROLE_CROSS_GAME_ADMIN,
        ];
        let mut has_perm = false;
        let mut i = 0;
        while i < roles_to_check.len() {
            let role = roles_to_check.get(i).unwrap();
            if Self::has_role(env.clone(), account.clone(), role)
                && Self::has_permission(env.clone(), role, permission_name.clone())
            {
                has_perm = true;
                break;
            }
            i += 1;
        }

        // Cache the evaluated result in storage
        env.storage().persistent().set(&cache_key, &has_perm);
        has_perm
    }

    /// Manually clear cached permission evaluation for an account and permission
    pub fn clear_permission_cache(env: Env, account: Address, permission_name: String) {
        let cache_key = DataKey::PermissionCache(account, permission_name);
        env.storage().persistent().remove(&cache_key);
    }

    // ── Time-Based Access ──────────────────────────────────────────────────

    /// Set time restriction for a role
    pub fn set_time_restriction(
        env: Env,
        role: u32,
        start_time: u64,
        end_time: u64,
        allowed_days: Vec<u32>,
        allowed_hours_start: u32,
        allowed_hours_end: u32,
    ) {
        Self::require_admin(&env);
        let restriction = TimeRestriction {
            start_time,
            end_time,
            allowed_days,
            allowed_hours_start,
            allowed_hours_end,
        };
        let admin = Self::get_admin(env.clone());
        let key = DataKey::TimeRestriction(admin, role);
        env.storage().persistent().set(&key, &restriction);
    }

    /// Check if current time allows access for a role
    pub fn is_time_access_allowed(env: Env, role: u32) -> bool {
        let now = env.ledger().timestamp();
        let admin = Self::get_admin(env.clone());
        let key = DataKey::TimeRestriction(admin, role);
        let restriction: TimeRestriction = match env.storage().persistent().get(&key) {
            Some(r) => r,
            None => return true,
        };

        if now < restriction.start_time || now > restriction.end_time {
            return false;
        }

        let day_secs = 86400;
        let day_of_week = ((now / day_secs) % 7) as u32;
        let mut day_allowed = false;
        let mut i = 0;
        while i < restriction.allowed_days.len() {
            if restriction.allowed_days.get(i).unwrap() == day_of_week {
                day_allowed = true;
                break;
            }
            i += 1;
        }

        if !day_allowed {
            return false;
        }

        let hour_of_day = ((now % day_secs) / 3600) as u32;
        hour_of_day >= restriction.allowed_hours_start
            && hour_of_day <= restriction.allowed_hours_end
    }

    // ── Enhanced Delegation ────────────────────────────────────────────────

    pub fn delegate_role_with_limit(
        env: Env,
        delegator: Address,
        delegatee: Address,
        role: u32,
        duration: u64,
        max_uses: u64,
    ) {
        Self::require_not_paused(&env);
        delegator.require_auth();

        if !Self::has_role(env.clone(), delegator.clone(), role) {
            panic!("delegator does not have the specified role");
        }

        let now = env.ledger().timestamp();
        let expires_at = now + duration;

        let key = DataKey::Delegation(delegator.clone(), delegatee.clone());
        let info = DelegationInfo {
            role,
            expires_at,
            max_uses,
            current_uses: 0,
        };
        env.storage().persistent().set(&key, &info);

        events::emit_permission_delegated(&env, &delegator, &delegatee, role, expires_at);

        Self::record_audit_entry_internal(
            &env,
            delegator.clone(),
            String::from_str(&env, "DELEGATE_ROLE_LIMIT"),
            delegatee.clone(),
            String::from_str(&env, "Role delegated with usage limit"),
        );
    }

    pub fn use_delegation(env: Env, delegator: Address, delegatee: Address, role: u32) -> bool {
        let key = DataKey::Delegation(delegator.clone(), delegatee.clone());
        let mut info: DelegationInfo = match env.storage().persistent().get(&key) {
            Some(i) => i,
            None => return false,
        };

        if info.role != role {
            return false;
        }

        let now = env.ledger().timestamp();
        if now >= info.expires_at {
            return false;
        }

        if info.max_uses > 0 && info.current_uses >= info.max_uses {
            return false;
        }

        info.current_uses += 1;
        env.storage().persistent().set(&key, &info);
        true
    }

    // ── Audit Logging & Audit Trail ────────────────────────────────────────

    /// Record an audit entry
    pub fn record_audit_entry(
        env: Env,
        actor: Address,
        action: String,
        target: Address,
        details: String,
    ) {
        Self::record_audit_entry_internal(&env, actor, action, target, details);
    }

    fn record_audit_entry_internal(
        env: &Env,
        actor: Address,
        action: String,
        target: Address,
        details: String,
    ) {
        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::AuditCounter)
            .unwrap_or(0);
        let new_id = counter + 1;

        let entry = AuditEntry {
            id: new_id,
            actor,
            action,
            target,
            timestamp: env.ledger().timestamp(),
            details,
        };

        env.storage()
            .persistent()
            .set(&DataKey::AuditLog(new_id), &entry);
        env.storage()
            .instance()
            .set(&DataKey::AuditCounter, &new_id);
    }

    /// Get an audit entry by ID
    pub fn get_audit_entry(env: Env, entry_id: u64) -> Option<AuditEntry> {
        env.storage().persistent().get(&DataKey::AuditLog(entry_id))
    }

    /// Get total number of audit entries
    pub fn get_audit_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::AuditCounter)
            .unwrap_or(0)
    }

    /// Get range of audit trail entries
    pub fn get_audit_trail(env: Env, start_id: u64, limit: u64) -> Vec<AuditEntry> {
        let mut entries = Vec::new(&env);
        let total = Self::get_audit_count(env.clone());
        let end_id = (start_id + limit).min(total + 1);

        for id in start_id..end_id {
            if let Some(entry) = Self::get_audit_entry(env.clone(), id) {
                entries.push_back(entry);
            }
        }
        entries
    }

    // ── Views ──────────────────────────────────────────────────────────────

    pub fn set_paused(env: Env, paused: bool) {
        Self::require_admin(&env);
        let contract_address = env.current_contract_address();
        let admin = Self::get_admin(env.clone());
        env.storage().instance().set(&DataKey::Paused, &paused);
        if paused {
            ep_events::emit_paused(&env, &contract_address, &admin, &symbol_short!("EMERGENCY"));
        } else {
            ep_events::emit_unpaused(&env, &contract_address, &admin);
        }
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    fn require_admin(env: &Env) {
        let admin = Self::get_admin(env.clone());
        admin.require_auth();
    }

    fn require_not_paused(env: &Env) {
        let paused: bool = env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            panic!("contract is paused");
        }
    }

    pub fn get_permission_definitions(
        env: Env,
        permission_names: Vec<String>,
    ) -> Vec<PermissionDefinition> {
        let mut results = Vec::new(&env);
        let mut i = 0;
        while i < permission_names.len() {
            let name = permission_names.get(i).unwrap();
            if let Some(perm) = env
                .storage()
                .persistent()
                .get::<DataKey, PermissionDefinition>(&DataKey::Permission(name))
            {
                results.push_back(perm);
            }
            i += 1;
        }
        results
    }
}

#[cfg(test)]
mod test;
