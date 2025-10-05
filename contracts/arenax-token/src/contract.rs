use crate::{admin, allowance, balance, errors::TokenError, event, metadata, storage_types::DataKey};
use soroban_sdk::{contract, contractimpl, Address, Env, String};

#[contract]
pub struct ArenaXToken;

#[contractimpl]
impl ArenaXToken {
    /// Initialize the token contract
    pub fn initialize(
        env: Env,
        admin: Address,
        decimal: u32,
        name: String,
        symbol: String,
    ) -> Result<(), TokenError> {
        // Check if already initialized
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(TokenError::AlreadyInitialized);
        }

        if decimal > 18 {
            return Err(TokenError::InvalidDecimals);
        }

        admin.require_auth();

        // Mark as initialized
        env.storage().instance().set(&DataKey::Initialized, &true);

        admin::write_admin(&env, &admin);
        metadata::write_metadata(&env, decimal, name, symbol);

        // Initialize total supply to 0
        admin::write_total_supply(&env, 0);

        Ok(())
    }

    /// Mint new tokens (admin only)
    pub fn mint(env: Env, to: Address, amount: i128) -> Result<(), TokenError> {
        Self::check_nonnegative_amount(amount)?;

        let admin = admin::read_admin(&env)?;
        admin.require_auth();

        // Use checked arithmetic to prevent overflow
        let current_balance = balance::read_balance(&env, &to);
        let new_balance = current_balance
            .checked_add(amount)
            .ok_or(TokenError::Overflow)?;

        balance::write_balance(&env, &to, new_balance);

        // Update total supply
        let total = admin::read_total_supply(&env);
        let new_total = total.checked_add(amount).ok_or(TokenError::Overflow)?;
        admin::write_total_supply(&env, new_total);

        event::mint(&env, to, amount);
        Ok(())
    }

    /// Set a new admin (admin only)
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), TokenError> {
        let admin = admin::read_admin(&env)?;
        admin.require_auth();

        event::set_admin(&env, admin.clone(), new_admin.clone());
        admin::write_admin(&env, &new_admin);
        Ok(())
    }

    /// Get the current admin
    pub fn admin(env: Env) -> Result<Address, TokenError> {
        let admin = match admin::read_admin(&env) {
            Ok(addr) => addr,
            Err(e) => return Err(e),
        };
        Ok(admin)
    }

    /// Get allowance for a spender
    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        let allowance = allowance::read_allowance(&env, &from, &spender);

        // Check if allowance has expired
        let current_ledger = env.ledger().sequence();
        if current_ledger >= allowance.expiration_ledger {
            return 0;
        }

        allowance.amount
    }

    /// Approve a spender to spend tokens on behalf of from
    pub fn approve(
        env: Env,
        from: Address,
        spender: Address,
        amount: i128,
        expiration_ledger: u32,
    ) -> Result<(), TokenError> {
        from.require_auth();
        Self::check_nonnegative_amount(amount)?;

        // Check expiration ledger validity
        if amount > 0 && expiration_ledger < env.ledger().sequence() {
            return Err(TokenError::InvalidExpirationLedger);
        }

        allowance::write_allowance(&env, &from, &spender, amount, expiration_ledger);
        event::approve(&env, from, spender, amount, expiration_ledger);
        Ok(())
    }

    /// Get balance of an address
    pub fn balance(env: Env, id: Address) -> i128 {
        balance::read_balance(&env, &id)
    }

    /// Transfer tokens from one address to another
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> Result<(), TokenError> {
        from.require_auth();
        Self::check_nonnegative_amount(amount)?;

        let from_balance = balance::read_balance(&env, &from);
        if from_balance < amount {
            return Err(TokenError::InsufficientBalance);
        }

        // Use checked arithmetic
        let to_balance = balance::read_balance(&env, &to);
        let new_to_balance = to_balance.checked_add(amount).ok_or(TokenError::Overflow)?;

        balance::write_balance(&env, &from, from_balance - amount);
        balance::write_balance(&env, &to, new_to_balance);

        event::transfer(&env, from, to, amount);
        Ok(())
    }

    /// Transfer tokens from one address to another using allowance
    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        spender.require_auth();
        Self::check_nonnegative_amount(amount)?;

        allowance::spend_allowance(&env, &from, &spender, amount)?;

        let from_balance = balance::read_balance(&env, &from);
        if from_balance < amount {
            return Err(TokenError::InsufficientBalance);
        }

        let to_balance = balance::read_balance(&env, &to);
        let new_to_balance = to_balance.checked_add(amount).ok_or(TokenError::Overflow)?;

        balance::write_balance(&env, &from, from_balance - amount);
        balance::write_balance(&env, &to, new_to_balance);

        event::transfer(&env, from, to, amount);
        Ok(())
    }

    /// Burn tokens from an address
    pub fn burn(env: Env, from: Address, amount: i128) -> Result<(), TokenError> {
        from.require_auth();
        Self::check_nonnegative_amount(amount)?;

        let from_balance = balance::read_balance(&env, &from);
        if from_balance < amount {
            return Err(TokenError::InsufficientBalance);
        }

        balance::write_balance(&env, &from, from_balance - amount);

        // Update total supply
        let total = admin::read_total_supply(&env);
        let new_total = total.checked_sub(amount).ok_or(TokenError::Overflow)?;
        admin::write_total_supply(&env, new_total);

        event::burn(&env, from, amount);
        Ok(())
    }

    /// Burn tokens from an address using allowance
    pub fn burn_from(
        env: Env,
        spender: Address,
        from: Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        spender.require_auth();
        Self::check_nonnegative_amount(amount)?;

        allowance::spend_allowance(&env, &from, &spender, amount)?;

        let from_balance = balance::read_balance(&env, &from);
        if from_balance < amount {
            return Err(TokenError::InsufficientBalance);
        }

        balance::write_balance(&env, &from, from_balance - amount);

        // Update total supply
        let total = admin::read_total_supply(&env);
        let new_total = total.checked_sub(amount).ok_or(TokenError::Overflow)?;
        admin::write_total_supply(&env, new_total);

        event::burn(&env, from, amount);
        Ok(())
    }

    /// Get token decimals
    pub fn decimals(env: Env) -> Result<u32, TokenError> {
        metadata::read_decimals(&env)
    }

    /// Get token name
    pub fn name(env: Env) -> Result<String, TokenError> {
        metadata::read_name(&env)
    }

    /// Get token symbol
    pub fn symbol(env: Env) -> Result<String, TokenError> {
        metadata::read_symbol(&env)
    }

    /// Get total supply
    pub fn total_supply(env: Env) -> i128 {
        admin::read_total_supply(&env)
    }

    // Helper functions

    fn check_nonnegative_amount(amount: i128) -> Result<(), TokenError> {
        if amount < 0 {
            return Err(TokenError::InvalidAmount);
        }
        Ok(())
    }
}
