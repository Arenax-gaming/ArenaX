#![no_std]

use arenax_events::contract_registry as events;
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Contract(Symbol),
    ContractList,
    Paused,
    ContractVersion(Symbol, u32),
    ActiveVersion(Symbol),
    VersionList(Symbol),
    ContractCategory(Symbol),
    ContractStatus(Symbol),
    CategoryList,
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

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractVersion {
    pub version: u32,
    pub address: Address,
    pub deployed_at: u64,
    pub deployed_by: Address,
    pub notes: Symbol,
    pub is_active: bool,
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
        env.storage()
            .instance()
            .set(&DataKey::ContractList, &Vec::<Symbol>::new(&env));
        env.storage()
            .instance()
            .set(&DataKey::CategoryList, &Vec::<Symbol>::new(&env));

        events::emit_initialized(&env, &admin);
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

        // Check if name is empty by comparing with a new empty symbol
        use soroban_sdk::symbol_short;
        if name == symbol_short!("") {
            panic!("contract name cannot be empty");
        }

        if env
            .storage()
            .instance()
            .has(&DataKey::Contract(name.clone()))
        {
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

        events::emit_contract_registered(&env, name, &address, &env.current_contract_address());
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

        events::emit_contract_updated(
            &env,
            name,
            &old_address,
            &new_address,
            &env.current_contract_address(),
        );
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

        let index = contract_list.iter().position(|item| item == name);
        if let Some(idx) = index {
            contract_list.remove(idx.try_into().unwrap());
            env.storage()
                .instance()
                .set(&DataKey::ContractList, &contract_list);
        }

        events::emit_contract_removed(&env, name, &address, &env.current_contract_address());
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
        env.storage().instance().has(&DataKey::Contract(name))
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
        contract_list.len()
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
            let name_clone = name.clone();
            if let Some(contract_info) = env
                .storage()
                .instance()
                .get::<DataKey, ContractInfo>(&DataKey::Contract(name_clone))
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
            let name_clone = name.clone();
            if let Some(contract_info) = env
                .storage()
                .instance()
                .get::<DataKey, ContractInfo>(&DataKey::Contract(name_clone))
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

        events::emit_registry_paused(&env, paused, &admin);
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
            // Check if name is empty by comparing with a new empty symbol
            use soroban_sdk::symbol_short;
            if name == symbol_short!("") {
                panic!("contract name cannot be empty");
            }

            if env
                .storage()
                .instance()
                .has(&DataKey::Contract(name.clone()))
            {
                panic!("contract name already registered");
            }

            let address = addresses.get(i.try_into().unwrap()).unwrap();
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

            events::emit_contract_registered(
                &env,
                name.clone(),
                &address,
                &env.current_contract_address(),
            );
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

    // Version Management Functions

    /// Register a new version of a contract
    ///
    /// The first version registered for a contract name automatically becomes
    /// the active version. Subsequent versions are registered as inactive.
    ///
    /// # Arguments
    /// * `admin` - The admin address (must be authorized)
    /// * `name` - The contract name this version belongs to
    /// * `version` - The version number (must be unique per contract name)
    /// * `address` - The address where this version is deployed
    /// * `notes` - A symbol note describing this version
    ///
    /// # Panics
    /// * If contract is paused
    /// * If caller is not admin
    /// * If version already exists for this contract name
    /// * If contract name is not registered
    pub fn register_version(
        env: Env,
        admin: Address,
        name: Symbol,
        version: u32,
        address: Address,
        notes: Symbol,
    ) {
        admin.require_auth();
        Self::require_not_paused(&env);

        if !env
            .storage()
            .instance()
            .has(&DataKey::Contract(name.clone()))
        {
            panic!("contract not registered");
        }

        if env
            .storage()
            .instance()
            .has(&DataKey::ContractVersion(name.clone(), version))
        {
            panic!("version already exists");
        }

        let version_list: Vec<u32> = env
            .storage()
            .instance()
            .get(&DataKey::VersionList(name.clone()))
            .unwrap_or(Vec::new(&env));

        let is_active = version_list.is_empty();

        let contract_version = ContractVersion {
            version,
            address: address.clone(),
            deployed_at: env.ledger().timestamp(),
            deployed_by: admin.clone(),
            notes,
            is_active,
        };

        env.storage().instance().set(
            &DataKey::ContractVersion(name.clone(), version),
            &contract_version,
        );

        let mut new_version_list = version_list;
        new_version_list.push_back(version);
        env.storage()
            .instance()
            .set(&DataKey::VersionList(name.clone()), &new_version_list);

        if is_active {
            env.storage()
                .instance()
                .set(&DataKey::ActiveVersion(name.clone()), &version);
            events::emit_version_activated(&env, &name, version);
        }

        events::emit_version_registered(&env, &name, version, &address);
    }

    /// Get the currently active version for a contract
    ///
    /// # Arguments
    /// * `name` - The contract name to look up
    ///
    /// # Returns
    /// The active ContractVersion
    ///
    /// # Panics
    /// * If no active version exists for the contract name
    pub fn get_active_version(env: Env, name: Symbol) -> ContractVersion {
        let version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ActiveVersion(name.clone()))
            .expect("no active version for contract");

        env.storage()
            .instance()
            .get(&DataKey::ContractVersion(name, version))
            .expect("active version not found")
    }

    /// Set a specific version as the active version
    ///
    /// Use this to rollback to a previous version or promote a new one.
    /// All previously active versions are marked as inactive.
    ///
    /// # Arguments
    /// * `admin` - The admin address (must be authorized)
    /// * `name` - The contract name
    /// * `version` - The version number to activate
    ///
    /// # Panics
    /// * If contract is paused
    /// * If caller is not admin
    /// * If the version does not exist for this contract name
    pub fn set_active_version(env: Env, admin: Address, name: Symbol, version: u32) {
        admin.require_auth();
        Self::require_not_paused(&env);

        let mut contract_version: ContractVersion = env
            .storage()
            .instance()
            .get(&DataKey::ContractVersion(name.clone(), version))
            .expect("version not found");

        // Deactivate the current active version if one exists
        if let Some(current_active_version) = env
            .storage()
            .instance()
            .get::<DataKey, u32>(&DataKey::ActiveVersion(name.clone()))
        {
            if current_active_version != version {
                let mut old_version: ContractVersion = env
                    .storage()
                    .instance()
                    .get(&DataKey::ContractVersion(
                        name.clone(),
                        current_active_version,
                    ))
                    .expect("current active version not found");
                old_version.is_active = false;
                env.storage().instance().set(
                    &DataKey::ContractVersion(name.clone(), current_active_version),
                    &old_version,
                );
            }
        }

        contract_version.is_active = true;
        env.storage().instance().set(
            &DataKey::ContractVersion(name.clone(), version),
            &contract_version,
        );

        env.storage()
            .instance()
            .set(&DataKey::ActiveVersion(name.clone()), &version);

        events::emit_version_activated(&env, &name, version);
    }

    /// Get a specific version of a contract
    ///
    /// # Arguments
    /// * `name` - The contract name
    /// * `version` - The version number to retrieve
    ///
    /// # Returns
    /// The ContractVersion for the specified version
    ///
    /// # Panics
    /// * If the version does not exist
    pub fn get_version(env: Env, name: Symbol, version: u32) -> ContractVersion {
        env.storage()
            .instance()
            .get(&DataKey::ContractVersion(name, version))
            .expect("version not found")
    }

    /// Get all versions registered for a contract
    ///
    /// # Arguments
    /// * `name` - The contract name
    ///
    /// # Returns
    /// Vector of all ContractVersion entries for the contract
    pub fn get_version_history(env: Env, name: Symbol) -> Vec<ContractVersion> {
        let version_list: Vec<u32> = env
            .storage()
            .instance()
            .get(&DataKey::VersionList(name.clone()))
            .unwrap_or(Vec::new(&env));

        let mut result = Vec::new(&env);
        for v in version_list.iter() {
            if let Some(contract_version) = env
                .storage()
                .instance()
                .get::<DataKey, ContractVersion>(&DataKey::ContractVersion(name.clone(), v))
            {
                result.push_back(contract_version);
            }
        }
        result
    }

    /// Mark a version as deprecated (inactive)
    ///
    /// This sets the version's `is_active` flag to false. If this was the
    /// active version, there will be no active version until `set_active_version`
    /// is called.
    ///
    /// # Arguments
    /// * `admin` - The admin address (must be authorized)
    /// * `name` - The contract name
    /// * `version` - The version number to deprecate
    ///
    /// # Panics
    /// * If contract is paused
    /// * If caller is not admin
    /// * If the version does not exist
    pub fn deprecate_version(env: Env, admin: Address, name: Symbol, version: u32) {
        admin.require_auth();
        Self::require_not_paused(&env);

        let mut contract_version: ContractVersion = env
            .storage()
            .instance()
            .get(&DataKey::ContractVersion(name.clone(), version))
            .expect("version not found");

        contract_version.is_active = false;
        env.storage().instance().set(
            &DataKey::ContractVersion(name.clone(), version),
            &contract_version,
        );

        // If this was the active version, remove the active pointer
        if let Some(active_version) = env
            .storage()
            .instance()
            .get::<DataKey, u32>(&DataKey::ActiveVersion(name.clone()))
        {
            if active_version == version {
                env.storage()
                    .instance()
                    .remove(&DataKey::ActiveVersion(name.clone()));
            }
        }

        events::emit_version_deprecated(&env, &name, version);
    }

    /// Get the most recently registered version for a contract
    ///
    /// # Arguments
    /// * `name` - The contract name
    ///
    /// # Returns
    /// The most recently registered ContractVersion
    ///
    /// # Panics
    /// * If no versions exist for the contract name
    pub fn get_latest_version(env: Env, name: Symbol) -> ContractVersion {
        let version_list: Vec<u32> = env
            .storage()
            .instance()
            .get(&DataKey::VersionList(name.clone()))
            .expect("no versions registered");

        let latest_version = version_list
            .get(version_list.len() - 1)
            .expect("version list is empty");

        env.storage()
            .instance()
            .get(&DataKey::ContractVersion(name, latest_version))
            .expect("latest version not found")
    }

    // Discovery Functions

    /// Get the contract name by its deployed address (reverse lookup)
    ///
    /// # Arguments
    /// * `address` - The deployed contract address to look up
    ///
    /// # Returns
    /// The contract name associated with the address
    ///
    /// # Panics
    /// * If no contract is registered with the given address
    pub fn get_contract_by_address(env: Env, address: Address) -> Symbol {
        let contract_list: Vec<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::ContractList)
            .unwrap_or(Vec::new(&env));

        for name in contract_list.iter() {
            let name_clone = name.clone();
            if let Some(contract_info) = env
                .storage()
                .instance()
                .get::<DataKey, ContractInfo>(&DataKey::Contract(name_clone))
            {
                if contract_info.address == address {
                    return name;
                }
            }
        }
        panic!("no contract found for address");
    }

    /// Get all contracts in a specific category
    ///
    /// # Arguments
    /// * `category` - The category to filter by
    ///
    /// # Returns
    /// Vector of contract names in the category
    pub fn get_contracts_by_category(env: Env, category: Symbol) -> Vec<Symbol> {
        let contract_list: Vec<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::ContractList)
            .unwrap_or(Vec::new(&env));

        let mut result = Vec::new(&env);
        for name in contract_list.iter() {
            let name_clone = name.clone();
            if let Some(cat) = env
                .storage()
                .instance()
                .get::<DataKey, Symbol>(&DataKey::ContractCategory(name_clone))
            {
                if cat == category {
                    result.push_back(name);
                }
            }
        }
        result
    }

    /// Set the category for a contract
    ///
    /// # Arguments
    /// * `admin` - The admin address (must be authorized)
    /// * `name` - The contract name
    /// * `category` - The category to assign
    ///
    /// # Panics
    /// * If contract is paused
    /// * If caller is not admin
    /// * If contract name is not registered
    pub fn set_contract_category(env: Env, admin: Address, name: Symbol, category: Symbol) {
        admin.require_auth();
        Self::require_not_paused(&env);

        if !env
            .storage()
            .instance()
            .has(&DataKey::Contract(name.clone()))
        {
            panic!("contract not registered");
        }

        env.storage()
            .instance()
            .set(&DataKey::ContractCategory(name.clone()), &category);

        let mut category_list: Vec<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::CategoryList)
            .unwrap_or(Vec::new(&env));

        if !category_list.contains(&category) {
            category_list.push_back(category.clone());
            env.storage()
                .instance()
                .set(&DataKey::CategoryList, &category_list);
        }

        events::emit_contract_categorized(&env, &name, &category);
    }

    /// List all registered categories
    ///
    /// # Returns
    /// Vector of all unique category symbols
    pub fn list_categories(env: Env) -> Vec<Symbol> {
        env.storage()
            .instance()
            .get(&DataKey::CategoryList)
            .unwrap_or(Vec::new(&env))
    }

    /// Search for contracts by name prefix
    ///
    /// # Arguments
    /// * `prefix` - The prefix to search for
    ///
    /// # Returns
    /// Vector of contract names that start with the given prefix
    pub fn search_contracts(env: Env, prefix: Symbol) -> Vec<Symbol> {
        let contract_list: Vec<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::ContractList)
            .unwrap_or(Vec::new(&env));

        // Serialize symbols via XDR so we can compare raw name bytes without
        // heap allocation. XDR layout is [4-byte SCVal discriminant][4-byte
        // big-endian length][string bytes padded to 4-byte alignment], so the
        // actual name bytes start at offset 8 and their real length is the
        // length field.
        const XDR_HEADER: u32 = 8;
        let prefix_xdr = prefix.clone().to_xdr(&env);
        let prefix_len = u32::from_be_bytes([
            prefix_xdr.get(4).unwrap(),
            prefix_xdr.get(5).unwrap(),
            prefix_xdr.get(6).unwrap(),
            prefix_xdr.get(7).unwrap(),
        ]);

        let mut result = Vec::new(&env);
        for name in contract_list.iter() {
            let name_xdr = name.clone().to_xdr(&env);
            if name_xdr.len() >= prefix_xdr.len() {
                let mut matches = true;
                let mut i = 0u32;
                while i < prefix_len {
                    if name_xdr.get(XDR_HEADER + i) != prefix_xdr.get(XDR_HEADER + i) {
                        matches = false;
                        break;
                    }
                    i += 1;
                }
                if matches {
                    result.push_back(name);
                }
            }
        }
        result
    }

    // Contract Status Functions

    /// Set the status of a contract (e.g. active, deprecated, suspended)
    ///
    /// # Arguments
    /// * `admin` - The admin address (must be authorized)
    /// * `name` - The contract name
    /// * `status` - The status to set
    ///
    /// # Panics
    /// * If contract is paused
    /// * If caller is not admin
    /// * If contract name is not registered
    pub fn set_contract_status(env: Env, admin: Address, name: Symbol, status: Symbol) {
        admin.require_auth();
        Self::require_not_paused(&env);

        if !env
            .storage()
            .instance()
            .has(&DataKey::Contract(name.clone()))
        {
            panic!("contract not registered");
        }

        env.storage()
            .instance()
            .set(&DataKey::ContractStatus(name.clone()), &status);

        events::emit_contract_status_changed(&env, &name, &status);
    }

    /// Get the status of a contract
    ///
    /// # Arguments
    /// * `name` - The contract name
    ///
    /// # Returns
    /// The status Symbol of the contract
    ///
    /// # Panics
    /// * If contract name is not registered
    pub fn get_contract_status(env: Env, name: Symbol) -> Symbol {
        if !env
            .storage()
            .instance()
            .has(&DataKey::Contract(name.clone()))
        {
            panic!("contract not registered");
        }

        env.storage()
            .instance()
            .get(&DataKey::ContractStatus(name))
            .unwrap_or(Symbol::new(&env, "active"))
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

#[cfg(test)]
mod test;
