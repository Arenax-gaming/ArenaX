#![no_std]

mod error;
mod events;
mod storage;

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Vec};

pub use error::RegistryError;
pub use storage::{ContractEntry, DataKey};

#[contract]
pub struct ArenaXRegistry;

#[contractimpl]
impl ArenaXRegistry {
    pub fn initialize(env: Env, admin: Address) -> Result<(), RegistryError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(RegistryError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        let names: Vec<BytesN<32>> = Vec::new(&env);
        env.storage()
            .instance()
            .set(&DataKey::ContractNames, &names);

        events::emit_initialized(&env, &admin, env.ledger().timestamp());
        Ok(())
    }

    pub fn register_contract(
        env: Env,
        name: BytesN<32>,
        address: Address,
    ) -> Result<(), RegistryError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)?;

        admin.require_auth();

        let mut names: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&DataKey::ContractNames)
            .ok_or(RegistryError::NotInitialized)?;

        if names.iter().any(|n| n == name) {
            return Err(RegistryError::ContractAlreadyExists);
        }

        names.push_back(name.clone());
        env.storage()
            .instance()
            .set(&DataKey::ContractNames, &names);

        let timestamp = env.ledger().timestamp();
        let entry = ContractEntry {
            name: name.clone(),
            address: address.clone(),
            registered_at: timestamp,
            updated_at: timestamp,
        };

        env.storage()
            .instance()
            .set(&DataKey::Registry(name.clone()), &entry);

        events::emit_registered(&env, &name, &address, timestamp);
        Ok(())
    }

    pub fn update_contract(
        env: Env,
        name: BytesN<32>,
        address: Address,
    ) -> Result<(), RegistryError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)?;

        admin.require_auth();

        let existing_entry: ContractEntry = env
            .storage()
            .instance()
            .get(&DataKey::Registry(name.clone()))
            .ok_or(RegistryError::ContractNotFound)?;

        let timestamp = env.ledger().timestamp();
        let updated_entry = ContractEntry {
            name: name.clone(),
            address: address.clone(),
            registered_at: existing_entry.registered_at,
            updated_at: timestamp,
        };

        env.storage()
            .instance()
            .set(&DataKey::Registry(name.clone()), &updated_entry);

        events::emit_updated(&env, &name, &existing_entry.address, &address, timestamp);
        Ok(())
    }

    pub fn get_contract(env: Env, name: BytesN<32>) -> Option<Address> {
        let entry: Option<ContractEntry> = env.storage().instance().get(&DataKey::Registry(name));
        entry.map(|e| e.address)
    }

    pub fn list_contracts(env: Env) -> Result<Vec<ContractEntry>, RegistryError> {
        let names: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&DataKey::ContractNames)
            .ok_or(RegistryError::NotInitialized)?;

        let mut entries = Vec::new(&env);
        for name in names.iter() {
            if let Some(entry) = env
                .storage()
                .instance()
                .get::<_, ContractEntry>(&DataKey::Registry(name.clone()))
            {
                entries.push_back(entry);
            }
        }
        Ok(entries)
    }

    pub fn get_admin(env: Env) -> Result<Address, RegistryError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)
    }
}

mod test;
