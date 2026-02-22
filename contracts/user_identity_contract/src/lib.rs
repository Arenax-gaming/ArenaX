#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    UserRole(Address),
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Role {
    Player = 0,
    Referee = 1,
    Admin = 2,
    System = 3,
}

#[contract]
pub struct UserIdentityContract;

#[contractimpl]
impl UserIdentityContract {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn assign_role(env: Env, user: Address, role: u32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        // Validate role u32 can be converted to Role enum (0-3)
        if role > 3 {
            panic!("invalid role");
        }

        env.storage()
            .persistent()
            .set(&DataKey::UserRole(user.clone()), &role);

        // Emit event
        env.events()
            .publish((symbol_short!("role_set"), user), role);
    }

    pub fn get_role(env: Env, user: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::UserRole(user))
            .unwrap_or(0) // Default to Player (0) if no role assigned
    }

    pub fn has_role(env: Env, user: Address, role: u32) -> bool {
        Self::get_role(env, user) == role
    }
}

mod test;
