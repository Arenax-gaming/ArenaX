#![no_std]
// create_dutch_auction's 8 real, independent parameters trip
// clippy::too_many_arguments (allowed at crate level, since #[contractimpl]
// generates the Client/Args types outside the impl block itself).
#![allow(clippy::too_many_arguments)]

mod amm;
mod analytics;
mod batch;
mod currency;
mod error;
mod governance;
mod marketplace;
mod nft;
mod nft_staking;
mod oracle;
mod rewards;
mod storage;

use arenax_events::virtual_economy as events;
use batch::{BatchManager, BatchResult, BatchTransferItem, MAX_BATCH_SIZE};
use marketplace::MarketplaceManager;
use nft_staking::NftStakingManager;
use oracle::OracleManager;
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, String, Vec};

pub use amm::{
    AmmManager, DepositResult, LiquidityPool, PriceSnapshot, SwapResult, WithdrawResult,
    MINIMUM_LIQUIDITY, SWAP_FEE_BPS,
};
pub use error::VirtualEconomyError;
pub use storage::*;

#[contract]
pub struct VirtualEconomyContract;

#[contractimpl]
impl VirtualEconomyContract {
    // -------------------------------------------------------------------------
    // Initialization & Admin
    // -------------------------------------------------------------------------

    /// Initialize the virtual economy contract
    pub fn initialize(
        env: Env,
        admin: Address,
        currency_config: CurrencyConfig,
        marketplace_config: MarketplaceConfig,
    ) -> Result<(), VirtualEconomyError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(VirtualEconomyError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::CurrencyConfig, &currency_config);
        env.storage()
            .instance()
            .set(&DataKey::MarketplaceConfig, &marketplace_config);

        // Initialize counters
        env.storage().instance().set(&DataKey::TokenCounter, &0u64);
        env.storage().instance().set(&DataKey::OrderCounter, &0u64);

        // Initialize economy analytics
        let analytics = EconomyAnalytics {
            total_currency_minted: 0,
            total_currency_burned: 0,
            total_nfts_minted: 0,
            total_trades_executed: 0,
            total_trade_volume: 0,
            total_fees_collected: 0,
            active_orders: 0,
            unique_traders: 0,
        };
        env.storage()
            .instance()
            .set(&DataKey::EconomyAnalytics, &analytics);

        // Initialize royalty analytics
        let royalty_stats = RoyaltyAnalytics {
            total_royalties_paid: 0,
            total_royalty_transactions: 0,
            total_exemptions_applied: 0,
        };
        env.storage()
            .persistent()
            .set(&DataKey::RoyaltyAnalytics, &royalty_stats);

        events::emit_economy_initialized(&env, &admin);
        Ok(())
    }

    /// Add authorized minter (e.g., game contracts, reward systems)
    pub fn add_authorized_minter(env: Env, minter: Address) -> Result<(), VirtualEconomyError> {
        Self::require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedMinter(minter.clone()), &true);
        events::emit_minter_authorized(&env, &minter);
        Ok(())
    }

    /// Remove authorized minter
    pub fn remove_authorized_minter(env: Env, minter: Address) -> Result<(), VirtualEconomyError> {
        Self::require_admin(&env)?;
        env.storage()
            .instance()
            .remove(&DataKey::AuthorizedMinter(minter.clone()));
        events::emit_minter_deauthorized(&env, &minter);
        Ok(())
    }

    // -------------------------------------------------------------------------
    // Currency Management
    // -------------------------------------------------------------------------

    /// Mint currency to a recipient with a reason
    pub fn mint_currency(
        env: Env,
        recipient: Address,
        amount: i128,
        reason: String,
    ) -> Result<(), VirtualEconomyError> {
        Self::require_authorized_minter(&env)?;

        if amount <= 0 {
            return Err(VirtualEconomyError::InvalidAmount);
        }

        let config = Self::get_currency_config(&env);

        // Check minting limits
        let current_supply = Self::get_total_currency_supply(env.clone());
        if current_supply + amount > config.max_supply {
            return Err(VirtualEconomyError::SupplyLimitExceeded);
        }

        // Update recipient balance
        let current_balance = Self::get_currency_balance(env.clone(), recipient.clone());
        let new_balance = current_balance + amount;
        env.storage()
            .persistent()
            .set(&DataKey::CurrencyBalance(recipient.clone()), &new_balance);

        // Update total supply
        env.storage()
            .persistent()
            .set(&DataKey::TotalCurrencySupply, &(current_supply + amount));

        // Update analytics
        let mut analytics = Self::get_economy_analytics(env.clone());
        analytics.total_currency_minted += amount;
        env.storage()
            .instance()
            .set(&DataKey::EconomyAnalytics, &analytics);

        events::emit_currency_minted(&env, &recipient, amount, &reason);
        Ok(())
    }

    /// Transfer currency between addresses
    pub fn transfer_currency(
        env: Env,
        from: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), VirtualEconomyError> {
        from.require_auth();

        if amount <= 0 {
            return Err(VirtualEconomyError::InvalidAmount);
        }

        let from_balance = Self::get_currency_balance(env.clone(), from.clone());
        if from_balance < amount {
            return Err(VirtualEconomyError::InsufficientBalance);
        }

        let to_balance = Self::get_currency_balance(env.clone(), to.clone());

        // Update balances
        env.storage().persistent().set(
            &DataKey::CurrencyBalance(from.clone()),
            &(from_balance - amount),
        );
        env.storage().persistent().set(
            &DataKey::CurrencyBalance(to.clone()),
            &(to_balance + amount),
        );

        events::emit_currency_transferred(&env, &from, &to, amount);
        Ok(())
    }

    /// Burn currency (remove from circulation)
    pub fn burn_currency(
        env: Env,
        owner: Address,
        amount: i128,
    ) -> Result<(), VirtualEconomyError> {
        owner.require_auth();

        if amount <= 0 {
            return Err(VirtualEconomyError::InvalidAmount);
        }

        let balance = Self::get_currency_balance(env.clone(), owner.clone());
        if balance < amount {
            return Err(VirtualEconomyError::InsufficientBalance);
        }

        // Update balance and supply
        env.storage().persistent().set(
            &DataKey::CurrencyBalance(owner.clone()),
            &(balance - amount),
        );

        let current_supply = Self::get_total_currency_supply(env.clone());
        env.storage()
            .persistent()
            .set(&DataKey::TotalCurrencySupply, &(current_supply - amount));

        // Update analytics
        let mut analytics = Self::get_economy_analytics(env.clone());
        analytics.total_currency_burned += amount;
        env.storage()
            .instance()
            .set(&DataKey::EconomyAnalytics, &analytics);

        events::emit_currency_burned(&env, &owner, amount);
        Ok(())
    }

    /// Get currency balance for an address
    pub fn get_currency_balance(env: Env, owner: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::CurrencyBalance(owner))
            .unwrap_or(0)
    }

    /// Get total currency supply
    pub fn get_total_currency_supply(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalCurrencySupply)
            .unwrap_or(0)
    }

    // -------------------------------------------------------------------------
    // Currency Management: Gas-Optimized Batch Operations
    //
    // Unlike calling mint/transfer/burn N times, these entry points read
    // TotalCurrencySupply and EconomyAnalytics exactly once, accumulate the
    // aggregate delta in memory, and write both back exactly once,
    // collapsing O(N) aggregate-state storage access down to O(1). See
    // batch.rs and docs/BATCH_GAS_BENCHMARKS.md for details and measured
    // savings.
    // -------------------------------------------------------------------------

    /// Maximum number of items accepted by a single batch call.
    pub fn get_max_batch_size(_env: Env) -> u32 {
        MAX_BATCH_SIZE
    }

    /// Mint currency to many recipients in a single call.
    pub fn batch_mint_currency(
        env: Env,
        recipients: Vec<Address>,
        amounts: Vec<i128>,
        reason: String,
    ) -> Result<BatchResult, VirtualEconomyError> {
        Self::require_authorized_minter(&env)?;
        BatchManager::validate_batch_size(recipients.len())?;
        BatchManager::validate_matching_lengths(recipients.len(), amounts.len())?;
        let total_mint = BatchManager::sum_positive(&amounts)?;

        let config = Self::get_currency_config(&env);
        let current_supply = Self::get_total_currency_supply(env.clone());
        if current_supply + total_mint > config.max_supply {
            return Err(VirtualEconomyError::SupplyLimitExceeded);
        }

        for i in 0..recipients.len() {
            let recipient = recipients.get_unchecked(i);
            let amount = amounts.get_unchecked(i);
            let current_balance = Self::get_currency_balance(env.clone(), recipient.clone());
            env.storage().persistent().set(
                &DataKey::CurrencyBalance(recipient.clone()),
                &(current_balance + amount),
            );
            events::emit_currency_minted(&env, &recipient, amount, &reason);
        }

        env.storage().persistent().set(
            &DataKey::TotalCurrencySupply,
            &(current_supply + total_mint),
        );

        let mut analytics = Self::get_economy_analytics(env.clone());
        analytics.total_currency_minted += total_mint;
        env.storage()
            .instance()
            .set(&DataKey::EconomyAnalytics, &analytics);

        Ok(BatchResult {
            items_processed: recipients.len(),
            total_amount: total_mint,
        })
    }

    /// Transfer currency from one sender to many recipients in a single call.
    pub fn batch_transfer_currency(
        env: Env,
        from: Address,
        items: Vec<BatchTransferItem>,
    ) -> Result<BatchResult, VirtualEconomyError> {
        from.require_auth();
        BatchManager::validate_batch_size(items.len())?;

        let mut total_amount: i128 = 0;
        for item in items.iter() {
            if item.amount <= 0 {
                return Err(VirtualEconomyError::InvalidAmount);
            }
            total_amount += item.amount;
        }

        let from_balance = Self::get_currency_balance(env.clone(), from.clone());
        if from_balance < total_amount {
            return Err(VirtualEconomyError::InsufficientBalance);
        }

        for item in items.iter() {
            let to_balance = Self::get_currency_balance(env.clone(), item.to.clone());
            env.storage().persistent().set(
                &DataKey::CurrencyBalance(item.to.clone()),
                &(to_balance + item.amount),
            );
            events::emit_currency_transferred(&env, &from, &item.to, item.amount);
        }

        env.storage().persistent().set(
            &DataKey::CurrencyBalance(from.clone()),
            &(from_balance - total_amount),
        );

        Ok(BatchResult {
            items_processed: items.len(),
            total_amount,
        })
    }

    /// Burn currency from many owners in a single call.
    pub fn batch_burn_currency(
        env: Env,
        owners: Vec<Address>,
        amounts: Vec<i128>,
    ) -> Result<BatchResult, VirtualEconomyError> {
        BatchManager::validate_batch_size(owners.len())?;
        BatchManager::validate_matching_lengths(owners.len(), amounts.len())?;

        // Every owner must authorize the burn of their own balance, and every
        // balance must cover its amount, validated before any write happens
        // so the batch fails atomically.
        for i in 0..owners.len() {
            let owner = owners.get_unchecked(i);
            let amount = amounts.get_unchecked(i);
            owner.require_auth();
            if amount <= 0 {
                return Err(VirtualEconomyError::InvalidAmount);
            }
            let balance = Self::get_currency_balance(env.clone(), owner.clone());
            if balance < amount {
                return Err(VirtualEconomyError::InsufficientBalance);
            }
        }

        let total_burn = BatchManager::sum_positive(&amounts)?;

        for i in 0..owners.len() {
            let owner = owners.get_unchecked(i);
            let amount = amounts.get_unchecked(i);
            let balance = Self::get_currency_balance(env.clone(), owner.clone());
            env.storage().persistent().set(
                &DataKey::CurrencyBalance(owner.clone()),
                &(balance - amount),
            );
            events::emit_currency_burned(&env, &owner, amount);
        }

        let current_supply = Self::get_total_currency_supply(env.clone());
        env.storage().persistent().set(
            &DataKey::TotalCurrencySupply,
            &(current_supply - total_burn),
        );

        let mut analytics = Self::get_economy_analytics(env.clone());
        analytics.total_currency_burned += total_burn;
        env.storage()
            .instance()
            .set(&DataKey::EconomyAnalytics, &analytics);

        Ok(BatchResult {
            items_processed: owners.len(),
            total_amount: total_burn,
        })
    }

    // -------------------------------------------------------------------------
    // NFT Management
    // -------------------------------------------------------------------------

    /// Mint an NFT with metadata
    pub fn mint_nft(
        env: Env,
        owner: Address,
        metadata: NFTMetadata,
        token_id: Option<BytesN<32>>,
    ) -> Result<BytesN<32>, VirtualEconomyError> {
        Self::require_authorized_minter(&env)?;

        let final_token_id = if let Some(id) = token_id {
            // Check if token already exists
            if env
                .storage()
                .persistent()
                .has(&DataKey::NFTOwner(id.clone()))
            {
                return Err(VirtualEconomyError::TokenAlreadyExists);
            }
            id
        } else {
            // Generate new token ID
            let counter: u64 = env
                .storage()
                .instance()
                .get(&DataKey::TokenCounter)
                .unwrap_or(0);
            let new_counter = counter + 1;
            env.storage()
                .instance()
                .set(&DataKey::TokenCounter, &new_counter);

            let mut id_bytes = [0u8; 32];
            id_bytes[0..8].copy_from_slice(&new_counter.to_be_bytes());
            BytesN::from_array(&env, &id_bytes)
        };

        // Store NFT data
        env.storage()
            .persistent()
            .set(&DataKey::NFTOwner(final_token_id.clone()), &owner);
        env.storage()
            .persistent()
            .set(&DataKey::NFTMetadata(final_token_id.clone()), &metadata);

        // Update owner's NFT list
        let mut owned_nfts: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::OwnedNFTs(owner.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        owned_nfts.push_back(final_token_id.clone());
        env.storage()
            .persistent()
            .set(&DataKey::OwnedNFTs(owner.clone()), &owned_nfts);

        // Update analytics
        let mut analytics = Self::get_economy_analytics(env.clone());
        analytics.total_nfts_minted += 1;
        env.storage()
            .instance()
            .set(&DataKey::EconomyAnalytics, &analytics);

        events::emit_nft_minted(&env, &final_token_id, &owner, &metadata.name);
        Ok(final_token_id)
    }

    /// Transfer NFT between addresses
    pub fn transfer_nft(
        env: Env,
        from: Address,
        to: Address,
        token_id: BytesN<32>,
    ) -> Result<(), VirtualEconomyError> {
        from.require_auth();

        let current_owner: Address = env
            .storage()
            .persistent()
            .get(&DataKey::NFTOwner(token_id.clone()))
            .ok_or(VirtualEconomyError::TokenNotFound)?;

        if current_owner != from {
            return Err(VirtualEconomyError::NotOwner);
        }

        // Update ownership
        env.storage()
            .persistent()
            .set(&DataKey::NFTOwner(token_id.clone()), &to);

        // Update from's NFT list
        let from_nfts: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::OwnedNFTs(from.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        // Remove token from from's list
        let mut new_from_nfts: Vec<BytesN<32>> = Vec::new(&env);
        for nft in from_nfts.iter() {
            if nft != token_id {
                new_from_nfts.push_back(nft);
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::OwnedNFTs(from.clone()), &new_from_nfts);

        // Add to to's NFT list
        let mut to_nfts: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::OwnedNFTs(to.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        to_nfts.push_back(token_id.clone());
        env.storage()
            .persistent()
            .set(&DataKey::OwnedNFTs(to.clone()), &to_nfts);

        events::emit_nft_transferred(&env, &token_id, &from, &to);
        Ok(())
    }

    /// Get NFT owner
    pub fn get_nft_owner(env: Env, token_id: BytesN<32>) -> Result<Address, VirtualEconomyError> {
        env.storage()
            .persistent()
            .get(&DataKey::NFTOwner(token_id))
            .ok_or(VirtualEconomyError::TokenNotFound)
    }

    /// Get NFT metadata
    pub fn get_nft_metadata(
        env: Env,
        token_id: BytesN<32>,
    ) -> Result<NFTMetadata, VirtualEconomyError> {
        env.storage()
            .persistent()
            .get(&DataKey::NFTMetadata(token_id))
            .ok_or(VirtualEconomyError::TokenNotFound)
    }

    /// Get NFTs owned by an address
    pub fn get_owned_nfts(env: Env, owner: Address) -> Vec<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::OwnedNFTs(owner))
            .unwrap_or_else(|| Vec::new(&env))
    }

    // -------------------------------------------------------------------------
    // Marketplace
    // -------------------------------------------------------------------------

    /// Create a marketplace order (listing)
    pub fn create_marketplace_order(
        env: Env,
        seller: Address,
        asset: MarketplaceAsset,
        price: i128,
        expiry: Option<u64>,
    ) -> Result<BytesN<32>, VirtualEconomyError> {
        seller.require_auth();

        if price <= 0 {
            return Err(VirtualEconomyError::InvalidPrice);
        }

        // Verify seller owns the asset
        match &asset {
            MarketplaceAsset::NFT(token_id) => {
                let owner = Self::get_nft_owner(env.clone(), token_id.clone())?;
                if owner != seller {
                    return Err(VirtualEconomyError::NotOwner);
                }
            }
            MarketplaceAsset::Currency(amount) => {
                let balance = Self::get_currency_balance(env.clone(), seller.clone());
                if balance < *amount {
                    return Err(VirtualEconomyError::InsufficientBalance);
                }
            }
        }

        // Generate order ID
        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::OrderCounter)
            .unwrap_or(0);
        let new_counter = counter + 1;
        env.storage()
            .instance()
            .set(&DataKey::OrderCounter, &new_counter);

        let mut order_bytes = [0u8; 32];
        order_bytes[0..8].copy_from_slice(&new_counter.to_be_bytes());
        let order_id = BytesN::from_array(&env, &order_bytes);

        let order = MarketplaceOrder {
            order_id: order_id.clone(),
            seller: seller.clone(),
            asset: asset.clone(),
            price,
            created_at: env.ledger().timestamp(),
            expiry,
            status: OrderStatus::Active,
        };

        env.storage()
            .persistent()
            .set(&DataKey::MarketplaceOrder(order_id.clone()), &order);

        // Update analytics
        let mut analytics = Self::get_economy_analytics(env.clone());
        analytics.active_orders += 1;
        env.storage()
            .instance()
            .set(&DataKey::EconomyAnalytics, &analytics);

        events::emit_marketplace_order_created(&env, &order_id, &seller, price);
        Ok(order_id)
    }

    /// Execute a marketplace trade
    pub fn execute_marketplace_trade(
        env: Env,
        buyer: Address,
        order_id: BytesN<32>,
    ) -> Result<(), VirtualEconomyError> {
        buyer.require_auth();

        let mut order: MarketplaceOrder = env
            .storage()
            .persistent()
            .get(&DataKey::MarketplaceOrder(order_id.clone()))
            .ok_or(VirtualEconomyError::OrderNotFound)?;

        if order.status != OrderStatus::Active {
            return Err(VirtualEconomyError::OrderNotActive);
        }

        // Check expiry
        if let Some(expiry) = order.expiry {
            if env.ledger().timestamp() > expiry {
                return Err(VirtualEconomyError::OrderExpired);
            }
        }

        // Check buyer has enough currency
        let buyer_balance = Self::get_currency_balance(env.clone(), buyer.clone());
        if buyer_balance < order.price {
            return Err(VirtualEconomyError::InsufficientBalance);
        }

        let config = Self::get_marketplace_config(&env);
        let fee = (order.price * config.fee_percentage as i128) / 10000; // basis points

        // Calculate royalty for NFT trades
        let mut royalty_amount = 0i128;
        let mut creator = None;

        if let MarketplaceAsset::NFT(token_id) = &order.asset {
            if let Some(metadata) = env
                .storage()
                .persistent()
                .get::<_, NFTMetadata>(&DataKey::NFTMetadata(token_id.clone()))
            {
                creator = Some(metadata.creator.clone());

                // Only pay royalty if seller != creator (not a primary sale)
                let is_primary_sale = metadata.creator == order.seller;
                let is_exempt = env
                    .storage()
                    .persistent()
                    .get::<_, bool>(&DataKey::RoyaltyExempt(buyer.clone()))
                    .unwrap_or(false);

                if !is_primary_sale && !is_exempt && metadata.royalty_bps > 0 {
                    royalty_amount = (order.price * metadata.royalty_bps as i128) / 10000;
                }
            }
        }

        let seller_amount = order.price - fee - royalty_amount;

        // Transfer payment
        env.storage().persistent().set(
            &DataKey::CurrencyBalance(buyer.clone()),
            &(buyer_balance - order.price),
        );

        let seller_balance = Self::get_currency_balance(env.clone(), order.seller.clone());
        env.storage().persistent().set(
            &DataKey::CurrencyBalance(order.seller.clone()),
            &(seller_balance + seller_amount),
        );

        // Collect fee
        let fee_collector_balance =
            Self::get_currency_balance(env.clone(), config.fee_collector.clone());
        env.storage().persistent().set(
            &DataKey::CurrencyBalance(config.fee_collector.clone()),
            &(fee_collector_balance + fee),
        );

        // Pay royalty to creator if applicable
        if royalty_amount > 0 {
            if let Some(creator_addr) = creator {
                let creator_balance = Self::get_currency_balance(env.clone(), creator_addr.clone());
                env.storage().persistent().set(
                    &DataKey::CurrencyBalance(creator_addr),
                    &(creator_balance + royalty_amount),
                );

                // Update royalty analytics
                let mut royalty_stats: RoyaltyAnalytics = env
                    .storage()
                    .persistent()
                    .get(&DataKey::RoyaltyAnalytics)
                    .unwrap_or(RoyaltyAnalytics {
                        total_royalties_paid: 0,
                        total_royalty_transactions: 0,
                        total_exemptions_applied: 0,
                    });

                royalty_stats.total_royalties_paid += royalty_amount;
                royalty_stats.total_royalty_transactions += 1;

                env.storage()
                    .persistent()
                    .set(&DataKey::RoyaltyAnalytics, &royalty_stats);
            }
        }

        // Transfer asset
        match &order.asset {
            MarketplaceAsset::NFT(token_id) => {
                Self::transfer_nft(
                    env.clone(),
                    order.seller.clone(),
                    buyer.clone(),
                    token_id.clone(),
                )?;
            }
            MarketplaceAsset::Currency(amount) => {
                // For currency sales, the "asset" is already handled in payment transfer
                let _ = amount; // Currency transfer handled above
            }
        }

        // Mark order as completed
        order.status = OrderStatus::Completed;
        env.storage()
            .persistent()
            .set(&DataKey::MarketplaceOrder(order_id.clone()), &order);

        // Update analytics
        let mut analytics = Self::get_economy_analytics(env.clone());
        analytics.active_orders -= 1;
        analytics.total_trades_executed += 1;
        analytics.total_trade_volume += order.price;
        analytics.total_fees_collected += fee;
        env.storage()
            .instance()
            .set(&DataKey::EconomyAnalytics, &analytics);

        events::emit_marketplace_trade_executed(
            &env,
            &order_id,
            &buyer,
            &order.seller,
            order.price,
        );
        Ok(())
    }

    /// Cancel a marketplace order
    pub fn cancel_marketplace_order(
        env: Env,
        order_id: BytesN<32>,
    ) -> Result<(), VirtualEconomyError> {
        let mut order: MarketplaceOrder = env
            .storage()
            .persistent()
            .get(&DataKey::MarketplaceOrder(order_id.clone()))
            .ok_or(VirtualEconomyError::OrderNotFound)?;

        order.seller.require_auth();

        if order.status != OrderStatus::Active {
            return Err(VirtualEconomyError::OrderNotActive);
        }

        order.status = OrderStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::MarketplaceOrder(order_id.clone()), &order);

        // Update analytics
        let mut analytics = Self::get_economy_analytics(env.clone());
        analytics.active_orders -= 1;
        env.storage()
            .instance()
            .set(&DataKey::EconomyAnalytics, &analytics);

        events::emit_marketplace_order_cancelled(&env, &order_id);
        Ok(())
    }

    /// Get marketplace order details
    pub fn get_marketplace_order(
        env: Env,
        order_id: BytesN<32>,
    ) -> Result<MarketplaceOrder, VirtualEconomyError> {
        env.storage()
            .persistent()
            .get(&DataKey::MarketplaceOrder(order_id))
            .ok_or(VirtualEconomyError::OrderNotFound)
    }

    // -------------------------------------------------------------------------
    // Dynamic Pricing: Dutch Auctions
    //
    // A single NFT listed at a price that decays over time from
    // `start_price` to `floor_price` instead of a fixed price, so price
    // discovery happens automatically instead of the seller guessing.
    // -------------------------------------------------------------------------

    /// List an NFT in a Dutch auction. Price starts at `start_price` and
    /// decays to `floor_price` between `start_time` and `end_time` following
    /// `curve`.
    pub fn create_dutch_auction(
        env: Env,
        seller: Address,
        token_id: BytesN<32>,
        start_price: i128,
        floor_price: i128,
        start_time: u64,
        end_time: u64,
        curve: PriceCurve,
    ) -> Result<BytesN<32>, VirtualEconomyError> {
        seller.require_auth();

        let owner = Self::get_nft_owner(env.clone(), token_id.clone())?;
        if owner != seller {
            return Err(VirtualEconomyError::NotOwner);
        }

        MarketplaceManager::validate_auction_params(
            start_price,
            floor_price,
            start_time,
            end_time,
        )?;

        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::AuctionCounter)
            .unwrap_or(0);
        let new_counter = counter + 1;
        env.storage()
            .instance()
            .set(&DataKey::AuctionCounter, &new_counter);

        let mut id_bytes = [0u8; 32];
        id_bytes[0..8].copy_from_slice(&new_counter.to_be_bytes());
        let listing_id = BytesN::from_array(&env, &id_bytes);

        let listing = DutchAuctionListing {
            listing_id: listing_id.clone(),
            seller: seller.clone(),
            token_id: token_id.clone(),
            start_price,
            floor_price,
            start_time,
            end_time,
            curve,
            status: OrderStatus::Active,
        };
        env.storage()
            .persistent()
            .set(&DataKey::DutchAuction(listing_id.clone()), &listing);

        let mut analytics = Self::get_pricing_analytics(env.clone());
        analytics.total_auctions_created += 1;
        env.storage()
            .instance()
            .set(&DataKey::PricingAnalytics, &analytics);

        events::emit_dutch_auction_created(
            &env,
            &listing_id,
            &seller,
            &token_id,
            start_price,
            floor_price,
        );
        Ok(listing_id)
    }

    /// Get the auction listing details (static fields; use
    /// [`Self::get_auction_price`] for the current live price).
    pub fn get_dutch_auction(
        env: Env,
        listing_id: BytesN<32>,
    ) -> Result<DutchAuctionListing, VirtualEconomyError> {
        env.storage()
            .persistent()
            .get(&DataKey::DutchAuction(listing_id))
            .ok_or(VirtualEconomyError::AuctionNotFound)
    }

    /// Compute the current price of an active auction given the ledger time.
    pub fn get_auction_price(
        env: Env,
        listing_id: BytesN<32>,
    ) -> Result<i128, VirtualEconomyError> {
        let listing = Self::get_dutch_auction(env.clone(), listing_id)?;
        Ok(MarketplaceManager::dutch_auction_price(&env, &listing))
    }

    /// Buy the auctioned NFT at its current computed price. Applies the
    /// same marketplace fee and creator royalty rules as fixed-price trades.
    pub fn purchase_dutch_auction(
        env: Env,
        buyer: Address,
        listing_id: BytesN<32>,
    ) -> Result<(), VirtualEconomyError> {
        buyer.require_auth();

        let mut listing = Self::get_dutch_auction(env.clone(), listing_id.clone())?;
        if listing.status != OrderStatus::Active {
            return Err(VirtualEconomyError::AuctionNotActive);
        }
        if env.ledger().timestamp() >= listing.end_time {
            return Err(VirtualEconomyError::AuctionEnded);
        }

        let price = MarketplaceManager::dutch_auction_price(&env, &listing);

        let buyer_balance = Self::get_currency_balance(env.clone(), buyer.clone());
        if buyer_balance < price {
            return Err(VirtualEconomyError::InsufficientBalance);
        }

        let config = Self::get_marketplace_config(&env);
        let fee = (price * config.fee_percentage as i128) / 10000;

        let mut royalty_amount = 0i128;
        let mut creator = None;
        if let Some(metadata) = env
            .storage()
            .persistent()
            .get::<_, NFTMetadata>(&DataKey::NFTMetadata(listing.token_id.clone()))
        {
            creator = Some(metadata.creator.clone());
            let is_primary_sale = metadata.creator == listing.seller;
            let is_exempt = env
                .storage()
                .persistent()
                .get::<_, bool>(&DataKey::RoyaltyExempt(buyer.clone()))
                .unwrap_or(false);
            if !is_primary_sale && !is_exempt && metadata.royalty_bps > 0 {
                royalty_amount = (price * metadata.royalty_bps as i128) / 10000;
            }
        }

        let seller_amount = price - fee - royalty_amount;

        env.storage().persistent().set(
            &DataKey::CurrencyBalance(buyer.clone()),
            &(buyer_balance - price),
        );
        let seller_balance = Self::get_currency_balance(env.clone(), listing.seller.clone());
        env.storage().persistent().set(
            &DataKey::CurrencyBalance(listing.seller.clone()),
            &(seller_balance + seller_amount),
        );
        let fee_collector_balance =
            Self::get_currency_balance(env.clone(), config.fee_collector.clone());
        env.storage().persistent().set(
            &DataKey::CurrencyBalance(config.fee_collector.clone()),
            &(fee_collector_balance + fee),
        );
        if royalty_amount > 0 {
            if let Some(creator_addr) = creator {
                let creator_balance = Self::get_currency_balance(env.clone(), creator_addr.clone());
                env.storage().persistent().set(
                    &DataKey::CurrencyBalance(creator_addr),
                    &(creator_balance + royalty_amount),
                );

                let mut royalty_stats = Self::get_royalty_analytics(env.clone());
                royalty_stats.total_royalties_paid += royalty_amount;
                royalty_stats.total_royalty_transactions += 1;
                env.storage()
                    .persistent()
                    .set(&DataKey::RoyaltyAnalytics, &royalty_stats);
            }
        }

        Self::transfer_nft(
            env.clone(),
            listing.seller.clone(),
            buyer.clone(),
            listing.token_id.clone(),
        )?;

        listing.status = OrderStatus::Completed;
        env.storage()
            .persistent()
            .set(&DataKey::DutchAuction(listing_id.clone()), &listing);

        let mut analytics = Self::get_pricing_analytics(env.clone());
        analytics.total_auctions_settled += 1;
        analytics.total_auction_volume += price;
        env.storage()
            .instance()
            .set(&DataKey::PricingAnalytics, &analytics);

        events::emit_dutch_auction_purchased(&env, &listing_id, &buyer, price);
        Ok(())
    }

    /// Cancel an active auction (seller only).
    pub fn cancel_dutch_auction(
        env: Env,
        listing_id: BytesN<32>,
    ) -> Result<(), VirtualEconomyError> {
        let mut listing = Self::get_dutch_auction(env.clone(), listing_id.clone())?;
        listing.seller.require_auth();

        if listing.status != OrderStatus::Active {
            return Err(VirtualEconomyError::AuctionNotActive);
        }
        listing.status = OrderStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::DutchAuction(listing_id.clone()), &listing);

        events::emit_dutch_auction_cancelled(&env, &listing_id);
        Ok(())
    }

    // -------------------------------------------------------------------------
    // Dynamic Pricing: Bonding Curve Drops
    //
    // A repeatable NFT mint whose price rises with each unit already
    // minted, so the price itself reflects realised demand instead of a
    // creator's static guess.
    // -------------------------------------------------------------------------

    /// Create a bonding-curve drop. `slope_bps` controls how fast the price
    /// rises per mint (basis points of `base_price`); `max_supply` optionally
    /// caps total mints.
    pub fn create_bonding_curve_drop(
        env: Env,
        creator: Address,
        base_price: i128,
        slope_bps: u32,
        max_supply: Option<u32>,
        metadata_template: NFTMetadata,
    ) -> Result<BytesN<32>, VirtualEconomyError> {
        creator.require_auth();
        MarketplaceManager::validate_curve_params(base_price, slope_bps, max_supply)?;

        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DropCounter)
            .unwrap_or(0);
        let new_counter = counter + 1;
        env.storage()
            .instance()
            .set(&DataKey::DropCounter, &new_counter);

        let mut id_bytes = [0u8; 32];
        id_bytes[8..16].copy_from_slice(&new_counter.to_be_bytes());
        let drop_id = BytesN::from_array(&env, &id_bytes);

        let drop = BondingCurveDrop {
            drop_id: drop_id.clone(),
            creator: creator.clone(),
            base_price,
            slope_bps,
            max_supply,
            minted: 0,
            metadata_template,
            active: true,
        };
        env.storage()
            .persistent()
            .set(&DataKey::BondingCurveDrop(drop_id.clone()), &drop);

        let mut analytics = Self::get_pricing_analytics(env.clone());
        analytics.total_drops_created += 1;
        env.storage()
            .instance()
            .set(&DataKey::PricingAnalytics, &analytics);

        events::emit_bonding_curve_drop_created(&env, &drop_id, &creator, base_price, slope_bps);
        Ok(drop_id)
    }

    pub fn get_bonding_curve_drop(
        env: Env,
        drop_id: BytesN<32>,
    ) -> Result<BondingCurveDrop, VirtualEconomyError> {
        env.storage()
            .persistent()
            .get(&DataKey::BondingCurveDrop(drop_id))
            .ok_or(VirtualEconomyError::DropNotFound)
    }

    /// Compute the current mint price of a drop given units minted so far.
    pub fn get_drop_price(env: Env, drop_id: BytesN<32>) -> Result<i128, VirtualEconomyError> {
        let drop = Self::get_bonding_curve_drop(env, drop_id)?;
        Ok(MarketplaceManager::bonding_curve_price(&drop))
    }

    /// Mint the next unit from a drop at its current bonding-curve price.
    /// Payment (in the contract's internal currency) goes to the drop's
    /// creator, minus the standard marketplace fee.
    pub fn mint_from_drop(
        env: Env,
        buyer: Address,
        drop_id: BytesN<32>,
    ) -> Result<BytesN<32>, VirtualEconomyError> {
        buyer.require_auth();

        let mut drop = Self::get_bonding_curve_drop(env.clone(), drop_id.clone())?;
        if !drop.active {
            return Err(VirtualEconomyError::DropInactive);
        }
        if let Some(max) = drop.max_supply {
            if drop.minted >= max {
                return Err(VirtualEconomyError::DropSupplyExceeded);
            }
        }

        let price = MarketplaceManager::bonding_curve_price(&drop);
        let buyer_balance = Self::get_currency_balance(env.clone(), buyer.clone());
        if buyer_balance < price {
            return Err(VirtualEconomyError::InsufficientBalance);
        }

        let config = Self::get_marketplace_config(&env);
        let fee = (price * config.fee_percentage as i128) / 10000;
        let creator_amount = price - fee;

        env.storage().persistent().set(
            &DataKey::CurrencyBalance(buyer.clone()),
            &(buyer_balance - price),
        );
        let creator_balance = Self::get_currency_balance(env.clone(), drop.creator.clone());
        env.storage().persistent().set(
            &DataKey::CurrencyBalance(drop.creator.clone()),
            &(creator_balance + creator_amount),
        );
        let fee_collector_balance =
            Self::get_currency_balance(env.clone(), config.fee_collector.clone());
        env.storage().persistent().set(
            &DataKey::CurrencyBalance(config.fee_collector.clone()),
            &(fee_collector_balance + fee),
        );

        let token_id = Self::mint_nft(
            env.clone(),
            buyer.clone(),
            drop.metadata_template.clone(),
            None,
        )?;

        drop.minted += 1;
        env.storage()
            .persistent()
            .set(&DataKey::BondingCurveDrop(drop_id.clone()), &drop);

        let mut analytics = Self::get_pricing_analytics(env.clone());
        analytics.total_drop_mints += 1;
        analytics.total_drop_volume += price;
        env.storage()
            .instance()
            .set(&DataKey::PricingAnalytics, &analytics);

        events::emit_bonding_curve_drop_minted(&env, &drop_id, &buyer, &token_id, price);
        Ok(token_id)
    }

    /// Activate/deactivate a drop (creator only). Deactivating stops new
    /// mints without affecting units already minted.
    pub fn set_drop_active(
        env: Env,
        drop_id: BytesN<32>,
        caller: Address,
        active: bool,
    ) -> Result<(), VirtualEconomyError> {
        caller.require_auth();
        let mut drop = Self::get_bonding_curve_drop(env.clone(), drop_id.clone())?;
        if drop.creator != caller {
            return Err(VirtualEconomyError::Unauthorized);
        }
        drop.active = active;
        env.storage()
            .persistent()
            .set(&DataKey::BondingCurveDrop(drop_id.clone()), &drop);
        events::emit_bonding_curve_drop_updated(&env, &drop_id, active);
        Ok(())
    }

    /// Aggregate stats across all dynamic-pricing mechanisms.
    pub fn get_pricing_analytics(env: Env) -> PricingAnalytics {
        env.storage()
            .instance()
            .get(&DataKey::PricingAnalytics)
            .unwrap_or(PricingAnalytics {
                total_auctions_created: 0,
                total_auctions_settled: 0,
                total_auction_volume: 0,
                total_drops_created: 0,
                total_drop_mints: 0,
                total_drop_volume: 0,
            })
    }

    // -------------------------------------------------------------------------
    // Reward Distribution
    // -------------------------------------------------------------------------

    /// Distribute rewards to multiple recipients
    pub fn distribute_rewards(
        env: Env,
        rewards: Vec<RewardDistribution>,
        reason: String,
    ) -> Result<(), VirtualEconomyError> {
        Self::require_authorized_minter(&env)?;

        for reward in rewards.iter() {
            match &reward.reward_type {
                RewardType::Currency(amount) => {
                    Self::mint_currency(
                        env.clone(),
                        reward.recipient.clone(),
                        *amount,
                        reason.clone(),
                    )?;
                }
                RewardType::NFT(metadata) => {
                    Self::mint_nft(
                        env.clone(),
                        reward.recipient.clone(),
                        metadata.clone(),
                        None,
                    )?;
                }
            }
        }

        events::emit_rewards_distributed(&env, rewards.len(), &reason);
        Ok(())
    }

    // -------------------------------------------------------------------------
    // Referrals
    // -------------------------------------------------------------------------

    /// Configure tier thresholds and bonus rates. Tiers must be ordered by
    /// increasing volume and each combined rate must be at most 100%.
    pub fn configure_referrals(
        env: Env,
        config: ReferralConfig,
    ) -> Result<(), VirtualEconomyError> {
        Self::require_admin(&env)?;
        if config.tiers.is_empty()
            || config.max_reward_per_activity <= 0
            || config.activity_cooldown == 0
        {
            return Err(VirtualEconomyError::InvalidConfig);
        }
        let mut previous = -1i128;
        for tier in config.tiers.iter() {
            if tier.min_volume < 0
                || tier.min_volume <= previous
                || tier.referrer_bps as u64 + tier.referee_bps as u64 > 10_000
            {
                return Err(VirtualEconomyError::InvalidConfig);
            }
            previous = tier.min_volume;
        }
        env.storage().instance().set(&DataKey::ReferralConfig, &config);
        Ok(())
    }

    /// Register `referee` under `referrer`. A referee can only be registered
    /// once and must authorize the registration themselves.
    pub fn register_referral(
        env: Env,
        referee: Address,
        referrer: Address,
    ) -> Result<(), VirtualEconomyError> {
        referee.require_auth();
        if !env.storage().instance().has(&DataKey::ReferralConfig) {
            return Err(VirtualEconomyError::ReferralNotConfigured);
        }
        if referee == referrer {
            return Err(VirtualEconomyError::InvalidReferral);
        }
        if let Some(referrer_account) = Self::referral_account(&env, referrer.clone()) {
            if referrer_account.flagged {
                return Err(VirtualEconomyError::ReferralFraud);
            }
            // Prevent a two-account referral cycle. Cycles make attribution
            // ambiguous and are a common sybil pattern.
            if referrer_account.referrer == Some(referee.clone()) {
                return Err(VirtualEconomyError::ReferralFraud);
            }
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::ReferralAccount(referee.clone()))
        {
            return Err(VirtualEconomyError::ReferralAlreadyRegistered);
        }
        env.storage().persistent().set(
            &DataKey::ReferralAccount(referee),
            &ReferralAccount {
                referrer: Some(referrer.clone()),
                qualifying_volume: 0,
                pending_rewards: 0,
                total_rewards: 0,
                referred_count: 0,
                last_activity: 0,
                flagged: false,
            },
        );
        let mut account = Self::referral_account(&env, referrer.clone()).unwrap_or(ReferralAccount {
            referrer: None,
            qualifying_volume: 0,
            pending_rewards: 0,
            total_rewards: 0,
            referred_count: 0,
            last_activity: 0,
            flagged: false,
        });
        account.referred_count += 1;
        env.storage()
            .persistent()
            .set(&DataKey::ReferralAccount(referrer), &account);
        Ok(())
    }

    /// Record qualifying activity and accrue both sides' tier bonuses.
    pub fn record_referral_activity(
        env: Env,
        referee: Address,
        amount: i128,
    ) -> Result<(i128, i128), VirtualEconomyError> {
        referee.require_auth();
        if amount <= 0 {
            return Err(VirtualEconomyError::InvalidAmount);
        }
        let config: ReferralConfig = env
            .storage()
            .instance()
            .get(&DataKey::ReferralConfig)
            .ok_or(VirtualEconomyError::ReferralNotConfigured)?;
        let mut referee_account = Self::referral_account(&env, referee.clone())
            .ok_or(VirtualEconomyError::ReferralNotFound)?;
        let referrer = referee_account
            .referrer
            .clone()
            .ok_or(VirtualEconomyError::ReferralNotFound)?;
        let mut referrer_account = Self::referral_account(&env, referrer.clone())
            .ok_or(VirtualEconomyError::ReferralNotFound)?;
        if referee_account.flagged || referrer_account.flagged {
            return Err(VirtualEconomyError::ReferralFraud);
        }
        let now = env.ledger().timestamp();
        if referee_account.last_activity > 0
            && now < referee_account.last_activity + config.activity_cooldown
        {
            return Err(VirtualEconomyError::ReferralCooldown);
        }
        referee_account.qualifying_volume += amount;
        let mut tier = None;
        for candidate in config.tiers.iter() {
            if referee_account.qualifying_volume >= candidate.min_volume {
                tier = Some(candidate);
            }
        }
        let tier = tier.ok_or(VirtualEconomyError::InvalidConfig)?;
        let mut referrer_reward = amount * tier.referrer_bps as i128 / 10_000;
        let mut referee_reward = amount * tier.referee_bps as i128 / 10_000;
        let total = referrer_reward + referee_reward;
        if total > config.max_reward_per_activity {
            let scale = config.max_reward_per_activity;
            referrer_reward = referrer_reward * scale / total;
            referee_reward = scale - referrer_reward;
        }
        referee_account.pending_rewards += referee_reward;
        referee_account.total_rewards += referee_reward;
        referee_account.last_activity = now;
        referrer_account.pending_rewards += referrer_reward;
        referrer_account.total_rewards += referrer_reward;
        env.storage().persistent().set(
            &DataKey::ReferralAccount(referee),
            &referee_account,
        );
        env.storage()
            .persistent()
            .set(&DataKey::ReferralAccount(referrer), &referrer_account);
        Ok((referrer_reward, referee_reward))
    }

    /// Claim all pending referral rewards for `account`.
    pub fn claim_referral_rewards(
        env: Env,
        account: Address,
    ) -> Result<i128, VirtualEconomyError> {
        account.require_auth();
        let mut referral = Self::referral_account(&env, account.clone())
            .ok_or(VirtualEconomyError::ReferralNotFound)?;
        if referral.flagged {
            return Err(VirtualEconomyError::ReferralFraud);
        }
        if referral.pending_rewards <= 0 {
            return Err(VirtualEconomyError::NothingToClaim);
        }
        let amount = referral.pending_rewards;
        let supply = Self::get_total_currency_supply(env.clone());
        let config = Self::get_currency_config(&env);
        if supply + amount > config.max_supply {
            return Err(VirtualEconomyError::SupplyLimitExceeded);
        }
        let balance = Self::get_currency_balance(env.clone(), account.clone());
        env.storage().persistent().set(
            &DataKey::CurrencyBalance(account),
            &(balance + amount),
        );
        env.storage()
            .persistent()
            .set(&DataKey::TotalCurrencySupply, &(supply + amount));
        let mut analytics = Self::get_economy_analytics(env.clone());
        analytics.total_currency_minted += amount;
        env.storage()
            .instance()
            .set(&DataKey::EconomyAnalytics, &analytics);
        referral.pending_rewards = 0;
        env.storage()
            .persistent()
            .set(&DataKey::ReferralAccount(account), &referral);
        Ok(amount)
    }

    /// Flag or clear an account after off-chain or on-chain fraud review.
    pub fn set_referral_fraud_flag(
        env: Env,
        account: Address,
        flagged: bool,
    ) -> Result<(), VirtualEconomyError> {
        Self::require_admin(&env)?;
        let mut referral = Self::referral_account(&env, account.clone())
            .ok_or(VirtualEconomyError::ReferralNotFound)?;
        referral.flagged = flagged;
        env.storage()
            .persistent()
            .set(&DataKey::ReferralAccount(account), &referral);
        Ok(())
    }

    pub fn get_referral_account(env: Env, account: Address) -> Option<ReferralAccount> {
        Self::referral_account(&env, account)
    }

    pub fn get_referral_config(env: Env) -> Option<ReferralConfig> {
        env.storage().instance().get(&DataKey::ReferralConfig)
    }

    // -------------------------------------------------------------------------
    // Analytics & Monitoring
    // -------------------------------------------------------------------------

    /// Get economy analytics
    pub fn get_economy_analytics(env: Env) -> EconomyAnalytics {
        env.storage()
            .instance()
            .get(&DataKey::EconomyAnalytics)
            .unwrap_or(EconomyAnalytics {
                total_currency_minted: 0,
                total_currency_burned: 0,
                total_nfts_minted: 0,
                total_trades_executed: 0,
                total_trade_volume: 0,
                total_fees_collected: 0,
                active_orders: 0,
                unique_traders: 0,
            })
    }

    /// Update inflation control parameters
    pub fn update_inflation_controls(
        env: Env,
        new_config: CurrencyConfig,
    ) -> Result<(), VirtualEconomyError> {
        Self::require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::CurrencyConfig, &new_config);
        events::emit_inflation_controls_updated(&env);
        Ok(())
    }

    /// Emergency pause all economy functions
    pub fn emergency_pause(env: Env) -> Result<(), VirtualEconomyError> {
        Self::require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::EmergencyPaused, &true);
        events::emit_emergency_paused(&env);
        Ok(())
    }

    /// Resume economy functions after emergency
    pub fn emergency_resume(env: Env) -> Result<(), VirtualEconomyError> {
        Self::require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::EmergencyPaused, &false);
        events::emit_emergency_resumed(&env);
        Ok(())
    }

    // -------------------------------------------------------------------------
    // Price Oracle Integration
    // -------------------------------------------------------------------------

    /// Configure the primary oracle address and global oracle settings.
    ///
    /// Only the contract admin may call this. Calling again overwrites the
    /// previous configuration.
    pub fn configure_oracle(
        env: Env,
        primary_oracle: Address,
        config: OracleConfig,
    ) -> Result<(), VirtualEconomyError> {
        Self::require_admin(&env)?;
        OracleManager::validate_config(&config)?;

        env.storage()
            .instance()
            .set(&DataKey::PrimaryOracle, &primary_oracle);
        env.storage()
            .instance()
            .set(&DataKey::OracleConfig, &config);

        // Initialise analytics if not yet present.
        if !env.storage().instance().has(&DataKey::OracleAnalytics) {
            let analytics = OracleAnalytics {
                primary_updates: 0,
                fallback_updates: 0,
                variance_rejections: 0,
                stale_rejections: 0,
                registered_pairs: 0,
            };
            env.storage()
                .instance()
                .set(&DataKey::OracleAnalytics, &analytics);
        }

        events::emit_oracle_configured(
            &env,
            &primary_oracle,
            config.update_interval,
            config.max_variance_bps,
        );
        Ok(())
    }

    /// Set (or replace) the fallback oracle address.
    ///
    /// The fallback oracle is consulted when the primary feed is stale or
    /// outside the variance window. Only the admin may call this.
    pub fn set_fallback_oracle(
        env: Env,
        fallback_oracle: Address,
    ) -> Result<(), VirtualEconomyError> {
        Self::require_admin(&env)?;

        env.storage()
            .instance()
            .set(&DataKey::FallbackOracle, &fallback_oracle);

        events::emit_oracle_fallback_set(&env, &fallback_oracle);
        Ok(())
    }

    /// Register a new asset pair and optionally override its update interval.
    ///
    /// `asset_pair` — a 32-byte identifier for the trading pair (e.g. the
    /// first 32 bytes of `sha256("XLM/USD")`).
    ///
    /// `update_interval_override` — when `Some`, overrides the global
    /// `OracleConfig.update_interval` for this pair only.
    pub fn register_oracle_pair(
        env: Env,
        asset_pair: BytesN<32>,
        update_interval_override: Option<u64>,
    ) -> Result<(), VirtualEconomyError> {
        Self::require_admin(&env)?;

        let global_config = Self::get_oracle_config(&env)?;

        let pair_interval = update_interval_override.unwrap_or(global_config.update_interval);
        if pair_interval == 0 {
            return Err(VirtualEconomyError::InvalidOracleConfig);
        }

        // Build and store the per-pair config (inherits global settings,
        // overrides only the interval).
        let pair_config = OracleConfig {
            update_interval: pair_interval,
            max_variance_bps: global_config.max_variance_bps,
            history_size: global_config.history_size,
            stale_multiplier: global_config.stale_multiplier,
        };
        env.storage()
            .persistent()
            .set(&DataKey::OraclePairConfig(asset_pair.clone()), &pair_config);

        // Initialise an empty history for this pair if none exists.
        if !env
            .storage()
            .persistent()
            .has(&DataKey::OraclePriceHistory(asset_pair.clone()))
        {
            let history = PriceHistory {
                entries: Vec::new(&env),
                last_price: 0,
                last_updated: 0,
                update_count: 0,
            };
            env.storage()
                .persistent()
                .set(&DataKey::OraclePriceHistory(asset_pair.clone()), &history);

            // Increment registered-pair counter.
            let mut analytics = Self::get_oracle_analytics(env.clone());
            analytics.registered_pairs += 1;
            env.storage()
                .instance()
                .set(&DataKey::OracleAnalytics, &analytics);
        }

        events::emit_oracle_pair_registered(&env, &asset_pair, pair_interval);
        Ok(())
    }

    /// Push a new price for an asset pair from the primary oracle.
    ///
    /// The caller must be the registered primary oracle address.
    ///
    /// The contract:
    /// 1. Checks the update frequency — rejects if too soon.
    /// 2. Validates the price is positive.
    /// 3. Checks variance against the last accepted price.
    /// 4. Appends the accepted price to the history ring-buffer.
    /// 5. Emits an event.
    pub fn submit_primary_price(
        env: Env,
        asset_pair: BytesN<32>,
        price: i128,
    ) -> Result<(), VirtualEconomyError> {
        let primary: Address = env
            .storage()
            .instance()
            .get(&DataKey::PrimaryOracle)
            .ok_or(VirtualEconomyError::OracleNotConfigured)?;
        primary.require_auth();

        if price <= 0 {
            return Err(VirtualEconomyError::OracleInvalidPrice);
        }

        let config = Self::get_pair_config(&env, &asset_pair)?;
        let now = env.ledger().timestamp();

        let mut history: PriceHistory = env
            .storage()
            .persistent()
            .get(&DataKey::OraclePriceHistory(asset_pair.clone()))
            .ok_or(VirtualEconomyError::InvalidAssetPair)?;

        // Frequency check.
        if history.last_updated > 0
            && !OracleManager::is_update_due(now, history.last_updated, config.update_interval)
        {
            return Err(VirtualEconomyError::OracleUpdateTooFrequent);
        }

        // Variance check against last accepted price.
        if !OracleManager::is_within_variance(price, history.last_price, config.max_variance_bps) {
            let variance = OracleManager::price_variance_bps(price, history.last_price);

            // Record the raw primary price even though we reject it.
            env.storage().persistent().set(
                &DataKey::OracleLastPrimaryPrice(asset_pair.clone()),
                &(price, now),
            );

            let mut analytics = Self::get_oracle_analytics(env.clone());
            analytics.variance_rejections += 1;
            env.storage()
                .instance()
                .set(&DataKey::OracleAnalytics, &analytics);

            events::emit_oracle_price_rejected(
                &env,
                &asset_pair,
                price,
                history.last_price,
                variance,
            );
            return Err(VirtualEconomyError::OraclePriceVarianceTooHigh);
        }

        // Accept the price.
        env.storage().persistent().set(
            &DataKey::OracleLastPrimaryPrice(asset_pair.clone()),
            &(price, now),
        );
        OracleManager::append_history(
            &mut history,
            price,
            now,
            primary.clone(),
            false,
            config.history_size,
        );
        env.storage()
            .persistent()
            .set(&DataKey::OraclePriceHistory(asset_pair.clone()), &history);

        let mut analytics = Self::get_oracle_analytics(env.clone());
        analytics.primary_updates += 1;
        env.storage()
            .instance()
            .set(&DataKey::OracleAnalytics, &analytics);

        events::emit_oracle_price_updated(&env, &asset_pair, price, now, false);
        Ok(())
    }

    /// Push a new price for an asset pair from the fallback oracle.
    ///
    /// The caller must be the registered fallback oracle address. The fallback
    /// price is stored separately and used automatically by
    /// [`Self::resolve_oracle_price`] when the primary is stale or diverges.
    pub fn submit_fallback_price(
        env: Env,
        asset_pair: BytesN<32>,
        price: i128,
    ) -> Result<(), VirtualEconomyError> {
        let fallback: Address = env
            .storage()
            .instance()
            .get(&DataKey::FallbackOracle)
            .ok_or(VirtualEconomyError::OracleNotConfigured)?;
        fallback.require_auth();

        if price <= 0 {
            return Err(VirtualEconomyError::OracleInvalidPrice);
        }

        // Pair must be registered.
        if !env
            .storage()
            .persistent()
            .has(&DataKey::OraclePriceHistory(asset_pair.clone()))
        {
            return Err(VirtualEconomyError::InvalidAssetPair);
        }

        let now = env.ledger().timestamp();
        env.storage().persistent().set(
            &DataKey::OracleLastFallbackPrice(asset_pair.clone()),
            &(price, now),
        );

        events::emit_oracle_price_updated(&env, &asset_pair, price, now, true);
        Ok(())
    }

    /// Resolve the best available price for an asset pair.
    ///
    /// 1. Loads the last primary and fallback raw prices.
    /// 2. Delegates to [`OracleManager::resolve_price`] which applies
    ///    freshness and variance checks.
    /// 3. If the fallback price is selected it is written into the history
    ///    ring-buffer and the analytics counter incremented.
    /// 4. Returns the resolved price.
    pub fn resolve_oracle_price(
        env: Env,
        asset_pair: BytesN<32>,
    ) -> Result<i128, VirtualEconomyError> {
        let config = Self::get_pair_config(&env, &asset_pair)?;
        let now = env.ledger().timestamp();

        let mut history: PriceHistory = env
            .storage()
            .persistent()
            .get(&DataKey::OraclePriceHistory(asset_pair.clone()))
            .ok_or(VirtualEconomyError::InvalidAssetPair)?;

        let (primary_price, primary_ts): (i128, u64) = env
            .storage()
            .persistent()
            .get(&DataKey::OracleLastPrimaryPrice(asset_pair.clone()))
            .unwrap_or((0, 0));

        let fallback_data: Option<(i128, u64)> = env
            .storage()
            .persistent()
            .get(&DataKey::OracleLastFallbackPrice(asset_pair.clone()));

        let (fallback_price, fallback_ts) = match fallback_data {
            Some((p, t)) => (Some(p), Some(t)),
            None => (None, None),
        };

        match OracleManager::resolve_price(
            primary_price,
            primary_ts,
            fallback_price,
            fallback_ts,
            history.last_price,
            &config,
            now,
        ) {
            Ok((price, used_fallback)) => {
                if used_fallback {
                    // Commit the fallback price to history.
                    let fallback: Address = env
                        .storage()
                        .instance()
                        .get(&DataKey::FallbackOracle)
                        .ok_or(VirtualEconomyError::OracleNotConfigured)?;
                    OracleManager::append_history(
                        &mut history,
                        price,
                        now,
                        fallback,
                        true,
                        config.history_size,
                    );
                    env.storage()
                        .persistent()
                        .set(&DataKey::OraclePriceHistory(asset_pair.clone()), &history);

                    let mut analytics = Self::get_oracle_analytics(env.clone());
                    analytics.fallback_updates += 1;
                    env.storage()
                        .instance()
                        .set(&DataKey::OracleAnalytics, &analytics);
                }
                Ok(price)
            }
            Err(e) => {
                let mut analytics = Self::get_oracle_analytics(env.clone());
                analytics.stale_rejections += 1;
                env.storage()
                    .instance()
                    .set(&DataKey::OracleAnalytics, &analytics);
                Err(e)
            }
        }
    }

    /// Return the full price history for an asset pair.
    pub fn get_price_history(
        env: Env,
        asset_pair: BytesN<32>,
    ) -> Result<PriceHistory, VirtualEconomyError> {
        env.storage()
            .persistent()
            .get(&DataKey::OraclePriceHistory(asset_pair))
            .ok_or(VirtualEconomyError::InvalidAssetPair)
    }

    /// Return the time-weighted average price (TWAP) for an asset pair.
    pub fn get_twap(env: Env, asset_pair: BytesN<32>) -> Result<i128, VirtualEconomyError> {
        let config = Self::get_pair_config(&env, &asset_pair)?;
        let history: PriceHistory = env
            .storage()
            .persistent()
            .get(&DataKey::OraclePriceHistory(asset_pair))
            .ok_or(VirtualEconomyError::InvalidAssetPair)?;
        Ok(OracleManager::calculate_twap(
            &history,
            config.update_interval,
        ))
    }

    /// Return the `(min, max)` price range seen in the stored history for a
    /// given asset pair.
    pub fn get_price_range(
        env: Env,
        asset_pair: BytesN<32>,
    ) -> Result<(i128, i128), VirtualEconomyError> {
        let history: PriceHistory = env
            .storage()
            .persistent()
            .get(&DataKey::OraclePriceHistory(asset_pair))
            .ok_or(VirtualEconomyError::InvalidAssetPair)?;
        Ok(OracleManager::price_range(&history))
    }

    /// Return aggregated oracle analytics (primary/fallback update counts,
    /// rejection counts, registered pair count).
    pub fn get_oracle_analytics(env: Env) -> OracleAnalytics {
        env.storage()
            .instance()
            .get(&DataKey::OracleAnalytics)
            .unwrap_or(OracleAnalytics {
                primary_updates: 0,
                fallback_updates: 0,
                variance_rejections: 0,
                stale_rejections: 0,
                registered_pairs: 0,
            })
    }

    /// Update the per-pair oracle configuration (admin only).
    ///
    /// Allows changing the update frequency and variance threshold for a
    /// single asset pair without touching global settings.
    pub fn update_pair_oracle_config(
        env: Env,
        asset_pair: BytesN<32>,
        new_config: OracleConfig,
    ) -> Result<(), VirtualEconomyError> {
        Self::require_admin(&env)?;
        OracleManager::validate_config(&new_config)?;

        if !env
            .storage()
            .persistent()
            .has(&DataKey::OraclePriceHistory(asset_pair.clone()))
        {
            return Err(VirtualEconomyError::InvalidAssetPair);
        }

        env.storage()
            .persistent()
            .set(&DataKey::OraclePairConfig(asset_pair), &new_config);
        Ok(())
    }

    // -------------------------------------------------------------------------
    // Fair Launch
    // -------------------------------------------------------------------------

    /// Configure (or reconfigure) the fair-launch sale. Admin-only.
    ///
    /// Phases are implicit: before `whitelist_start` = NotStarted (0),
    /// `[whitelist_start, whitelist_end)` = Whitelist (1),
    /// `[public_start, public_end)` = Public (2), after `public_end` = Ended (3).
    pub fn configure_fair_launch(
        env: Env,
        config: FairLaunchConfig,
    ) -> Result<(), VirtualEconomyError> {
        Self::require_admin(&env)?;
        if config.base_price <= 0 {
            return Err(VirtualEconomyError::InvalidConfig);
        }
        if config.whitelist_end <= config.whitelist_start
            || config.public_start < config.whitelist_end
            || config.public_end <= config.public_start
        {
            return Err(VirtualEconomyError::InvalidConfig);
        }
        if config.total_supply_cap <= 0 {
            return Err(VirtualEconomyError::InvalidConfig);
        }

        env.storage()
            .instance()
            .set(&DataKey::FairLaunchConfig, &config);

        // Reset analytics for a fresh launch
        let analytics = FairLaunchAnalytics {
            total_sold: 0,
            whitelist_sold: 0,
            public_sold: 0,
            unique_buyers: 0,
            current_price: config.base_price,
        };
        env.storage()
            .instance()
            .set(&DataKey::FairLaunchAnalytics, &analytics);
        env.storage()
            .instance()
            .set(&DataKey::FairLaunchPhase, &0u32);

        events::emit_fair_launch_configured(
            &env,
            config.whitelist_start,
            config.public_start,
            config.total_supply_cap,
            config.base_price,
        );
        Ok(())
    }

    /// Add an address to the fair-launch whitelist. Admin-only.
    pub fn add_to_whitelist(env: Env, address: Address) -> Result<(), VirtualEconomyError> {
        Self::require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::Whitelist(address.clone()), &true);
        events::emit_whitelist_added(&env, &address);
        Ok(())
    }

    /// Purchase tokens in the current fair-launch phase.
    ///
    /// - During Whitelist phase only whitelisted addresses may buy, up to
    ///   `max_whitelist_per_wallet`.
    /// - During Public phase anyone may buy, up to `max_public_per_wallet`.
    /// - Anti-whale cap: no wallet may hold more than `anti_whale_bps`/10_000
    ///   of `total_supply_cap`.
    /// - Currency is minted directly to the buyer (internal accounting only).
    pub fn purchase_fair_launch(
        env: Env,
        buyer: Address,
        amount: i128,
    ) -> Result<(), VirtualEconomyError> {
        buyer.require_auth();

        if amount <= 0 {
            return Err(VirtualEconomyError::InvalidAmount);
        }

        let config: FairLaunchConfig = env
            .storage()
            .instance()
            .get(&DataKey::FairLaunchConfig)
            .ok_or(VirtualEconomyError::InvalidConfig)?;

        let now = env.ledger().timestamp();
        let phase = if now < config.whitelist_start {
            0u32
        } else if now < config.whitelist_end {
            1u32
        } else if now < config.public_end {
            2u32
        } else {
            3u32
        };

        if phase == 0 || phase == 3 {
            return Err(VirtualEconomyError::InvalidConfig);
        }

        // Whitelist check
        if phase == 1 {
            let is_whitelisted: bool = env
                .storage()
                .instance()
                .get(&DataKey::Whitelist(buyer.clone()))
                .unwrap_or(false);
            if !is_whitelisted {
                return Err(VirtualEconomyError::Unauthorized);
            }
        }

        // Per-wallet cap
        let already_purchased: i128 = env
            .storage()
            .instance()
            .get(&DataKey::FairLaunchPurchased(buyer.clone()))
            .unwrap_or(0i128);
        let per_wallet_cap = if phase == 1 {
            config.max_whitelist_per_wallet
        } else {
            config.max_public_per_wallet
        };
        if already_purchased + amount > per_wallet_cap {
            return Err(VirtualEconomyError::InvalidAmount);
        }

        // Anti-whale cap
        if config.anti_whale_bps > 0 {
            let max_per_whale = config.total_supply_cap * config.anti_whale_bps as i128 / 10_000;
            let total_after = already_purchased + amount;
            if total_after > max_per_whale {
                return Err(VirtualEconomyError::InvalidAmount);
            }
        }

        // Total supply cap check
        let mut analytics: FairLaunchAnalytics = env
            .storage()
            .instance()
            .get(&DataKey::FairLaunchAnalytics)
            .unwrap_or(FairLaunchAnalytics {
                total_sold: 0,
                whitelist_sold: 0,
                public_sold: 0,
                unique_buyers: 0,
                current_price: config.base_price,
            });
        if analytics.total_sold + amount > config.total_supply_cap {
            return Err(VirtualEconomyError::SupplyLimitExceeded);
        }

        // Mint currency to buyer
        let current_balance = Self::get_currency_balance(env.clone(), buyer.clone());
        env.storage().persistent().set(
            &DataKey::CurrencyBalance(buyer.clone()),
            &(current_balance + amount),
        );
        let supply = Self::get_total_currency_supply(env.clone());
        env.storage()
            .persistent()
            .set(&DataKey::TotalCurrencySupply, &(supply + amount));

        // Update per-wallet record
        let is_new_buyer = already_purchased == 0;
        env.storage().instance().set(
            &DataKey::FairLaunchPurchased(buyer.clone()),
            &(already_purchased + amount),
        );

        // Update analytics
        analytics.total_sold += amount;
        if phase == 1 {
            analytics.whitelist_sold += amount;
        } else {
            analytics.public_sold += amount;
        }
        if is_new_buyer {
            analytics.unique_buyers += 1;
        }
        env.storage()
            .instance()
            .set(&DataKey::FairLaunchAnalytics, &analytics);
        env.storage()
            .instance()
            .set(&DataKey::FairLaunchPhase, &phase);

        events::emit_fair_launch_purchase(&env, &buyer, amount, phase, config.base_price);
        Ok(())
    }

    /// Return the current fair-launch config, or `None` if not yet configured.
    pub fn get_fair_launch_config(env: Env) -> Option<FairLaunchConfig> {
        env.storage().instance().get(&DataKey::FairLaunchConfig)
    }

    /// Return aggregate fair-launch analytics.
    pub fn get_fair_launch_analytics(env: Env) -> FairLaunchAnalytics {
        env.storage()
            .instance()
            .get(&DataKey::FairLaunchAnalytics)
            .unwrap_or(FairLaunchAnalytics {
                total_sold: 0,
                whitelist_sold: 0,
                public_sold: 0,
                unique_buyers: 0,
                current_price: 0,
            })
    }

    // -------------------------------------------------------------------------
    // NFT Staking
    // -------------------------------------------------------------------------

    /// Configure (or reconfigure) the NFT staking module. Admin-only.
    pub fn configure_nft_staking(
        env: Env,
        config: NftStakeConfig,
    ) -> Result<(), VirtualEconomyError> {
        Self::require_admin(&env)?;
        if config.reward_interval == 0 {
            return Err(VirtualEconomyError::InvalidConfig);
        }
        env.storage()
            .instance()
            .set(&DataKey::NftStakeConfig, &config);
        events::emit_nft_staking_configured(
            &env,
            config.reward_rate_bps,
            config.reward_interval,
            config.min_lock_period,
        );
        Ok(())
    }

    /// Stake an NFT owned by `owner`. The NFT is locked in the contract's
    /// virtual accounting (ownership unchanged on-chain) until unstaked.
    pub fn stake_nft(
        env: Env,
        owner: Address,
        token_id: BytesN<32>,
    ) -> Result<(), VirtualEconomyError> {
        owner.require_auth();

        let config: NftStakeConfig = env
            .storage()
            .instance()
            .get(&DataKey::NftStakeConfig)
            .ok_or(VirtualEconomyError::NftStakingNotConfigured)?;

        if config.paused {
            return Err(VirtualEconomyError::NftStakingPaused);
        }

        // Verify NFT exists and belongs to owner
        let nft_owner: Address = env
            .storage()
            .persistent()
            .get(&DataKey::NFTOwner(token_id.clone()))
            .ok_or(VirtualEconomyError::TokenNotFound)?;
        if nft_owner != owner {
            return Err(VirtualEconomyError::NotOwner);
        }

        // Ensure not already staked
        if env
            .storage()
            .persistent()
            .has(&DataKey::NftStakedPosition(token_id.clone()))
        {
            return Err(VirtualEconomyError::NftAlreadyStaked);
        }

        let now = env.ledger().timestamp();
        let position = NftStakedPosition {
            token_id: token_id.clone(),
            owner: owner.clone(),
            staked_at: now,
            pending_rewards: 0,
            last_reward_ts: now,
        };
        env.storage()
            .persistent()
            .set(&DataKey::NftStakedPosition(token_id.clone()), &position);

        // Track owner's staked list
        let mut staked_list: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::NftStakedByOwner(owner.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        staked_list.push_back(token_id.clone());
        env.storage()
            .persistent()
            .set(&DataKey::NftStakedByOwner(owner.clone()), &staked_list);

        // Update analytics
        NftStakingManager::increment_staked(&env);

        events::emit_nft_staked(&env, &token_id, &owner, now);
        Ok(())
    }

    /// Unstake an NFT and claim any accrued rewards.
    pub fn unstake_nft(
        env: Env,
        owner: Address,
        token_id: BytesN<32>,
    ) -> Result<i128, VirtualEconomyError> {
        owner.require_auth();

        let config: NftStakeConfig = env
            .storage()
            .instance()
            .get(&DataKey::NftStakeConfig)
            .ok_or(VirtualEconomyError::NftStakingNotConfigured)?;

        if config.paused {
            return Err(VirtualEconomyError::NftStakingPaused);
        }

        let mut position: NftStakedPosition = env
            .storage()
            .persistent()
            .get(&DataKey::NftStakedPosition(token_id.clone()))
            .ok_or(VirtualEconomyError::NftNotStaked)?;

        if position.owner != owner {
            return Err(VirtualEconomyError::Unauthorized);
        }

        // Check lock period
        let now = env.ledger().timestamp();
        if config.min_lock_period > 0 && now < position.staked_at + config.min_lock_period {
            return Err(VirtualEconomyError::NftLockPeriodNotMet);
        }

        // Calculate and pay out rewards
        let nft_metadata: NFTMetadata = env
            .storage()
            .persistent()
            .get(&DataKey::NFTMetadata(token_id.clone()))
            .ok_or(VirtualEconomyError::TokenNotFound)?;
        let accrued = NftStakingManager::calc_rewards(&position, &config, nft_metadata.rarity, now);
        let total_rewards = position.pending_rewards + accrued;

        if total_rewards > 0 {
            let current_balance = Self::get_currency_balance(env.clone(), owner.clone());
            env.storage().persistent().set(
                &DataKey::CurrencyBalance(owner.clone()),
                &(current_balance + total_rewards),
            );
            let supply = Self::get_total_currency_supply(env.clone());
            env.storage()
                .persistent()
                .set(&DataKey::TotalCurrencySupply, &(supply + total_rewards));
        }

        // Remove staked position
        env.storage()
            .persistent()
            .remove(&DataKey::NftStakedPosition(token_id.clone()));

        // Remove from owner's staked list
        let staked_list: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::NftStakedByOwner(owner.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        let mut new_list: Vec<BytesN<32>> = Vec::new(&env);
        for id in staked_list.iter() {
            if id != token_id {
                new_list.push_back(id);
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::NftStakedByOwner(owner.clone()), &new_list);

        NftStakingManager::decrement_staked(&env, total_rewards);

        events::emit_nft_unstaked(&env, &token_id, &owner, total_rewards);
        Ok(total_rewards)
    }

    /// Claim accrued rewards for a staked NFT without unstaking it.
    pub fn claim_nft_staking_rewards(
        env: Env,
        owner: Address,
        token_id: BytesN<32>,
    ) -> Result<i128, VirtualEconomyError> {
        owner.require_auth();

        let config: NftStakeConfig = env
            .storage()
            .instance()
            .get(&DataKey::NftStakeConfig)
            .ok_or(VirtualEconomyError::NftStakingNotConfigured)?;

        let mut position: NftStakedPosition = env
            .storage()
            .persistent()
            .get(&DataKey::NftStakedPosition(token_id.clone()))
            .ok_or(VirtualEconomyError::NftNotStaked)?;

        if position.owner != owner {
            return Err(VirtualEconomyError::Unauthorized);
        }

        let now = env.ledger().timestamp();
        let nft_metadata: NFTMetadata = env
            .storage()
            .persistent()
            .get(&DataKey::NFTMetadata(token_id.clone()))
            .ok_or(VirtualEconomyError::TokenNotFound)?;
        let accrued = NftStakingManager::calc_rewards(&position, &config, nft_metadata.rarity, now);
        let total_rewards = position.pending_rewards + accrued;

        if total_rewards <= 0 {
            return Ok(0);
        }

        // Mint rewards
        let current_balance = Self::get_currency_balance(env.clone(), owner.clone());
        env.storage().persistent().set(
            &DataKey::CurrencyBalance(owner.clone()),
            &(current_balance + total_rewards),
        );
        let supply = Self::get_total_currency_supply(env.clone());
        env.storage()
            .persistent()
            .set(&DataKey::TotalCurrencySupply, &(supply + total_rewards));

        // Reset pending rewards
        position.pending_rewards = 0;
        position.last_reward_ts = now;
        env.storage()
            .persistent()
            .set(&DataKey::NftStakedPosition(token_id.clone()), &position);

        NftStakingManager::record_rewards_distributed(&env, total_rewards);

        events::emit_nft_staking_rewards_claimed(&env, &token_id, &owner, total_rewards);
        Ok(total_rewards)
    }

    /// Return the staked position for a given token, or `None` if not staked.
    pub fn get_nft_staked_position(env: Env, token_id: BytesN<32>) -> Option<NftStakedPosition> {
        env.storage()
            .persistent()
            .get(&DataKey::NftStakedPosition(token_id))
    }

    /// Return all token IDs staked by `owner`.
    pub fn get_nfts_staked_by_owner(env: Env, owner: Address) -> Vec<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::NftStakedByOwner(owner))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Return aggregate NFT staking analytics.
    pub fn get_nft_staking_analytics(env: Env) -> NftStakingAnalytics {
        env.storage()
            .instance()
            .get(&DataKey::NftStakingAnalytics)
            .unwrap_or(NftStakingAnalytics {
                total_staked: 0,
                total_rewards_distributed: 0,
                unique_stakers: 0,
            })
    }

    // -------------------------------------------------------------------------
    // Internal Helper Functions
    // -------------------------------------------------------------------------

    fn require_admin(env: &Env) -> Result<(), VirtualEconomyError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(VirtualEconomyError::NotInitialized)?;
        admin.require_auth();
        Ok(())
    }

    /// Reject pool operations while the contract is emergency-paused.
    ///
    /// Withdrawals are gated too. That is deliberate: a pause exists because
    /// something is wrong with the contract's accounting, and letting LPs race
    /// each other out of a pool whose reserves may be wrong turns a bug into a
    /// bank run.
    fn require_amm_not_paused(env: &Env) -> Result<(), VirtualEconomyError> {
        if env
            .storage()
            .instance()
            .get(&DataKey::EmergencyPaused)
            .unwrap_or(false)
        {
            return Err(VirtualEconomyError::EmergencyPaused);
        }
        Ok(())
    }

    fn require_authorized_minter(env: &Env) -> Result<(), VirtualEconomyError> {
        // Check if emergency paused
        if env
            .storage()
            .instance()
            .get(&DataKey::EmergencyPaused)
            .unwrap_or(false)
        {
            return Err(VirtualEconomyError::EmergencyPaused);
        }

        // For now, require admin auth - in production, check authorized minters
        Self::require_admin(env)
    }

    fn get_currency_config(env: &Env) -> CurrencyConfig {
        env.storage()
            .instance()
            .get(&DataKey::CurrencyConfig)
            .unwrap_or(CurrencyConfig {
                max_supply: 1_000_000_000_000, // 1 trillion
                inflation_rate: 500,           // 5% in basis points
                deflation_rate: 200,           // 2% in basis points
            })
    }

    fn referral_account(env: &Env, account: Address) -> Option<ReferralAccount> {
        env.storage()
            .persistent()
            .get(&DataKey::ReferralAccount(account))
    }

    fn get_marketplace_config(env: &Env) -> MarketplaceConfig {
        env.storage()
            .instance()
            .get(&DataKey::MarketplaceConfig)
            .unwrap_or(MarketplaceConfig {
                fee_percentage: 250, // 2.5% in basis points
                fee_collector: env.storage().instance().get(&DataKey::Admin).unwrap(),
                min_price: 1,
                max_price: 1_000_000_000,
            })
    }

    // -------------------------------------------------------------------------
    // Royalty & Licensing Functions
    // -------------------------------------------------------------------------

    pub fn set_nft_license(
        env: Env,
        token_id: BytesN<32>,
        caller: Address,
        license: LicenseConfig,
    ) -> Result<(), VirtualEconomyError> {
        caller.require_auth();

        let metadata: NFTMetadata = env
            .storage()
            .persistent()
            .get(&DataKey::NFTMetadata(token_id.clone()))
            .ok_or(VirtualEconomyError::TokenNotFound)?;

        if metadata.creator != caller {
            return Err(VirtualEconomyError::Unauthorized);
        }

        if license.license_type > 3 {
            return Err(VirtualEconomyError::InvalidLicenseType);
        }

        env.storage()
            .persistent()
            .set(&DataKey::NFTLicense(token_id), &license);

        Ok(())
    }

    pub fn get_nft_license(
        env: Env,
        token_id: BytesN<32>,
    ) -> Result<LicenseConfig, VirtualEconomyError> {
        env.storage()
            .persistent()
            .get(&DataKey::NFTLicense(token_id))
            .ok_or(VirtualEconomyError::TokenNotFound)
    }

    pub fn update_royalty_bps(
        env: Env,
        token_id: BytesN<32>,
        caller: Address,
        new_bps: u32,
    ) -> Result<(), VirtualEconomyError> {
        caller.require_auth();

        let mut metadata: NFTMetadata = env
            .storage()
            .persistent()
            .get(&DataKey::NFTMetadata(token_id.clone()))
            .ok_or(VirtualEconomyError::TokenNotFound)?;

        if metadata.creator != caller {
            return Err(VirtualEconomyError::Unauthorized);
        }

        if new_bps > 2000 {
            return Err(VirtualEconomyError::RoyaltyTooHigh);
        }

        metadata.royalty_bps = new_bps;
        env.storage()
            .persistent()
            .set(&DataKey::NFTMetadata(token_id), &metadata);

        Ok(())
    }

    pub fn set_royalty_exempt(
        env: Env,
        address: Address,
        exempt: bool,
    ) -> Result<(), VirtualEconomyError> {
        Self::require_admin(&env)?;

        if exempt {
            env.storage()
                .persistent()
                .set(&DataKey::RoyaltyExempt(address.clone()), &true);

            let mut stats: RoyaltyAnalytics = env
                .storage()
                .persistent()
                .get(&DataKey::RoyaltyAnalytics)
                .unwrap_or(RoyaltyAnalytics {
                    total_royalties_paid: 0,
                    total_royalty_transactions: 0,
                    total_exemptions_applied: 0,
                });

            stats.total_exemptions_applied += 1;

            env.storage()
                .persistent()
                .set(&DataKey::RoyaltyAnalytics, &stats);
        } else {
            env.storage()
                .persistent()
                .remove(&DataKey::RoyaltyExempt(address));
        }

        Ok(())
    }

    pub fn get_royalty_analytics(env: Env) -> RoyaltyAnalytics {
        env.storage()
            .persistent()
            .get(&DataKey::RoyaltyAnalytics)
            .unwrap_or(RoyaltyAnalytics {
                total_royalties_paid: 0,
                total_royalty_transactions: 0,
                total_exemptions_applied: 0,
            })
    }

    pub fn get_nft_creator(env: Env, token_id: BytesN<32>) -> Result<Address, VirtualEconomyError> {
        let metadata: NFTMetadata = env
            .storage()
            .persistent()
            .get(&DataKey::NFTMetadata(token_id))
            .ok_or(VirtualEconomyError::TokenNotFound)?;

        Ok(metadata.creator)
    }

    // -------------------------------------------------------------------------
    // Private Oracle Helpers
    // -------------------------------------------------------------------------

    fn get_oracle_config(env: &Env) -> Result<OracleConfig, VirtualEconomyError> {
        env.storage()
            .instance()
            .get(&DataKey::OracleConfig)
            .ok_or(VirtualEconomyError::OracleNotConfigured)
    }

    /// Return the per-pair config if one exists, otherwise fall back to the
    /// global config.
    fn get_pair_config(
        env: &Env,
        asset_pair: &BytesN<32>,
    ) -> Result<OracleConfig, VirtualEconomyError> {
        if let Some(pair_cfg) = env
            .storage()
            .persistent()
            .get::<_, OracleConfig>(&DataKey::OraclePairConfig(asset_pair.clone()))
        {
            return Ok(pair_cfg);
        }
        Self::get_oracle_config(env)
    }

    // -------------------------------------------------------------------------
    // Liquidity Pool / AMM (Issue #882)
    // -------------------------------------------------------------------------

    /// Create the AX liquidity pool. Admin only, and only once.
    ///
    /// Reserves start empty; the first `add_liquidity` sets the initial price.
    ///
    /// # Errors
    /// - `Unauthorized` if the caller is not the admin.
    /// - `PoolAlreadyExists` if a pool has already been created.
    pub fn create_liquidity_pool(
        env: Env,
        fee_bps: i128,
    ) -> Result<LiquidityPool, VirtualEconomyError> {
        // require_admin reads the stored admin and calls require_auth itself.
        Self::require_admin(&env)?;
        AmmManager::create_pool(&env, fee_bps)
    }

    /// Deposit both assets and receive LP tokens.
    ///
    /// `min_shares` is the caller's slippage floor: the pool ratio can move
    /// between quoting and execution, and a deposit at an unexpected ratio
    /// mints fewer shares than intended.
    ///
    /// # Errors
    /// - `InvalidAmount` for non-positive amounts.
    /// - `InsufficientLiquidity` if the first deposit is too small to cover the
    ///   permanently locked minimum.
    /// - `SlippageExceeded` if fewer than `min_shares` would be minted.
    pub fn add_liquidity(
        env: Env,
        provider: Address,
        amount_a: i128,
        amount_b: i128,
        min_shares: i128,
    ) -> Result<DepositResult, VirtualEconomyError> {
        provider.require_auth();
        Self::require_amm_not_paused(&env)?;
        AmmManager::add_liquidity(&env, &provider, amount_a, amount_b, min_shares)
    }

    /// Burn LP tokens and withdraw the proportional reserves.
    ///
    /// # Errors
    /// - `InsufficientBalance` if the provider holds fewer shares than requested.
    /// - `SlippageExceeded` if either amount would fall below its floor.
    pub fn remove_liquidity(
        env: Env,
        provider: Address,
        shares: i128,
        min_a: i128,
        min_b: i128,
    ) -> Result<WithdrawResult, VirtualEconomyError> {
        provider.require_auth();
        Self::require_amm_not_paused(&env)?;
        AmmManager::remove_liquidity(&env, &provider, shares, min_a, min_b)
    }

    /// Swap one asset for the other along the constant-product curve.
    ///
    /// `min_amount_out` must be positive. A zero floor is rejected rather than
    /// read as "no preference": an unprotected swap is sandwich bait, and the
    /// quote a caller saw off-chain is not the price they will get.
    ///
    /// # Errors
    /// - `InvalidAmount` for a non-positive input or a zero slippage floor.
    /// - `SlippageExceeded` if the output would be below `min_amount_out`.
    /// - `InsufficientLiquidity` if the pool cannot support the trade.
    pub fn swap(
        env: Env,
        trader: Address,
        a_to_b: bool,
        amount_in: i128,
        min_amount_out: i128,
    ) -> Result<SwapResult, VirtualEconomyError> {
        trader.require_auth();
        Self::require_amm_not_paused(&env)?;
        AmmManager::swap(&env, a_to_b, amount_in, min_amount_out)
    }

    /// Quote a swap without executing it. Read-only.
    ///
    /// The quote is only valid for the current reserves — anything can execute
    /// before this caller's transaction does, which is what `min_amount_out`
    /// on `swap` is for.
    pub fn quote_swap(
        env: Env,
        a_to_b: bool,
        amount_in: i128,
    ) -> Result<i128, VirtualEconomyError> {
        let pool = AmmManager::get_pool(&env)?;
        let (reserve_in, reserve_out) = if a_to_b {
            (pool.reserve_a, pool.reserve_b)
        } else {
            (pool.reserve_b, pool.reserve_a)
        };
        AmmManager::get_amount_out(amount_in, reserve_in, reserve_out, pool.fee_bps)
    }

    /// Current pool reserves, shares, and accumulators. Read-only.
    pub fn get_liquidity_pool(env: Env) -> Result<LiquidityPool, VirtualEconomyError> {
        AmmManager::get_pool(&env)
    }

    /// LP token balance for a provider. Read-only.
    pub fn get_lp_shares(env: Env, provider: Address) -> i128 {
        AmmManager::get_shares(&env, &provider)
    }

    /// Marginal spot price of A in B, scaled by 1e7. Read-only.
    ///
    /// Manipulable within a single transaction — use [`Self::observe_price`]
    /// and a TWAP for anything that matters.
    pub fn get_spot_price(env: Env) -> Result<i128, VirtualEconomyError> {
        let pool = AmmManager::get_pool(&env)?;
        AmmManager::spot_price(pool.reserve_a, pool.reserve_b)
    }

    /// Take a price observation for TWAP construction.
    ///
    /// Two observations separated in time give a time-weighted average, which
    /// an attacker cannot move without holding the price away from the market
    /// for the whole window.
    pub fn observe_price(env: Env) -> Result<PriceSnapshot, VirtualEconomyError> {
        AmmManager::observe(&env)
    }
}
