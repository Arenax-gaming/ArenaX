#![no_std]

mod error;
mod events;
mod storage;

use soroban_sdk::auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation};
use soroban_sdk::{contract, contractimpl, Address, Env, IntoVal, Symbol, Vec};
use storage::{AntiCheatConfirmation, DataKey};

pub use error::AntiCheatError;

/// Severity levels: 1 = low, 2 = medium, 3 = high. Maps to bounded penalties (capped in Reputation Index).
const PENALTY_LOW: i128 = 5;
const PENALTY_MEDIUM: i128 = 15;
const PENALTY_HIGH: i128 = 30;

#[contract]
pub struct AntiCheatOracle;

#[contractimpl]
impl AntiCheatOracle {
    /// Initialize the anti-cheat oracle (admin only).
    pub fn initialize(env: Env, admin: Address) -> Result<(), AntiCheatError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(AntiCheatError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    /// Add an authorized oracle address that can submit flags.
    pub fn add_authorized_oracle(env: Env, oracle: Address) -> Result<(), AntiCheatError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(AntiCheatError::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedOracle(oracle.clone()), &true);
        Ok(())
    }

    /// Remove an authorized oracle.
    pub fn remove_authorized_oracle(env: Env, oracle: Address) -> Result<(), AntiCheatError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(AntiCheatError::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .remove(&DataKey::AuthorizedOracle(oracle));
        Ok(())
    }

    /// Returns true if the given address is an authorized oracle.
    pub fn is_authorized_oracle(env: Env, oracle: Address) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::AuthorizedOracle(oracle))
            .unwrap_or(false)
    }

    /// Set the Reputation Index contract address (admin only). Required before submit_flag can apply penalties.
    pub fn set_reputation_contract(env: Env, reputation: Address) -> Result<(), AntiCheatError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(AntiCheatError::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::ReputationContract, &reputation);
        Ok(())
    }

    /// Submit an anti-cheat flag for a player in a match. Only authorized oracle addresses can call.
    /// Severity: 1 = low, 2 = medium, 3 = high. Penalties are bounded and applied to the Reputation Index.
    pub fn submit_flag(
        env: Env,
        oracle: Address,
        player: Address,
        match_id: u64,
        severity: u32,
    ) -> Result<(), AntiCheatError> {
        oracle.require_auth();
        if !Self::is_authorized_oracle(env.clone(), oracle.clone()) {
            return Err(AntiCheatError::Unauthorized);
        }
        if severity == 0 || severity > 3 {
            return Err(AntiCheatError::InvalidSeverity);
        }

        let penalty = match severity {
            1 => PENALTY_LOW,
            2 => PENALTY_MEDIUM,
            3 => PENALTY_HIGH,
            _ => return Err(AntiCheatError::InvalidSeverity),
        };

        let timestamp = env.ledger().timestamp();
        let confirmation = AntiCheatConfirmation {
            player: player.clone(),
            match_id,
            severity,
            penalty_applied: penalty,
            timestamp,
            oracle: oracle.clone(),
        };
        env.storage()
            .instance()
            .set(&DataKey::Confirmation(player.clone(), match_id), &confirmation);

        if let Some(reputation_addr) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::ReputationContract)
        {
            let mut args = Vec::new(&env);
            args.push_back(env.current_contract_address().into_val(&env));
            args.push_back(player.clone().into_val(&env));
            args.push_back(match_id.into_val(&env));
            args.push_back(penalty.into_val(&env));
            let context = ContractContext {
                contract: reputation_addr.clone(),
                fn_name: Symbol::new(&env, "apply_anticheat_penalty"),
                args,
            };
            let sub_invocations: Vec<InvokerContractAuthEntry> = Vec::new(&env);
            let mut auth_entries = Vec::new(&env);
            auth_entries.push_back(InvokerContractAuthEntry::Contract(SubContractInvocation {
                context,
                sub_invocations,
            }));
            env.authorize_as_current_contract(auth_entries);
            let args = (
                env.current_contract_address(),
                player.clone(),
                match_id,
                penalty,
            )
                .into_val(&env);
            let _: () = env.invoke_contract(
                &reputation_addr,
                &Symbol::new(&env, "apply_anticheat_penalty"),
                args,
            );
        }

        events::emit_anticheat_flag(
            &env,
            &player,
            match_id,
            severity,
            penalty,
            &oracle,
            timestamp,
        );
        Ok(())
    }

    /// Get the confirmation for a (player, match_id), if any. For consumers and auditing.
    pub fn get_confirmation(
        env: Env,
        player: Address,
        match_id: u64,
    ) -> Option<AntiCheatConfirmation> {
        env.storage()
            .instance()
            .get(&DataKey::Confirmation(player, match_id))
    }
}

#[cfg(test)]
mod test;
