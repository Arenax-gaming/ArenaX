// Currency management utilities
use soroban_sdk::{Env, Address};
use crate::storage::*;
use crate::error::VirtualEconomyError;

pub struct CurrencyManager;

impl CurrencyManager {
    /// Calculate inflation adjustment based on time and config
    pub fn calculate_inflation_adjustment(
        config: &CurrencyConfig,
        time_elapsed: u64,
        current_supply: i128,
    ) -> i128 {
        // Simple inflation calculation: (supply * rate * time) / (365 * 24 * 3600 * 10000)
        // Assumes time_elapsed is in seconds and rate is in basis points
        let annual_seconds = 365 * 24 * 3600u64;
        let inflation_amount = (current_supply * config.inflation_rate as i128 * time_elapsed as i128) 
            / (annual_seconds as i128 * 10000);
        inflation_amount
    }
    
    /// Check if minting would exceed supply limits
    pub fn validate_mint_amount(
        config: &CurrencyConfig,
        current_supply: i128,
        mint_amount: i128,
    ) -> Result<(), VirtualEconomyError> {
        if current_supply + mint_amount > config.max_supply {
            return Err(VirtualEconomyError::SupplyLimitExceeded);
        }
        Ok(())
    }
    
    /// Calculate transaction fees for currency operations
    pub fn calculate_transaction_fee(
        amount: i128,
        fee_rate: u32, // basis points
    ) -> i128 {
        (amount * fee_rate as i128) / 10000
    }
    
    /// Implement deflationary burning based on economic conditions
    pub fn calculate_deflationary_burn(
        config: &CurrencyConfig,
        current_supply: i128,
        economic_activity: i128,
    ) -> i128 {
        // Burn more when there's high economic activity to control inflation
        let base_burn = (current_supply * config.deflation_rate as i128) / 10000;
        let activity_multiplier = if economic_activity > 1000000 { 2 } else { 1 };
        base_burn * activity_multiplier
    }
}