// Economy analytics and monitoring
use crate::storage::*;
use soroban_sdk::{contracttype, Address, Env, Vec};

pub struct EconomyAnalyticsManager;

impl EconomyAnalyticsManager {
    /// Calculate economy health score (0-100)
    pub fn calculate_health_score(analytics: &EconomyAnalytics) -> u32 {
        let mut score = 50u32; // Base score

        // Currency circulation health
        if analytics.total_currency_minted > 0 {
            let burn_ratio =
                (analytics.total_currency_burned * 100) / analytics.total_currency_minted;
            if burn_ratio > 80 {
                score = score.saturating_sub(20); // Too much burning
            } else if burn_ratio < 5 {
                score = score.saturating_sub(15); // Too little burning (inflation risk)
            } else {
                score = score.saturating_add(10); // Healthy burn rate
            }
        }

        // Trading activity health
        if analytics.total_trades_executed > 100 {
            score = score.saturating_add(15); // Good trading activity
        } else if analytics.total_trades_executed < 10 {
            score = score.saturating_sub(10); // Low activity
        }

        // Fee collection efficiency
        if analytics.total_trade_volume > 0 {
            let fee_ratio = (analytics.total_fees_collected * 100) / analytics.total_trade_volume;
            if fee_ratio >= 2 && fee_ratio <= 5 {
                score = score.saturating_add(10); // Healthy fee collection
            }
        }

        // Active orders health
        if analytics.active_orders > 50 {
            score = score.saturating_add(5); // Good marketplace liquidity
        }

        score.min(100)
    }

    /// Calculate inflation rate based on minting vs burning
    pub fn calculate_inflation_rate(analytics: &EconomyAnalytics, time_period_days: u32) -> i128 {
        if analytics.total_currency_minted == 0 {
            return 0;
        }

        let net_minted = analytics.total_currency_minted - analytics.total_currency_burned;
        let daily_rate = net_minted / time_period_days as i128;

        // Return as basis points (10000 = 100%)
        (daily_rate * 10000) / analytics.total_currency_minted
    }

    /// Calculate market velocity (how fast currency changes hands)
    pub fn calculate_market_velocity(
        total_supply: i128,
        trade_volume: i128,
        time_period_days: u32,
    ) -> i128 {
        if total_supply == 0 || time_period_days == 0 {
            return 0;
        }

        // Velocity = Volume / Supply over time period
        (trade_volume * 365) / (total_supply * time_period_days as i128)
    }

    /// Generate economy report
    pub fn generate_economy_report(
        env: &Env,
        analytics: &EconomyAnalytics,
        total_supply: i128,
    ) -> EconomyReport {
        let health_score = Self::calculate_health_score(analytics);
        let inflation_rate = Self::calculate_inflation_rate(analytics, 30); // 30-day period
        let market_velocity =
            Self::calculate_market_velocity(total_supply, analytics.total_trade_volume, 30);

        EconomyReport {
            timestamp: env.ledger().timestamp(),
            health_score,
            inflation_rate,
            market_velocity,
            total_supply,
            circulating_supply: total_supply, // Simplified - could track locked tokens
            market_cap_equivalent: total_supply, // In a real system, multiply by token price
            analytics: analytics.clone(),
        }
    }

    /// Track user engagement metrics
    pub fn calculate_user_engagement(
        trades_count: u32,
        nfts_owned: u32,
        currency_balance: i128,
        days_active: u32,
    ) -> UserEngagementScore {
        let mut score = 0u32;

        // Trading activity (0-30 points)
        score += (trades_count * 2).min(30);

        // NFT collection (0-25 points)
        score += (nfts_owned * 5).min(25);

        // Currency holding (0-20 points)
        if currency_balance > 10000 {
            score += 20;
        } else if currency_balance > 1000 {
            score += 15;
        } else if currency_balance > 100 {
            score += 10;
        }

        // Consistency (0-25 points)
        if days_active > 30 {
            score += 25;
        } else if days_active > 7 {
            score += 15;
        } else if days_active > 0 {
            score += 5;
        }

        UserEngagementScore {
            total_score: score.min(100),
            trading_score: (trades_count * 2).min(30),
            collection_score: (nfts_owned * 5).min(25),
            wealth_score: if currency_balance > 10000 { 20 } else { 10 },
            consistency_score: if days_active > 30 { 25 } else { 10 },
        }
    }
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct EconomyReport {
    pub timestamp: u64,
    pub health_score: u32,
    pub inflation_rate: i128,
    pub market_velocity: i128,
    pub total_supply: i128,
    pub circulating_supply: i128,
    pub market_cap_equivalent: i128,
    pub analytics: EconomyAnalytics,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct UserEngagementScore {
    pub total_score: u32,
    pub trading_score: u32,
    pub collection_score: u32,
    pub wealth_score: u32,
    pub consistency_score: u32,
}
