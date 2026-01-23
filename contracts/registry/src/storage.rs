use soroban_sdk::{contracttype, Address, BytesN};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Registry(BytesN<32>),
    ContractNames,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractEntry {
    pub name: BytesN<32>,
    pub address: Address,
    pub registered_at: u64,
    pub updated_at: u64,
}
