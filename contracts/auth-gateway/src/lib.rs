#![no_std]

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, Address, Env, Map, Symbol,
};

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

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Role(Address),
    ContractWhitelist(Address),
    Paused,
}

#[contractevent]
pub struct Initialized {
    pub admin: Address,
}

#[contractevent]
pub struct RoleAssigned {
    pub address: Address,
    pub role: Role,
    pub assigned_by: Address,
}

#[contractevent]
pub struct RoleRevoked {
    pub address: Address,
    pub role: Role,
    pub revoked_by: Address,
}

#[contractevent]
pub struct ContractWhitelisted {
    pub contract_address: Address,
    pub whitelisted_by: Address,
}

#[contractevent]
pub struct ContractRemoved {
    pub contract_address: Address,
    pub removed_by: Address,
}

#[contractevent]
pub struct ContractPaused {
    pub paused: bool,
    pub paused_by: Address,
}

#[contract]
pub struct AuthGateway;

#[contractimpl]
impl AuthGateway {
    /// Initialize the authorization gateway with an admin address
    ///
    /// # Arguments
    /// * `admin` - The admin address with full control over the gateway
    ///
    /// # Panics
    /// * If contract is already initialized
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);

        Initialized { admin }.publish(&env);
    }

    /// Assign a role to an address
    ///
    /// # Arguments
    /// * `address` - The address to assign the role to
    /// * `role` - The role to assign
    ///
    /// # Panics
    /// * If contract is paused
    /// * If caller is not admin
    /// * If trying to assign None role (use revoke_role instead)
    pub fn assign_role(env: Env, address: Address, role: Role) {
        Self::require_admin(&env);
        Self::require_not_paused(&env);

        if role == Role::None {
            panic!("use revoke_role to remove roles");
        }

        let admin = env.current_contract_address();
        let current_role = Self::get_role(&env, address.clone());

        env.storage()
            .instance()
            .set(&DataKey::Role(address.clone()), &role);

        RoleAssigned {
            address,
            role,
            assigned_by: admin,
        }
        .publish(&env);
    }

    /// Revoke a role from an address
    ///
    /// # Arguments
    /// * `address` - The address to revoke the role from
    ///
    /// # Panics
    /// * If contract is paused
    /// * If caller is not admin
    /// * If address has no role to revoke
    pub fn revoke_role(env: Env, address: Address) {
        Self::require_admin(&env);
        Self::require_not_paused(&env);

        let current_role = Self::get_role(&env, address.clone());
        if current_role == Role::None {
            panic!("address has no role to revoke");
        }

        let admin = env.current_contract_address();
        env.storage()
            .instance()
            .remove(&DataKey::Role(address.clone()));

        RoleRevoked {
            address,
            role: current_role,
            revoked_by: admin,
        }
        .publish(&env);
    }

    /// Whitelist a contract to use the auth gateway
    ///
    /// # Arguments
    /// * `contract_address` - The contract address to whitelist
    ///
    /// # Panics
    /// * If contract is paused
    /// * If caller is not admin
    /// * If contract is already whitelisted
    pub fn whitelist_contract(env: Env, contract_address: Address) {
        Self::require_admin(&env);
        Self::require_not_paused(&env);

        if env
            .storage()
            .instance()
            .has(&DataKey::ContractWhitelist(contract_address.clone()))
        {
            panic!("contract already whitelisted");
        }

        let admin = env.current_contract_address();
        env.storage()
            .instance()
            .set(&DataKey::ContractWhitelist(contract_address.clone()), &true);

        ContractWhitelisted {
            contract_address,
            whitelisted_by: admin,
        }
        .publish(&env);
    }

    /// Remove a contract from the whitelist
    ///
    /// # Arguments
    /// * `contract_address` - The contract address to remove
    ///
    /// # Panics
    /// * If contract is paused
    /// * If caller is not admin
    /// * If contract is not whitelisted
    pub fn remove_contract(env: Env, contract_address: Address) {
        Self::require_admin(&env);
        Self::require_not_paused(&env);

        if !env
            .storage()
            .instance()
            .has(&DataKey::ContractWhitelist(contract_address.clone()))
        {
            panic!("contract not whitelisted");
        }

        let admin = env.current_contract_address();
        env.storage()
            .instance()
            .remove(&DataKey::ContractWhitelist(contract_address.clone()));

        ContractRemoved {
            contract_address,
            removed_by: admin,
        }
        .publish(&env);
    }

    /// Pause/unpause the contract
    ///
    /// # Arguments
    /// * `paused` - Whether to pause the contract
    ///
    /// # Panics
    /// * If caller is not admin
    pub fn set_paused(env: Env, paused: bool) {
        Self::require_admin(&env);
        let admin = env.current_contract_address();
        
        env.storage().instance().set(&DataKey::Paused, &paused);

        ContractPaused {
            paused,
            paused_by: admin,
        }
        .publish(&env);
    }

    /// Get the role of an address
    ///
    /// # Arguments
    /// * `address` - The address to check
    ///
    /// # Returns
    /// The role of the address (Role::None if no role assigned)
    pub fn get_role(env: Env, address: Address) -> Role {
        env.storage()
            .instance()
            .get(&DataKey::Role(address))
            .unwrap_or(Role::None)
    }

    /// Check if an address has a specific role
    ///
    /// # Arguments
    /// * `address` - The address to check
    /// * `role` - The role to check for
    ///
    /// # Returns
    /// True if the address has the role, false otherwise
    pub fn has_role(env: Env, address: Address, role: Role) -> bool {
        let user_role = Self::get_role(env, address);
        user_role == role
    }

    /// Check if an address has any of the specified roles
    ///
    /// # Arguments
    /// * `address` - The address to check
    /// * `roles` - Array of roles to check against
    ///
    /// # Returns
    /// True if the address has any of the roles, false otherwise
    pub fn has_any_role(env: Env, address: Address, roles: Vec<Role>) -> bool {
        let user_role = Self::get_role(env, address);
        roles.iter().any(|&role| user_role == role)
    }

    /// Check if a contract is whitelisted
    ///
    /// # Arguments
    /// * `contract_address` - The contract address to check
    ///
    /// # Returns
    /// True if the contract is whitelisted, false otherwise
    pub fn is_contract_whitelisted(env: Env, contract_address: Address) -> bool {
        env.storage()
            .instance()
            .has(&DataKey::ContractWhitelist(contract_address))
    }

    /// Get the admin address
    ///
    /// # Returns
    /// The admin address
    ///
    /// # Panics
    /// * If contract is not initialized
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    /// Check if the contract is paused
    ///
    /// # Returns
    /// True if the contract is paused, false otherwise
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Batch role assignment for multiple addresses
    ///
    /// # Arguments
    /// * `addresses` - Array of addresses to assign roles to
    /// * `roles` - Array of roles corresponding to the addresses
    ///
    /// # Panics
    /// * If contract is paused
    /// * If caller is not admin
    /// * If arrays have different lengths
    /// * If any role is None
    pub fn batch_assign_roles(env: Env, addresses: Vec<Address>, roles: Vec<Role>) {
        Self::require_admin(&env);
        Self::require_not_paused(&env);

        if addresses.len() != roles.len() {
            panic!("addresses and roles arrays must have same length");
        }

        for (i, address) in addresses.iter().enumerate() {
            let role = roles.get(i).unwrap();
            if *role == Role::None {
                panic!("use revoke_role to remove roles");
            }
            
            env.storage()
                .instance()
                .set(&DataKey::Role(address.clone()), role);

            RoleAssigned {
                address: address.clone(),
                role: *role,
                assigned_by: env.current_contract_address(),
            }
            .publish(&env);
        }
    }

    /// Get all addresses with a specific role
    ///
    /// # Arguments
    /// * `role` - The role to search for
    ///
    /// # Returns
    /// Array of addresses that have the specified role
    ///
    /// # Note
    /// This is an expensive operation and should be used sparingly
    pub fn get_addresses_with_role(env: Env, role: Role) -> Vec<Address> {
        // In a real implementation, you might want to maintain
        // reverse indexes for better performance
        // For now, this is a placeholder that would need
        // additional storage structures to work efficiently
        Vec::new(&env)
    }

    /// Transfer admin role to a new address
    ///
    /// # Arguments
    /// * `new_admin` - The new admin address
    ///
    /// # Panics
    /// * If caller is not current admin
    /// * If new_admin already has a role (must be None first)
    pub fn transfer_admin(env: Env, new_admin: Address) {
        let current_admin = Self::get_admin(env.clone());
        current_admin.require_auth();

        let new_admin_role = Self::get_role(env.clone(), new_admin.clone());
        if new_admin_role != Role::None {
            panic!("new admin must have no existing role");
        }

        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.storage()
            .instance()
            .set(&DataKey::Role(new_admin.clone()), &Role::Admin);

        RoleAssigned {
            address: new_admin.clone(),
            role: Role::Admin,
            assigned_by: current_admin,
        }
        .publish(&env);

        RoleRevoked {
            address: current_admin,
            role: Role::Admin,
            revoked_by: new_admin,
        }
        .publish(&env);
    }

    // Helper functions for internal use
    
    fn require_admin(env: &Env) {
        let admin = Self::get_admin(env.clone());
        admin.require_auth();
    }

    fn require_not_paused(env: &Env) {
        let paused = Self::is_paused(env.clone());
        if paused {
            panic!("contract is paused");
        }
    }
}
