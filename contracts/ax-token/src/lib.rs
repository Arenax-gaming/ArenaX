#![no_std]

use soroban_sdk::{
    contracttype, 
    contractimpl, 
    contractevent,
    Address, 
    Env, 
    Map,
    Vec
};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Balance(Address),
    TotalSupply,
}

#[contractevent]
pub struct MintEvent {
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
pub struct BurnEvent {
    pub from: Address,
    pub amount: i128,
}

#[contractevent]
pub struct TransferEvent {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
}

pub struct AxToken;

#[contractimpl]
impl AxToken {
    pub fn initialize(env: &Env, admin: Address) {
        if Self::has_admin(env) {
            panic!("already initialized");
        }
        
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);
    }

    pub fn mint(env: &Env, to: Address, amount: i128) {
        Self::require_admin(env);
        
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let current_balance = Self::balance(env, to.clone());
        let new_balance = current_balance + amount;
        env.storage().instance().set(&DataKey::Balance(to.clone()), &new_balance);

        let current_supply = Self::total_supply(env);
        let new_supply = current_supply + amount;
        env.storage().instance().set(&DataKey::TotalSupply, &new_supply);

        env.events().publish(
            MintEvent {
                to,
                amount,
            }
        );
    }

    pub fn burn(env: &Env, from: Address, amount: i128) {
        Self::require_admin(env);
        
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let current_balance = Self::balance(env, from.clone());
        if current_balance < amount {
            panic!("insufficient balance");
        }

        let new_balance = current_balance - amount;
        env.storage().instance().set(&DataKey::Balance(from.clone()), &new_balance);

        let current_supply = Self::total_supply(env);
        let new_supply = current_supply - amount;
        env.storage().instance().set(&DataKey::TotalSupply, &new_supply);

        env.events().publish(
            BurnEvent {
                from,
                amount,
            }
        );
    }

    pub fn transfer(env: &Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        
        if amount <= 0 {
            panic!("amount must be positive");
        }

        if from == to {
            panic!("cannot transfer to self");
        }

        let from_balance = Self::balance(env, from.clone());
        if from_balance < amount {
            panic!("insufficient balance");
        }

        let new_from_balance = from_balance - amount;
        env.storage().instance().set(&DataKey::Balance(from.clone()), &new_from_balance);

        let to_balance = Self::balance(env, to.clone());
        let new_to_balance = to_balance + amount;
        env.storage().instance().set(&DataKey::Balance(to.clone()), &new_to_balance);

        env.events().publish(
            TransferEvent {
                from,
                to,
                amount,
            }
        );
    }

    pub fn balance(env: &Env, addr: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Balance(addr))
            .unwrap_or(0)
    }

    pub fn total_supply(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    pub fn get_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap()
    }

    pub fn set_admin(env: &Env, new_admin: Address) {
        Self::require_admin(env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    fn has_admin(env: &Env) -> bool {
        env.storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::Admin)
            .is_some()
    }

    fn require_admin(env: &Env) {
        let admin = Self::get_admin(env);
        admin.require_auth();
    }
}
