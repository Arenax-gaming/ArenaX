/// Economy governance and emergency controls
use soroban_sdk::{Env, Address, Vec, contracttype};
use crate::storage::*;
use crate::error::VirtualEconomyError;

pub struct EconomyGovernance;

impl EconomyGovernance {
    /// Validate economy configuration changes
    pub fn validate_config_change(
        current_config: &CurrencyConfig,
        new_config: &CurrencyConfig,
    ) -> Result<(), VirtualEconomyError> {
        // Prevent drastic changes that could destabilize economy
        
        // Max supply can only increase, not decrease
        if new_config.max_supply < current_config.max_supply {
            return Err(VirtualEconomyError::InvalidConfig);
        }
        
        // Inflation rate changes should be gradual (max 5% change)
        let inflation_diff = if new_config.inflation_rate > current_config.inflation_rate {
            new_config.inflation_rate - current_config.inflation_rate
        } else {
            current_config.inflation_rate - new_config.inflation_rate
        };
        
        if inflation_diff > 500 { // 5% in basis points
            return Err(VirtualEconomyError::InvalidConfig);
        }
        
        // Similar check for deflation rate
        let deflation_diff = if new_config.deflation_rate > current_config.deflation_rate {
            new_config.deflation_rate - current_config.deflation_rate
        } else {
            current_config.deflation_rate - new_config.deflation_rate
        };
        
        if deflation_diff > 300 { // 3% in basis points
            return Err(VirtualEconomyError::InvalidConfig);
        }
        
        Ok(())
    }
    
    /// Check if emergency intervention is needed
    pub fn assess_emergency_conditions(
        analytics: &EconomyAnalytics,
        total_supply: i128,
    ) -> EmergencyLevel {
        let mut risk_factors = 0u32;
        
        // Check for hyperinflation (minting >> burning)
        if analytics.total_currency_minted > 0 {
            let mint_burn_ratio = analytics.total_currency_minted / 
                analytics.total_currency_burned.max(1);
            if mint_burn_ratio > 10 {
                risk_factors += 3; // High risk
            } else if mint_burn_ratio > 5 {
                risk_factors += 1; // Medium risk
            }
        }
        
        // Check for market manipulation (unusual trading patterns)
        if analytics.total_trades_executed > 0 {
            let avg_trade_size = analytics.total_trade_volume / analytics.total_trades_executed as i128;
            if avg_trade_size > total_supply / 10 {
                risk_factors += 2; // Large trades might indicate manipulation
            }
        }
        
        // Check for excessive fee accumulation
        if analytics.total_trade_volume > 0 {
            let fee_ratio = (analytics.total_fees_collected * 100) / analytics.total_trade_volume;
            if fee_ratio > 10 { // More than 10% fees
                risk_factors += 1;
            }
        }
        
        // Check for market stagnation
        if analytics.total_trades_executed < 10 && total_supply > 1000000 {
            risk_factors += 1; // Low activity with high supply
        }
        
        match risk_factors {
            0..=1 => EmergencyLevel::Normal,
            2..=3 => EmergencyLevel::Caution,
            4..=5 => EmergencyLevel::Warning,
            _ => EmergencyLevel::Critical,
        }
    }
    
    /// Calculate recommended interventions (returns u32 codes instead of Vec)
    pub fn recommend_interventions(
        emergency_level: EmergencyLevel,
        _analytics: &EconomyAnalytics,
    ) -> u32 {
        // Return intervention codes as bitmask
        match emergency_level {
            EmergencyLevel::Normal => 0,
            EmergencyLevel::Caution => 1, // MonitorClosely
            EmergencyLevel::Warning => 6, // ReduceMinting + IncreaseBurning (2 + 4)
            EmergencyLevel::Critical => 56, // EmergencyPause + FreezeTrading + AdminReview (8 + 16 + 32)
        }
    }
    
    /// Execute automated stabilization measures
    pub fn execute_stabilization(
        env: &Env,
        intervention_code: u32,
        _analytics: &EconomyAnalytics,
    ) -> Result<(), VirtualEconomyError> {
        if intervention_code & 8 != 0 { // EmergencyPause
            env.storage().instance().set(&DataKey::EmergencyPaused, &true);
        }
        // Other interventions would be implemented here
        Ok(())
    }
    
    /// Calculate circuit breaker thresholds (returns u32 codes instead of Vec)
    pub fn check_circuit_breakers(
        analytics: &EconomyAnalytics,
        time_window_hours: u32,
    ) -> u32 {
        let mut triggers = 0u32;
        
        // Volume circuit breaker (too much trading in short time)
        let hourly_volume = analytics.total_trade_volume / time_window_hours.max(1) as i128;
        if hourly_volume > 1000000 { // Configurable threshold
            triggers |= 1; // ExcessiveVolume
        }
        
        // Minting circuit breaker
        let hourly_minting = analytics.total_currency_minted / time_window_hours.max(1) as i128;
        if hourly_minting > 100000 { // Configurable threshold
            triggers |= 2; // ExcessiveMinting
        }
        
        // Price manipulation detection (would need price feeds)
        if analytics.total_trades_executed > 1000 {
            let avg_trade = analytics.total_trade_volume / analytics.total_trades_executed as i128;
            if avg_trade > 1000000 { // Very large average trades
                triggers |= 4; // PriceManipulation
            }
        }
        
        triggers
    }
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum EmergencyLevel {
    Normal = 0,
    Caution = 1,
    Warning = 2,
    Critical = 3,
}

// Intervention types as constants for bitmask operations
pub const INTERVENTION_MONITOR_CLOSELY: u32 = 1;
pub const INTERVENTION_REDUCE_MINTING: u32 = 2;
pub const INTERVENTION_INCREASE_BURNING: u32 = 4;
pub const INTERVENTION_EMERGENCY_PAUSE: u32 = 8;
pub const INTERVENTION_FREEZE_TRADING: u32 = 16;
pub const INTERVENTION_ADMIN_REVIEW: u32 = 32;

// Circuit breaker trigger constants
pub const TRIGGER_EXCESSIVE_VOLUME: u32 = 1;
pub const TRIGGER_EXCESSIVE_MINTING: u32 = 2;
pub const TRIGGER_PRICE_MANIPULATION: u32 = 4;
pub const TRIGGER_SYSTEM_OVERLOAD: u32 = 8;