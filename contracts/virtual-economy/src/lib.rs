#![no_std]

mod analytics;
mod currency;
mod error;
mod governance;
mod marketplace;
mod nft;
mod rewards;
mod storage;

use arenax_events::virtual_economy as events;
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Map, String, Vec};

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
        let mut from_nfts: Vec<BytesN<32>> = env
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

        events::emit_rewards_distributed(&env, rewards.len() as u32, &reason);
        Ok(())
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
}
