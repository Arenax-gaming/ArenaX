use soroban_sdk::{contracttype, Bytes, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    LatestVersion(Symbol), 
    Param(Symbol, u32), // (Key, Version) -> Value
}

pub type ParamKey = Symbol;
pub type ParamValue = Bytes;
pub type Version = u32;
