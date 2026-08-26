use soroban_sdk::{contractevent, Address, BytesN, Env, String};

pub const NAMESPACE: &str = "ArenaXVirtualEconomy";
pub const VERSION: &str = "v1";

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "ECONOMY_INITIALIZED"])]
pub struct EconomyInitialized {
    pub admin: Address,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "MINTER_AUTHORIZED"])]
pub struct MinterAuthorized {
    pub minter: Address,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "MINTER_DEAUTHORIZED"])]
pub struct MinterDeauthorized {
    pub minter: Address,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "CURRENCY_MINTED"])]
pub struct CurrencyMinted {
    pub recipient: Address,
    pub amount: i128,
    pub reason: String,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "CURRENCY_TRANSFERRED"])]
pub struct CurrencyTransferred {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "CURRENCY_BURNED"])]
pub struct CurrencyBurned {
    pub owner: Address,
    pub amount: i128,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "NFT_MINTED"])]
pub struct NFTMinted {
    pub token_id: BytesN<32>,
    pub owner: Address,
    pub name: String,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "NFT_TRANSFERRED"])]
pub struct NFTTransferred {
    pub token_id: BytesN<32>,
    pub from: Address,
    pub to: Address,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "MARKETPLACE_ORDER_CREATED"])]
pub struct MarketplaceOrderCreated {
    pub order_id: BytesN<32>,
    pub seller: Address,
    pub price: i128,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "MARKETPLACE_TRADE_EXECUTED"])]
pub struct MarketplaceTradeExecuted {
    pub order_id: BytesN<32>,
    pub buyer: Address,
    pub seller: Address,
    pub price: i128,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "MARKETPLACE_ORDER_CANCELLED"])]
pub struct MarketplaceOrderCancelled {
    pub order_id: BytesN<32>,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "REWARDS_DISTRIBUTED"])]
pub struct RewardsDistributed {
    pub recipient_count: u32,
    pub reason: String,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "INFLATION_CONTROLS_UPDATED"])]
pub struct InflationControlsUpdated {
    pub timestamp: u64,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "EMERGENCY_PAUSED"])]
pub struct EmergencyPaused {
    pub timestamp: u64,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "EMERGENCY_RESUMED"])]
pub struct EmergencyResumed {
    pub timestamp: u64,
}

// Event emission functions
pub fn emit_economy_initialized(env: &Env, admin: &Address) {
    EconomyInitialized {
        admin: admin.clone(),
    }
    .publish(env);
}

pub fn emit_minter_authorized(env: &Env, minter: &Address) {
    MinterAuthorized {
        minter: minter.clone(),
    }
    .publish(env);
}

pub fn emit_minter_deauthorized(env: &Env, minter: &Address) {
    MinterDeauthorized {
        minter: minter.clone(),
    }
    .publish(env);
}

pub fn emit_currency_minted(env: &Env, recipient: &Address, amount: i128, reason: &String) {
    CurrencyMinted {
        recipient: recipient.clone(),
        amount,
        reason: reason.clone(),
    }
    .publish(env);
}

pub fn emit_currency_transferred(env: &Env, from: &Address, to: &Address, amount: i128) {
    CurrencyTransferred {
        from: from.clone(),
        to: to.clone(),
        amount,
    }
    .publish(env);
}

pub fn emit_currency_burned(env: &Env, owner: &Address, amount: i128) {
    CurrencyBurned {
        owner: owner.clone(),
        amount,
    }
    .publish(env);
}

pub fn emit_nft_minted(env: &Env, token_id: &BytesN<32>, owner: &Address, name: &String) {
    NFTMinted {
        token_id: token_id.clone(),
        owner: owner.clone(),
        name: name.clone(),
    }
    .publish(env);
}

pub fn emit_nft_transferred(env: &Env, token_id: &BytesN<32>, from: &Address, to: &Address) {
    NFTTransferred {
        token_id: token_id.clone(),
        from: from.clone(),
        to: to.clone(),
    }
    .publish(env);
}

pub fn emit_marketplace_order_created(
    env: &Env,
    order_id: &BytesN<32>,
    seller: &Address,
    price: i128,
) {
    MarketplaceOrderCreated {
        order_id: order_id.clone(),
        seller: seller.clone(),
        price,
    }
    .publish(env);
}

pub fn emit_marketplace_trade_executed(
    env: &Env,
    order_id: &BytesN<32>,
    buyer: &Address,
    seller: &Address,
    price: i128,
) {
    MarketplaceTradeExecuted {
        order_id: order_id.clone(),
        buyer: buyer.clone(),
        seller: seller.clone(),
        price,
    }
    .publish(env);
}

pub fn emit_marketplace_order_cancelled(env: &Env, order_id: &BytesN<32>) {
    MarketplaceOrderCancelled {
        order_id: order_id.clone(),
    }
    .publish(env);
}

pub fn emit_rewards_distributed(env: &Env, recipient_count: u32, reason: &String) {
    RewardsDistributed {
        recipient_count,
        reason: reason.clone(),
    }
    .publish(env);
}

pub fn emit_inflation_controls_updated(env: &Env) {
    InflationControlsUpdated {
        timestamp: env.ledger().timestamp(),
    }
    .publish(env);
}

pub fn emit_emergency_paused(env: &Env) {
    EmergencyPaused {
        timestamp: env.ledger().timestamp(),
    }
    .publish(env);
}

pub fn emit_emergency_resumed(env: &Env) {
    EmergencyResumed {
        timestamp: env.ledger().timestamp(),
    }
    .publish(env);
}

// ─── Dynamic Pricing: Dutch Auctions ─────────────────────────────────────────

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "AUCTION_CREATED"])]
pub struct DutchAuctionCreated {
    pub listing_id: BytesN<32>,
    pub seller: Address,
    pub token_id: BytesN<32>,
    pub start_price: i128,
    pub floor_price: i128,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "AUCTION_PURCHASED"])]
pub struct DutchAuctionPurchased {
    pub listing_id: BytesN<32>,
    pub buyer: Address,
    pub price: i128,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "AUCTION_CANCELLED"])]
pub struct DutchAuctionCancelled {
    pub listing_id: BytesN<32>,
}

pub fn emit_dutch_auction_created(
    env: &Env,
    listing_id: &BytesN<32>,
    seller: &Address,
    token_id: &BytesN<32>,
    start_price: i128,
    floor_price: i128,
) {
    DutchAuctionCreated {
        listing_id: listing_id.clone(),
        seller: seller.clone(),
        token_id: token_id.clone(),
        start_price,
        floor_price,
    }
    .publish(env);
}

pub fn emit_dutch_auction_purchased(
    env: &Env,
    listing_id: &BytesN<32>,
    buyer: &Address,
    price: i128,
) {
    DutchAuctionPurchased {
        listing_id: listing_id.clone(),
        buyer: buyer.clone(),
        price,
    }
    .publish(env);
}

pub fn emit_dutch_auction_cancelled(env: &Env, listing_id: &BytesN<32>) {
    DutchAuctionCancelled {
        listing_id: listing_id.clone(),
    }
    .publish(env);
}

// ─── Dynamic Pricing: Bonding Curve Drops ────────────────────────────────────

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "DROP_CREATED"])]
pub struct BondingCurveDropCreated {
    pub drop_id: BytesN<32>,
    pub creator: Address,
    pub base_price: i128,
    pub slope_bps: u32,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "DROP_MINTED"])]
pub struct BondingCurveDropMinted {
    pub drop_id: BytesN<32>,
    pub buyer: Address,
    pub token_id: BytesN<32>,
    pub price: i128,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "DROP_UPDATED"])]
pub struct BondingCurveDropUpdated {
    pub drop_id: BytesN<32>,
    pub active: bool,
}

pub fn emit_bonding_curve_drop_created(
    env: &Env,
    drop_id: &BytesN<32>,
    creator: &Address,
    base_price: i128,
    slope_bps: u32,
) {
    BondingCurveDropCreated {
        drop_id: drop_id.clone(),
        creator: creator.clone(),
        base_price,
        slope_bps,
    }
    .publish(env);
}

pub fn emit_bonding_curve_drop_minted(
    env: &Env,
    drop_id: &BytesN<32>,
    buyer: &Address,
    token_id: &BytesN<32>,
    price: i128,
) {
    BondingCurveDropMinted {
        drop_id: drop_id.clone(),
        buyer: buyer.clone(),
        token_id: token_id.clone(),
        price,
    }
    .publish(env);
}

pub fn emit_bonding_curve_drop_updated(env: &Env, drop_id: &BytesN<32>, active: bool) {
    BondingCurveDropUpdated {
        drop_id: drop_id.clone(),
        active,
    }
    .publish(env);
}

// ─── Price Oracle ─────────────────────────────────────────────────────────────

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "ORACLE_CONFIGURED"])]
pub struct OracleConfigured {
    pub primary_oracle: Address,
    pub update_interval: u64,
    pub max_variance_bps: u32,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "ORACLE_FALLBACK_SET"])]
pub struct OracleFallbackSet {
    pub fallback_oracle: Address,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "ORACLE_PRICE_UPDATED"])]
pub struct OraclePriceUpdated {
    pub asset_pair: BytesN<32>,
    pub price: i128,
    pub timestamp: u64,
    pub used_fallback: bool,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "ORACLE_PRICE_REJECTED"])]
pub struct OraclePriceRejected {
    pub asset_pair: BytesN<32>,
    pub submitted_price: i128,
    pub last_accepted_price: i128,
    pub variance_bps: u32,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "ORACLE_PAIR_REGISTERED"])]
pub struct OraclePairRegistered {
    pub asset_pair: BytesN<32>,
    pub update_interval: u64,
}

pub fn emit_oracle_configured(
    env: &Env,
    primary_oracle: &Address,
    update_interval: u64,
    max_variance_bps: u32,
) {
    OracleConfigured {
        primary_oracle: primary_oracle.clone(),
        update_interval,
        max_variance_bps,
    }
    .publish(env);
}

pub fn emit_oracle_fallback_set(env: &Env, fallback_oracle: &Address) {
    OracleFallbackSet {
        fallback_oracle: fallback_oracle.clone(),
    }
    .publish(env);
}

pub fn emit_oracle_price_updated(
    env: &Env,
    asset_pair: &BytesN<32>,
    price: i128,
    timestamp: u64,
    used_fallback: bool,
) {
    OraclePriceUpdated {
        asset_pair: asset_pair.clone(),
        price,
        timestamp,
        used_fallback,
    }
    .publish(env);
}

pub fn emit_oracle_price_rejected(
    env: &Env,
    asset_pair: &BytesN<32>,
    submitted_price: i128,
    last_accepted_price: i128,
    variance_bps: u32,
) {
    OraclePriceRejected {
        asset_pair: asset_pair.clone(),
        submitted_price,
        last_accepted_price,
        variance_bps,
    }
    .publish(env);
}

pub fn emit_oracle_pair_registered(env: &Env, asset_pair: &BytesN<32>, update_interval: u64) {
    OraclePairRegistered {
        asset_pair: asset_pair.clone(),
        update_interval,
    }
    .publish(env);
}

// ─── NFT Staking ──────────────────────────────────────────────────────────────

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "NFT_STAKING_CONFIGURED"])]
pub struct NftStakingConfigured {
    pub reward_rate_bps: u32,
    pub reward_interval: u64,
    pub min_lock_period: u64,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "NFT_STAKED"])]
pub struct NftStaked {
    pub token_id: BytesN<32>,
    pub owner: Address,
    pub staked_at: u64,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "NFT_UNSTAKED"])]
pub struct NftUnstaked {
    pub token_id: BytesN<32>,
    pub owner: Address,
    pub rewards_claimed: i128,
}

#[contractevent(topics = ["ArenaXVirtualEconomy_v1", "NFT_STAKING_REWARDS_CLAIMED"])]
pub struct NftStakingRewardsClaimed {
    pub token_id: BytesN<32>,
    pub owner: Address,
    pub amount: i128,
}

pub fn emit_nft_staking_configured(
    env: &Env,
    reward_rate_bps: u32,
    reward_interval: u64,
    min_lock_period: u64,
) {
    NftStakingConfigured {
        reward_rate_bps,
        reward_interval,
        min_lock_period,
    }
    .publish(env);
}

pub fn emit_nft_staked(env: &Env, token_id: &BytesN<32>, owner: &Address, staked_at: u64) {
    NftStaked {
        token_id: token_id.clone(),
        owner: owner.clone(),
        staked_at,
    }
    .publish(env);
}

pub fn emit_nft_unstaked(
    env: &Env,
    token_id: &BytesN<32>,
    owner: &Address,
    rewards_claimed: i128,
) {
    NftUnstaked {
        token_id: token_id.clone(),
        owner: owner.clone(),
        rewards_claimed,
    }
    .publish(env);
}

pub fn emit_nft_staking_rewards_claimed(
    env: &Env,
    token_id: &BytesN<32>,
    owner: &Address,
    amount: i128,
) {
    NftStakingRewardsClaimed {
        token_id: token_id.clone(),
        owner: owner.clone(),
        amount,
    }
    .publish(env);
}
