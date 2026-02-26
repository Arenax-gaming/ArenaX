#![no_std]

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, Address, Env, Map, Symbol, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Contract(Symbol),
    ContractList,
    Paused,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractInfo {
    pub address: Address,
    pub name: Symbol,
    pub registered_at: u64,
    pub updated_at: Option<u64>,
    pub registered_by: Address,
}

#[contractevent]
pub struct Initialized {
    pub admin: Address,
}

#[contractevent]
pub struct ContractRegistered {
    pub name: Symbol,
    pub address: Address,
    pub registered_by: Address,
}

#[contractevent]
pub struct ContractUpdated {
    pub name: Symbol,
    pub old_address: Address,
    pub new_address: Address,
    pub updated_by: Address,
}

#[contractevent]
pub struct ContractRemoved {
    pub name: Symbol,
    pub address: Address,
    pub removed_by: Address,
}

#[contractevent]
pub struct RegistryPaused {
    pub paused: bool,
    pub paused_by: Address,
}

#[contract]
pub struct ContractRegistry;

#[contractimpl]
impl ContractRegistry {
    /// Initialize the contract registry with an admin address
    ///
    /// # Arguments
    /// * `admin` - The admin address with full control over the registry
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
        env.storage().instance().set(&DataKey::ContractList, &Vec::<Symbol>::new(&env));

        Initialized { admin }.publish(&env);
    }

    /// Register a new contract with a unique name
    ///
    /// # Arguments
    /// * `name` - Unique identifier for the contract
    /// * `address` - The contract address to register
    ///
    /// # Panics
    /// * If contract is paused
    /// * If caller is not admin
    /// * If name is already registered
    /// * If name is empty
    pub fn register_contract(env: Env, name: Symbol, address: Address) {
        Self::require_admin(&env);
        Self::require_not_paused(&env);

        if name.is_empty() {
            panic!("contract name cannot be empty");
        }

        if env.storage().instance().has(&DataKey::Contract(name.clone())) {
            panic!("contract name already registered");
        }

        let contract_info = ContractInfo {
            address: address.clone(),
            name: name.clone(),
            registered_at: env.ledger().timestamp(),
            updated_at: None,
            registered_by: env.current_contract_address(),
        };

        env.storage()
            .instance()
            .set(&DataKey::Contract(name.clone()), &contract_info);

        let mut contract_list: Vec<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::ContractList)
            .unwrap_or(Vec::new(&env));
        
        contract_list.push_back(name.clone());
        env.storage()
            .instance()
            .set(&DataKey::ContractList, &contract_list);

        ContractRegistered {
            name,
            address,
            registered_by: env.current_contract_address(),
        }
        .publish(&env);
    }

    /// Update an existing contract's address
    ///
    /// # Arguments
    /// * `name` - The name of the contract to update
    /// * `new_address` - The new contract address
    ///
    /// # Panics
    /// * If contract is paused
    /// * If caller is not admin
    /// * If contract name is not registered
    /// * If new address is the same as current address
    pub fn update_contract(env: Env, name: Symbol, new_address: Address) {
        Self::require_admin(&env);
        Self::require_not_paused(&env);

        let mut contract_info: ContractInfo = env
            .storage()
            .instance()
            .get(&DataKey::Contract(name.clone()))
            .expect("contract not registered");

        if contract_info.address == new_address {
            panic!("new address is the same as current address");
        }

        let old_address = contract_info.address.clone();
        contract_info.address = new_address.clone();
        contract_info.updated_at = Some(env.ledger().timestamp());

        env.storage()
            .instance()
            .set(&DataKey::Contract(name.clone()), &contract_info);

        ContractUpdated {
            name,
            old_address,
            new_address,
            updated_by: env.current_contract_address(),
        }
        .publish(&env);
    }

    /// Remove a contract from the registry
    ///
    /// # Arguments
    /// * `name` - The name of the contract to remove
    ///
    /// # Panics
    /// * If contract is paused
    /// * If caller is not admin
    /// * If contract name is not registered
    pub fn remove_contract(env: Env, name: Symbol) {
        Self::require_admin(&env);
        Self::require_not_paused(&env);

        let contract_info: ContractInfo = env
            .storage()
            .instance()
            .get(&DataKey::Contract(name.clone()))
            .expect("contract not registered");

        let address = contract_info.address.clone();

        env.storage()
            .instance()
            .remove(&DataKey::Contract(name.clone()));

        let mut contract_list: Vec<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::ContractList)
            .unwrap_or(Vec::new(&env));

        let index = contract_list.iter().position(|&item| item == name);
        if let Some(idx) = index {
            contract_list.remove(idx);
            env.storage()
                .instance()
                .set(&DataKey::ContractList, &contract_list);
        }

        ContractRemoved {
            name,
            address,
            removed_by: env.current_contract_address(),
        }
        .publish(&env);
    }

    /// Get the address of a registered contract
    ///
    /// # Arguments
    /// * `name` - The name of the contract to look up
    ///
    /// # Returns
    /// The contract address
    ///
    /// # Panics
    /// * If contract name is not registered
    pub fn get_contract(env: Env, name: Symbol) -> Address {
        let contract_info: ContractInfo = env
            .storage()
            .instance()
            .get(&DataKey::Contract(name))
            .expect("contract not registered");
        contract_info.address
    }

    /// Get detailed information about a registered contract
    ///
    /// # Arguments
    /// * `name` - The name of the contract to look up
    ///
    /// # Returns
    /// The contract information including metadata
    ///
    /// # Panics
    /// * If contract name is not registered
    pub fn get_contract_info(env: Env, name: Symbol) -> ContractInfo {
        env.storage()
            .instance()
            .get(&DataKey::Contract(name))
            .expect("contract not registered")
    }

    /// Check if a contract name is registered
    ///
    /// # Arguments
    /// * `name` - The name to check
    ///
    /// # Returns
    /// True if the name is registered, false otherwise
    pub fn is_contract_registered(env: Env, name: Symbol) -> bool {
        env.storage()
            .instance()
            .has(&DataKey::Contract(name))
    }

    /// Get a list of all registered contract names
    ///
    /// # Returns
    /// Vector of all registered contract names
    pub fn list_contracts(env: Env) -> Vec<Symbol> {
        env.storage()
            .instance()
            .get(&DataKey::ContractList)
            .unwrap_or(Vec::new(&env))
    }

    /// Get the total number of registered contracts
    ///
    /// # Returns
    /// The count of registered contracts
    pub fn get_contract_count(env: Env) -> u32 {
        let contract_list: Vec<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::ContractList)
            .unwrap_or(Vec::new(&env));
        contract_list.len() as u32
    }

    /// Get all contracts registered by a specific address
    ///
    /// # Arguments
    /// * `registered_by` - The address to filter by
    ///
    /// # Returns
    /// Vector of contract names registered by the address
    pub fn get_contracts_by_registrar(env: Env, registered_by: Address) -> Vec<Symbol> {
        let contract_list: Vec<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::ContractList)
            .unwrap_or(Vec::new(&env));

        let mut result = Vec::new(&env);
        for name in contract_list.iter() {
            if let Some(contract_info) = env
                .storage()
                .instance()
                .get::<DataKey, ContractInfo>(&DataKey::Contract(name))
            {
                if contract_info.registered_by == registered_by {
                    result.push_back(name);
                }
            }
        }
        result
    }

    /// Get contracts updated within a specific time range
    ///
    /// # Arguments
    /// * `start_time` - Start timestamp (inclusive)
    /// * `end_time` - End timestamp (inclusive)
    ///
    /// # Returns
    /// Vector of contract names updated in the time range
    pub fn get_contracts_updated_in_range(env: Env, start_time: u64, end_time: u64) -> Vec<Symbol> {
        let contract_list: Vec<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::ContractList)
            .unwrap_or(Vec::new(&env));

        let mut result = Vec::new(&env);
        for name in contract_list.iter() {
            if let Some(contract_info) = env
                .storage()
                .instance()
                .get::<DataKey, ContractInfo>(&DataKey::Contract(name))
            {
                if let Some(updated_at) = contract_info.updated_at {
                    if updated_at >= start_time && updated_at <= end_time {
                        result.push_back(name);
                    }
                }
            }
        }
        result
    }

    /// Pause/unpause the contract registry
    ///
    /// # Arguments
    /// * `paused` - Whether to pause the registry
    ///
    /// # Panics
    /// * If caller is not admin
    pub fn set_paused(env: Env, paused: bool) {
        Self::require_admin(&env);
        let admin = env.current_contract_address();
        
        env.storage().instance().set(&DataKey::Paused, &paused);

        RegistryPaused {
            paused,
            paused_by: admin,
        }
        .publish(&env);
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

    /// Check if the contract registry is paused
    ///
    /// # Returns
    /// True if the registry is paused, false otherwise
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Batch register multiple contracts
    ///
    /// # Arguments
    /// * `names` - Array of contract names
    /// * `addresses` - Array of contract addresses
    ///
    /// # Panics
    /// * If contract is paused
    /// * If caller is not admin
    /// * If arrays have different lengths
    /// * If any name is already registered or empty
    pub fn batch_register_contracts(env: Env, names: Vec<Symbol>, addresses: Vec<Address>) {
        Self::require_admin(&env);
        Self::require_not_paused(&env);

        if names.len() != addresses.len() {
            panic!("names and addresses arrays must have same length");
        }

        for (i, name) in names.iter().enumerate() {
            if name.is_empty() {
                panic!("contract name cannot be empty");
            }

            if env.storage().instance().has(&DataKey::Contract(name.clone())) {
                panic!("contract name already registered");
            }

            let address = addresses.get(i).unwrap();
            let contract_info = ContractInfo {
                address: address.clone(),
                name: name.clone(),
                registered_at: env.ledger().timestamp(),
                updated_at: None,
                registered_by: env.current_contract_address(),
            };

            env.storage()
                .instance()
                .set(&DataKey::Contract(name.clone()), &contract_info);

            ContractRegistered {
                name: name.clone(),
                address: address.clone(),
                registered_by: env.current_contract_address(),
            }
            .publish(&env);
        }

        let mut contract_list: Vec<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::ContractList)
            .unwrap_or(Vec::new(&env));

        for name in names.iter() {
            contract_list.push_back(name.clone());
        }

        env.storage()
            .instance()
            .set(&DataKey::ContractList, &contract_list);
    }

    /// Transfer admin role to a new address
    ///
    /// # Arguments
    /// * `new_admin` - The new admin address
    ///
    /// # Panics
    /// * If caller is not current admin
    pub fn transfer_admin(env: Env, new_admin: Address) {
        let current_admin = Self::get_admin(env.clone());
        current_admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);
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
