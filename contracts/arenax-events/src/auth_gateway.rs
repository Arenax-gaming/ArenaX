use soroban_sdk::{contractevent, contracttype, Address, Env};

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Role {
    None = 0,
    Admin = 1,
    Operator = 2,
    Referee = 3,
    Player = 4,
    TournamentManager = 5,
    Treasury = 6,
}

pub const NAMESPACE: &str = "ArenaXAuthGateway";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXAuth_v1", "INIT"])]
pub struct Initialized {
    pub admin: Address,
}

#[contractevent(topics = ["ArenaXAuth_v1", "ROLE_SET"])]
pub struct RoleAssigned {
    pub address: Address,
    pub role: Role,
    pub assigned_by: Address,
}

#[contractevent(topics = ["ArenaXAuth_v1", "ROLE_REV"])]
pub struct RoleRevoked {
    pub address: Address,
    pub role: Role,
    pub revoked_by: Address,
}

#[contractevent(topics = ["ArenaXAuth_v1", "WL_ADD"])]
pub struct ContractWhitelisted {
    pub contract_address: Address,
    pub whitelisted_by: Address,
}

#[contractevent(topics = ["ArenaXAuth_v1", "WL_REM"])]
pub struct ContractRemoved {
    pub contract_address: Address,
    pub removed_by: Address,
}

#[contractevent(topics = ["ArenaXAuth_v1", "PAUSED"])]
pub struct ContractPaused {
    pub paused: bool,
    pub paused_by: Address,
}

pub fn emit_initialized(env: &Env, admin: &Address) {
    Initialized {
        admin: admin.clone(),
    }
    .publish(env);
}

pub fn emit_role_assigned(env: &Env, address: &Address, role: Role, assigned_by: &Address) {
    RoleAssigned {
        address: address.clone(),
        role,
        assigned_by: assigned_by.clone(),
    }
    .publish(env);
}

pub fn emit_role_revoked(env: &Env, address: &Address, role: Role, revoked_by: &Address) {
    RoleRevoked {
        address: address.clone(),
        role,
        revoked_by: revoked_by.clone(),
    }
    .publish(env);
}

pub fn emit_contract_whitelisted(env: &Env, contract_address: &Address, whitelisted_by: &Address) {
    ContractWhitelisted {
        contract_address: contract_address.clone(),
        whitelisted_by: whitelisted_by.clone(),
    }
    .publish(env);
}

pub fn emit_contract_removed(env: &Env, contract_address: &Address, removed_by: &Address) {
    ContractRemoved {
        contract_address: contract_address.clone(),
        removed_by: removed_by.clone(),
    }
    .publish(env);
}

pub fn emit_contract_paused(env: &Env, paused: bool, paused_by: &Address) {
    ContractPaused {
        paused,
        paused_by: paused_by.clone(),
    }
    .publish(env);
}
