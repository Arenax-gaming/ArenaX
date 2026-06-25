#![no_std]

use contract_standards::{TokenMetadata, TokenRegistry, Ownable};
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    TokenMetadata(Address),
    TokenList,
}

#[contract]
pub struct TokenManager;

#[contractimpl]
impl TokenManager {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TokenList, &Vec::new(&env));
    }

    pub fn admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    pub fn register_token(env: Env, token_address: Address, metadata: TokenMetadata) {
        let admin = Self::admin(env.clone());
        admin.require_auth();

        // Validate metadata
        if metadata.name.is_empty() || metadata.symbol.is_empty() || metadata.decimals > 18 {
            panic!("invalid token metadata");
        }

        // Store metadata
        env.storage()
            .persistent()
            .set(&DataKey::TokenMetadata(token_address.clone()), &metadata);

        // Add to token list
        let mut tokens: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::TokenList)
            .unwrap_or(Vec::new(&env));

        // Avoid duplicates
        let mut exists = false;
        for i in 0..tokens.len() {
            if tokens.get(i).unwrap() == token_address {
                exists = true;
                break;
            }
        }

        if !exists {
            tokens.push_back(token_address);
            env.storage().instance().set(&DataKey::TokenList, &tokens);
        }
    }

    pub fn get_token_metadata(env: Env, token_address: Address) -> TokenMetadata {
        env.storage()
            .persistent()
            .get(&DataKey::TokenMetadata(token_address))
            .expect("token not registered")
    }

    pub fn list_tokens(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::TokenList)
            .unwrap_or(Vec::new(&env))
    }

    pub fn is_token_registered(env: Env, token_address: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::TokenMetadata(token_address))
    }
}

#[cfg(test)]
mod test;
