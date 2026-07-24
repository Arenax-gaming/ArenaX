use soroban_sdk::{contractevent, Address, Env, Symbol};

pub const NAMESPACE: &str = "ArenaXContractRegistry";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXCReg_v1", "INIT"])]
pub struct Initialized {
    pub admin: Address,
}

#[contractevent(topics = ["ArenaXCReg_v1", "REGISTERED"])]
pub struct ContractRegistered {
    pub name: Symbol,
    pub address: Address,
    pub registered_by: Address,
}

#[contractevent(topics = ["ArenaXCReg_v1", "UPDATED"])]
pub struct ContractUpdated {
    pub name: Symbol,
    pub old_address: Address,
    pub new_address: Address,
    pub updated_by: Address,
}

#[contractevent(topics = ["ArenaXCReg_v1", "REMOVED"])]
pub struct ContractRemoved {
    pub name: Symbol,
    pub address: Address,
    pub removed_by: Address,
}

#[contractevent(topics = ["ArenaXCReg_v1", "PAUSED"])]
pub struct RegistryPaused {
    pub paused: bool,
    pub paused_by: Address,
}

#[contractevent(topics = ["ArenaXCReg_v1", "VERSION_REGISTERED"])]
pub struct VersionRegistered {
    pub name: Symbol,
    pub version: u32,
    pub deployed_address: Address,
}

#[contractevent(topics = ["ArenaXCReg_v1", "VERSION_ACTIVATED"])]
pub struct VersionActivated {
    pub name: Symbol,
    pub version: u32,
}

#[contractevent(topics = ["ArenaXCReg_v1", "VERSION_DEPRECATED"])]
pub struct VersionDeprecated {
    pub name: Symbol,
    pub version: u32,
}

#[contractevent(topics = ["ArenaXCReg_v1", "CATEGORIZED"])]
pub struct ContractCategorized {
    pub name: Symbol,
    pub category: Symbol,
}

#[contractevent(topics = ["ArenaXCReg_v1", "STATUS_CHANGED"])]
pub struct ContractStatusChanged {
    pub name: Symbol,
    pub status: Symbol,
}

pub fn emit_initialized(env: &Env, admin: &Address) {
    Initialized {
        admin: admin.clone(),
    }
    .publish(env);
}

pub fn emit_contract_registered(
    env: &Env,
    name: Symbol,
    address: &Address,
    registered_by: &Address,
) {
    ContractRegistered {
        name,
        address: address.clone(),
        registered_by: registered_by.clone(),
    }
    .publish(env);
}

pub fn emit_contract_updated(
    env: &Env,
    name: Symbol,
    old_address: &Address,
    new_address: &Address,
    updated_by: &Address,
) {
    ContractUpdated {
        name,
        old_address: old_address.clone(),
        new_address: new_address.clone(),
        updated_by: updated_by.clone(),
    }
    .publish(env);
}

pub fn emit_contract_removed(env: &Env, name: Symbol, address: &Address, removed_by: &Address) {
    ContractRemoved {
        name,
        address: address.clone(),
        removed_by: removed_by.clone(),
    }
    .publish(env);
}

pub fn emit_registry_paused(env: &Env, paused: bool, paused_by: &Address) {
    RegistryPaused {
        paused,
        paused_by: paused_by.clone(),
    }
    .publish(env);
}

pub fn emit_version_registered(env: &Env, name: &Symbol, version: u32, deployed_address: &Address) {
    VersionRegistered {
        name: name.clone(),
        version,
        deployed_address: deployed_address.clone(),
    }
    .publish(env);
}

pub fn emit_version_activated(env: &Env, name: &Symbol, version: u32) {
    VersionActivated {
        name: name.clone(),
        version,
    }
    .publish(env);
}

pub fn emit_version_deprecated(env: &Env, name: &Symbol, version: u32) {
    VersionDeprecated {
        name: name.clone(),
        version,
    }
    .publish(env);
}

pub fn emit_contract_categorized(env: &Env, name: &Symbol, category: &Symbol) {
    ContractCategorized {
        name: name.clone(),
        category: category.clone(),
    }
    .publish(env);
}

pub fn emit_contract_status_changed(env: &Env, name: &Symbol, status: &Symbol) {
    ContractStatusChanged {
        name: name.clone(),
        status: status.clone(),
    }
    .publish(env);
}
