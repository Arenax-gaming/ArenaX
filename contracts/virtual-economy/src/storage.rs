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
    
    // Analytics
    EconomyAnalytics,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrencyConfig {
    pub max_supply: i128,
    pub inflation_rate: u32,  // basis points (100 = 1%)
    pub deflation_rate: u32,  // basis points
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketplaceConfig {
    pub fee_percentage: u32,  // basis points (250 = 2.5%)
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
    pub rarity: u32,  // 1-5 scale
    pub category: String,
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