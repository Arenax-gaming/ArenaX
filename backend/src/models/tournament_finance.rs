use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Total prize pool for a tournament, and how much of it has been awarded
/// and actually paid out on-chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentPrizePoolSummary {
    pub tournament_id: Uuid,
    pub currency: String,
    /// Total funded into the prize pool (currently 100% of collected entry fees).
    pub total_amount: i64,
    /// Sum of `prize_amount` recorded for winners, whether or not the on-chain
    /// transfer has confirmed yet.
    pub distributed_amount: i64,
    /// Sum of `prize_amount` for winners whose payout has a confirmed
    /// on-chain transaction hash.
    pub paid_amount: i64,
    /// `distributed_amount - paid_amount`: awarded but not yet confirmed paid.
    pub pending_amount: i64,
    /// `total_amount - distributed_amount`: not yet awarded to any winner.
    pub remaining_amount: i64,
    pub winner_count: i64,
}

/// Entry-fee revenue collected for a tournament vs. how much of it was
/// funded into the prize pool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentRevenueBreakdown {
    pub tournament_id: Uuid,
    pub entry_fee: i64,
    pub entry_fee_currency: String,
    pub total_participants: i64,
    pub paid_participants: i64,
    pub unpaid_participants: i64,
    /// `paid_participants * entry_fee` — gross revenue collected from entry fees.
    pub gross_entry_fee_revenue: i64,
    /// The tournament's `prize_pools.total_amount` — what was actually funded
    /// into the prize pool from that revenue.
    pub prize_pool_funded: i64,
    /// `gross_entry_fee_revenue - prize_pool_funded`. Currently expected to be
    /// 0 since 100% of entry fees fund the pool, but this surfaces any future
    /// platform rake without requiring a schema change.
    pub platform_revenue: i64,
}

/// Status of a single winner's prize payout.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PrizeDistributionStatus {
    /// Prize amount recorded and the on-chain transfer confirmed (`prize_tx_hash` set).
    Paid,
    /// Prize amount recorded, but not yet confirmed paid and no failure logged
    /// (awaiting on-chain confirmation, or Soroban not configured).
    Pending,
    /// A distribution attempt was made and recorded in `prize_distribution_failures`.
    Failed,
}

/// One winner's prize distribution record for a tournament.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrizeDistributionEntry {
    pub user_id: Uuid,
    pub username: String,
    pub final_rank: i32,
    pub prize_amount: i64,
    pub prize_currency: String,
    pub status: PrizeDistributionStatus,
    pub prize_tx_hash: Option<String>,
    pub failure_reason: Option<String>,
    pub retry_count: Option<i32>,
}

/// Full financial report for a single tournament: prize pool, revenue, and
/// per-winner distribution tracking in one response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentFinancialReport {
    pub tournament_id: Uuid,
    pub tournament_name: String,
    pub generated_at: DateTime<Utc>,
    pub prize_pool: TournamentPrizePoolSummary,
    pub revenue: TournamentRevenueBreakdown,
    pub prize_distribution: Vec<PrizeDistributionEntry>,
}

/// One payee's aggregated winnings for a tax year, flagged for 1099
/// reporting once they cross the threshold.
///
/// This aggregates amounts already in the platform's database; it does not
/// itself collect or validate the payee's TIN/SSN or mailing address, which
/// a real 1099 filing requires. Treat `requires_1099` as a worklist for
/// finance/compliance to cross-reference against KYC records on file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaxReportEntry {
    pub user_id: Uuid,
    pub username: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub tax_year: i32,
    pub total_winnings: i64,
    pub currency: String,
    pub tournaments_won: i64,
    pub requires_1099: bool,
}

/// Aggregated tournament-winnings tax report for a given year and currency.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaxReport {
    pub tax_year: i32,
    pub currency: String,
    /// Minimum `total_winnings` (in the smallest currency unit) that flags a
    /// payee as `requires_1099`.
    pub reporting_threshold: i64,
    pub entries: Vec<TaxReportEntry>,
    pub total_reportable_winnings: i64,
    pub payees_requiring_1099: i64,
}

/// Revenue and prize payouts for a single calendar month.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonthlyRevenueEntry {
    /// First day of the month.
    pub month: NaiveDate,
    pub tournaments_count: i64,
    pub total_entry_fee_revenue: i64,
    pub total_prize_distributed: i64,
    /// `total_entry_fee_revenue - total_prize_distributed` for the month.
    pub net_revenue: i64,
}

/// Month-by-month revenue report over a date range, for a single currency.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonthlyRevenueReport {
    pub currency: String,
    pub start_date: DateTime<Utc>,
    pub end_date: DateTime<Utc>,
    pub months: Vec<MonthlyRevenueEntry>,
    pub total_entry_fee_revenue: i64,
    pub total_prize_distributed: i64,
}
