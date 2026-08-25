use soroban_sdk::{contracttype, Address, BytesN, String, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    // Admin & Config
    Admin,
    CurrencyConfig,
    MarketplaceConfig,
    EmergencyPaused,

    // Authorization
    AuthorizedMinter(Address),

    // Counters
    TokenCounter,
    OrderCounter,

    // Currency
    CurrencyBalance(Address),
    TotalCurrencySupply,

    // NFTs
    NFTOwner(BytesN<32>),
    NFTMetadata(BytesN<32>),
    OwnedNFTs(Address),

    // Marketplace
    MarketplaceOrder(BytesN<32>),

    // Royalty & Licensing
    NFTLicense(BytesN<32>),
    RoyaltyAnalytics,
    RoyaltyExempt(Address),

    // Dynamic Pricing: Dutch Auctions
    DutchAuction(BytesN<32>),
    AuctionCounter,

    // Dynamic Pricing: Bonding Curve Drops
    BondingCurveDrop(BytesN<32>),
    DropCounter,

    // Analytics
    EconomyAnalytics,
    PricingAnalytics,

    // Price Oracle
    /// Global oracle configuration shared across all asset pairs.
    OracleConfig,
    /// Per asset-pair oracle configuration override.  Key is the asset-pair
    /// symbol string bytes hashed to a 32-byte identifier.
    OraclePairConfig(BytesN<32>),
    /// Address of the primary on-chain price-feed contract (Chainlink-style).
    PrimaryOracle,
    /// Address of the fallback oracle contract (used when primary is stale or
    /// diverges beyond `max_variance_bps`).
    FallbackOracle,
    /// Stored price history ring-buffer for an asset pair.
    OraclePriceHistory(BytesN<32>),
    /// Last raw price reported by the primary oracle for an asset pair.
    OracleLastPrimaryPrice(BytesN<32>),
    /// Last raw price reported by the fallback oracle for an asset pair.
    OracleLastFallbackPrice(BytesN<32>),
    /// Aggregate statistics across all oracle updates.
    OracleAnalytics,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrencyConfig {
    pub max_supply: i128,
    pub inflation_rate: u32, // basis points (100 = 1%)
    pub deflation_rate: u32, // basis points
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketplaceConfig {
    pub fee_percentage: u32, // basis points (250 = 2.5%)
    pub fee_collector: Address,
    pub min_price: i128,
    pub max_price: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NFTMetadata {
    pub name: String,
    pub description: String,
    pub image_url: String,
    pub attributes: Vec<NFTAttribute>,
    pub rarity: u32, // 1-5 scale
    pub category: String,
    pub creator: Address,
    pub royalty_bps: u32, // basis points, max 2000 (20%)
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NFTAttribute {
    pub trait_type: String,
    pub value: String,
    pub display_type: Option<String>,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OrderStatus {
    Active = 0,
    Completed = 1,
    Cancelled = 2,
    Expired = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MarketplaceAsset {
    NFT(BytesN<32>),
    Currency(i128),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketplaceOrder {
    pub order_id: BytesN<32>,
    pub seller: Address,
    pub asset: MarketplaceAsset,
    pub price: i128,
    pub created_at: u64,
    pub expiry: Option<u64>,
    pub status: OrderStatus,
}

// Boxing the NFT variant to shrink this enum isn't safe to do blind: Soroban's
// #[contracttype] XDR (de)serialization is generated against this exact shape,
// and Box<T> support there isn't something to assume without verifying against
// the SDK version in use.
#[allow(clippy::large_enum_variant)]
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RewardType {
    Currency(i128),
    NFT(NFTMetadata),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardDistribution {
    pub recipient: Address,
    pub reward_type: RewardType,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EconomyAnalytics {
    pub total_currency_minted: i128,
    pub total_currency_burned: i128,
    pub total_nfts_minted: u64,
    pub total_trades_executed: u64,
    pub total_trade_volume: i128,
    pub total_fees_collected: i128,
    pub active_orders: u32,
    pub unique_traders: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LicenseConfig {
    pub license_type: u32, // 0=All Rights Reserved, 1=CC, 2=Commercial, 3=Personal
    pub license_uri: String,
    pub sublicensing_allowed: bool,
    pub commercial_use_allowed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoyaltyAnalytics {
    pub total_royalties_paid: i128,
    pub total_royalty_transactions: u64,
    pub total_exemptions_applied: u32,
}

// -----------------------------------------------------------------------------
// Dynamic Pricing
// -----------------------------------------------------------------------------

/// Shape of the price decay curve used by a [`DutchAuctionListing`].
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PriceCurve {
    /// Price falls by a constant amount per second.
    Linear = 0,
    /// Price falls faster early, slower as it approaches the floor
    /// (approximated by halving the remaining premium in four steps across
    /// the auction duration).
    Exponential = 1,
}

/// A single NFT listed for sale at a price that decays over time from
/// `start_price` down to `floor_price`, instead of a fixed price. Anyone can
/// buy at the current computed price; the earlier someone buys, the more
/// they pay.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DutchAuctionListing {
    pub listing_id: BytesN<32>,
    pub seller: Address,
    pub token_id: BytesN<32>,
    pub start_price: i128,
    pub floor_price: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub curve: PriceCurve,
    pub status: OrderStatus,
}

/// A repeatable NFT "drop" whose mint price rises algorithmically with the
/// number of units already minted (a bonding curve), so early buyers pay
/// less than later buyers. Useful for collections where demand should be
/// reflected directly in price rather than left to secondary-market
/// speculation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BondingCurveDrop {
    pub drop_id: BytesN<32>,
    pub creator: Address,
    pub base_price: i128,
    /// Price increases by `slope_bps` (basis points of `base_price`) for
    /// every unit already minted: `price = base_price + base_price *
    /// slope_bps * minted / 10_000`.
    pub slope_bps: u32,
    pub max_supply: Option<u32>,
    pub minted: u32,
    pub metadata_template: NFTMetadata,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PricingAnalytics {
    pub total_auctions_created: u64,
    pub total_auctions_settled: u64,
    pub total_auction_volume: i128,
    pub total_drops_created: u64,
    pub total_drop_mints: u64,
    pub total_drop_volume: i128,
}

// -----------------------------------------------------------------------------
// Price Oracle
// -----------------------------------------------------------------------------

/// Global (and per-pair-overridable) oracle configuration.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleConfig {
    /// Minimum seconds that must elapse between accepted price updates.
    /// Prevents spam / too-frequent updates; configurable per pair.
    pub update_interval: u64,
    /// Maximum allowed variance in basis points between the incoming price and
    /// the last accepted price before the fallback is preferred.
    /// 500 = 5 %, 10 000 = 100 % (effectively disables the check).
    pub max_variance_bps: u32,
    /// Number of historic price entries to retain per asset pair (ring-buffer).
    /// Must be in 1..=100.
    pub history_size: u32,
    /// Multiplier applied to `update_interval` to determine when a price feed
    /// is considered stale.  E.g. `3` ⇒ stale after `3 × update_interval` s.
    pub stale_multiplier: u64,
}

/// A single price observation stored in the history ring-buffer.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OraclePriceEntry {
    /// Price in the smallest unit of the quote asset (e.g. stroops for XLM).
    pub price: i128,
    /// Ledger timestamp (seconds since Unix epoch) when the entry was accepted.
    pub timestamp: u64,
    /// Address of the oracle contract that provided this price.
    pub source: Address,
    /// `true` if this entry was sourced from the fallback oracle.
    pub is_fallback: bool,
}

/// Ring-buffer of recent price observations for one asset pair.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceHistory {
    /// Ordered oldest-to-newest list of price observations.
    pub entries: Vec<OraclePriceEntry>,
    /// Most recently accepted price (redundant but avoids a full scan).
    pub last_price: i128,
    /// Timestamp of the most recently accepted price.
    pub last_updated: u64,
    /// Total number of updates accepted since the pair was registered.
    pub update_count: u64,
}

/// Aggregate statistics across all oracle price-feed activity.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleAnalytics {
    /// Number of price updates accepted from the primary oracle.
    pub primary_updates: u64,
    /// Number of price updates accepted from the fallback oracle.
    pub fallback_updates: u64,
    /// Number of times an incoming price was rejected for excessive variance.
    pub variance_rejections: u64,
    /// Number of times both oracles were stale and no price could be accepted.
    pub stale_rejections: u64,
    /// Total number of distinct asset pairs registered.
    pub registered_pairs: u32,
}
