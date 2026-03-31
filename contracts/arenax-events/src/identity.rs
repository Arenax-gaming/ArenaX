use soroban_sdk::{contractevent, Address, Env};

pub const NAMESPACE: &str = "ArenaXIdentity";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXId_v1", "ROLE_SET"])]
pub struct RoleSet {
    pub user: Address,
    pub role: u32,
}

pub fn emit_role_set(env: &Env, user: &Address, role: u32) {
    RoleSet {
        user: user.clone(),
        role,
    }
    .publish(env);
}
