#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, String, Vec};

// ─── Types ───────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum AssetKind {
    Nft = 0,
    Currency = 1,
    Achievement = 2,
    Cosmetic = 3,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum AssetRarity {
    Common = 0,
    Uncommon = 1,
    Rare = 2,
    Epic = 3,
    Legendary = 4,
}

/// Metadata stored per asset type (registered by game developers / admin)
#[contracttype]
#[derive(Clone, Debug)]
pub struct AssetDefinition {
    pub asset_id: BytesN<32>,
    pub kind: u32,
    pub rarity: u32,
    pub name: String,
    /// Bitmask of game IDs that accept this asset (up to 64 games)
    pub compatible_games: u64,
    pub max_supply: i128, // 0 = unlimited
    pub current_supply: i128,
    pub is_transferable: bool,
    pub is_tradeable: bool,
    pub created_at: u64,
}

/// Per-user balance of a specific asset
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetBalance {
    pub owner: Address,
    pub asset_id: BytesN<32>,
    pub amount: i128,
    /// For NFTs: unique token serial within the asset type
    pub nft_serial: Option<u64>,
    pub acquired_at: u64,
    /// Which game originally granted this asset
    pub source_game_id: u32,
}

/// Cross-game transfer record (audit trail)
#[contracttype]
#[derive(Clone, Debug)]
pub struct AssetTransfer {
    pub from: Address,
    pub to: Address,
    pub asset_id: BytesN<32>,
    pub amount: i128,
    pub from_game_id: u32,
    pub to_game_id: u32,
    pub transferred_at: u64,
}

/// Cross-chain bridge request
#[contracttype]
#[derive(Clone, Debug)]
pub struct BridgeRequest {
    pub request_id: BytesN<32>,
    pub owner: Address,
    pub asset_id: BytesN<32>,
    pub amount: i128,
    pub source_chain: String,
    pub target_chain: String,
    pub source_game_id: u32,
    pub target_game_id: u32,
    pub status: u32,
    pub created_at: u64,
    pub completed_at: Option<u64>,
    pub nonce: u64,
}

/// Bridge status constants
pub const BRIDGE_STATUS_PENDING: u32 = 0;
pub const BRIDGE_STATUS_CONFIRMED: u32 = 1;
pub const BRIDGE_STATUS_COMPLETED: u32 = 2;
pub const BRIDGE_STATUS_FAILED: u32 = 3;
pub const BRIDGE_STATUS_CANCELLED: u32 = 4;

/// Supported external chains
#[contracttype]
#[derive(Clone, Debug)]
pub struct ChainConfig {
    pub chain_id: String,
    pub chain_name: String,
    pub bridge_contract: Address,
    pub is_active: bool,
    pub max_bridge_amount: i128,
    pub bridge_fee_bps: u32, // basis points (1/100 of 1%)
    pub cooldown_secs: u64,
}

// ─── Storage Keys ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    AssetDef(BytesN<32>),
    Balance(Address, BytesN<32>),
    Inventory(Address),
    Metadata(BytesN<32>, u32),
    /// Authorised game contracts that can mint/grant assets
    AuthorisedGame(u32),
    Paused,
    NftSerial(BytesN<32>),
    /// Bridge-related keys
    BridgeRequest(BytesN<32>),
    BridgeNonce,
    ChainConfig(String),
    BridgeLock(Address, BytesN<32>),
    BridgeCooldown(Address, String),
    SupportedChains,
}

// ─── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct CrossGameAssets;

#[contractimpl]
impl CrossGameAssets {
    // ── Init ─────────────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    pub fn register_game(env: Env, game_id: u32, game_contract: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::AuthorisedGame(game_id), &game_contract);
    }

    pub fn revoke_game(env: Env, game_id: u32) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .remove(&DataKey::AuthorisedGame(game_id));
    }

    /// Register a new cross-game asset type.
    pub fn register_asset(
        env: Env,
        asset_id: BytesN<32>,
        kind: u32,
        rarity: u32,
        name: String,
        compatible_games: u64,
        max_supply: i128,
        is_transferable: bool,
        is_tradeable: bool,
    ) {
        Self::require_admin(&env);
        if env
            .storage()
            .persistent()
            .has(&DataKey::AssetDef(asset_id.clone()))
        {
            panic!("asset already registered");
        }
        let def = AssetDefinition {
            asset_id: asset_id.clone(),
            kind,
            rarity,
            name,
            compatible_games,
            max_supply,
            current_supply: 0,
            is_transferable,
            is_tradeable,
            created_at: env.ledger().timestamp(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::AssetDef(asset_id.clone()), &def);
        env.events().publish(
            (soroban_sdk::symbol_short!("ASSET_REG"), asset_id),
            (kind, rarity, compatible_games),
        );
    }

    /// Issue API: register an asset for a source game with compact metadata.
    pub fn register_cross_game_asset(
        env: Env,
        game_id: u32,
        asset_type: u32,
        metadata: String,
    ) -> BytesN<32> {
        Self::require_admin(&env);
        let asset_id = Self::asset_id_from_game(&env, game_id, asset_type);
        if env
            .storage()
            .persistent()
            .has(&DataKey::AssetDef(asset_id.clone()))
        {
            panic!("asset already registered");
        }

        let compatible_games = if game_id < 64 {
            1u64 << game_id
        } else {
            u64::MAX
        };
        let def = AssetDefinition {
            asset_id: asset_id.clone(),
            kind: asset_type,
            rarity: AssetRarity::Common as u32,
            name: metadata.clone(),
            compatible_games,
            max_supply: 0,
            current_supply: 0,
            is_transferable: true,
            is_tradeable: true,
            created_at: env.ledger().timestamp(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::AssetDef(asset_id.clone()), &def);
        env.storage()
            .persistent()
            .set(&DataKey::Metadata(asset_id.clone(), game_id), &metadata);
        env.events().publish(
            (soroban_sdk::symbol_short!("ASSET_REG"), asset_id.clone()),
            (game_id, asset_type),
        );
        asset_id
    }

    pub fn update_compatible_games(env: Env, asset_id: BytesN<32>, compatible_games: u64) {
        Self::require_admin(&env);
        let mut def: AssetDefinition = env
            .storage()
            .persistent()
            .get(&DataKey::AssetDef(asset_id.clone()))
            .expect("asset not found");
        def.compatible_games = compatible_games;
        env.storage()
            .persistent()
            .set(&DataKey::AssetDef(asset_id), &def);
    }

    pub fn sync_asset_metadata(env: Env, asset_id: BytesN<32>, game_id: u32, metadata: String) {
        Self::require_admin(&env);
        if !Self::validate_asset_compatibility(env.clone(), asset_id.clone(), game_id) {
            panic!("game not compatible");
        }
        env.storage()
            .persistent()
            .set(&DataKey::Metadata(asset_id.clone(), game_id), &metadata);
        env.events()
            .publish((soroban_sdk::symbol_short!("META_SYNC"), asset_id), game_id);
    }

    // ── Minting ───────────────────────────────────────────────────────────────

    /// Mint (grant) an asset to a player. Caller must be an authorised game contract or admin.
    pub fn mint(
        env: Env,
        caller: Address,
        to: Address,
        asset_id: BytesN<32>,
        amount: i128,
        source_game_id: u32,
    ) {
        Self::require_not_paused(&env);
        caller.require_auth();
        Self::require_authorised_caller(&env, &caller, source_game_id);
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let mut def: AssetDefinition = env
            .storage()
            .persistent()
            .get(&DataKey::AssetDef(asset_id.clone()))
            .expect("asset not registered");

        // Check supply cap
        if def.max_supply > 0 && def.current_supply + amount > def.max_supply {
            panic!("max supply exceeded");
        }

        // Check game compatibility
        if source_game_id < 64 && (def.compatible_games & (1u64 << source_game_id)) == 0 {
            panic!("game not compatible with asset");
        }

        def.current_supply += amount;
        env.storage()
            .persistent()
            .set(&DataKey::AssetDef(asset_id.clone()), &def);

        // NFT serial tracking
        let nft_serial = if def.kind == AssetKind::Nft as u32 {
            let serial: u64 = env
                .storage()
                .instance()
                .get(&DataKey::NftSerial(asset_id.clone()))
                .unwrap_or(0);
            let new_serial = serial + 1;
            env.storage()
                .instance()
                .set(&DataKey::NftSerial(asset_id.clone()), &new_serial);
            Some(new_serial)
        } else {
            None
        };

        let bal_key = DataKey::Balance(to.clone(), asset_id.clone());
        let existing: Option<AssetBalance> = env.storage().persistent().get(&bal_key);
        let balance = if let Some(mut b) = existing {
            b.amount += amount;
            b
        } else {
            AssetBalance {
                owner: to.clone(),
                asset_id: asset_id.clone(),
                amount,
                nft_serial,
                acquired_at: env.ledger().timestamp(),
                source_game_id,
            }
        };
        env.storage().persistent().set(&bal_key, &balance);
        Self::add_inventory_asset(&env, &to, &asset_id);

        env.events().publish(
            (soroban_sdk::symbol_short!("MINTED"), asset_id, to),
            (amount, source_game_id),
        );
    }

    // ── Transfers ─────────────────────────────────────────────────────────────

    /// Transfer an asset between players across games.
    pub fn transfer(
        env: Env,
        from: Address,
        to: Address,
        asset_id: BytesN<32>,
        amount: i128,
        from_game_id: u32,
        to_game_id: u32,
    ) {
        Self::require_not_paused(&env);
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        if from == to {
            panic!("cannot transfer to self");
        }

        let def: AssetDefinition = env
            .storage()
            .persistent()
            .get(&DataKey::AssetDef(asset_id.clone()))
            .expect("asset not registered");

        if !def.is_transferable {
            panic!("asset not transferable");
        }

        // Validate destination game compatibility
        if to_game_id < 64 && (def.compatible_games & (1u64 << to_game_id)) == 0 {
            panic!("destination game not compatible");
        }

        let from_key = DataKey::Balance(from.clone(), asset_id.clone());
        let mut from_bal: AssetBalance = env
            .storage()
            .persistent()
            .get(&from_key)
            .expect("insufficient balance");
        if from_bal.amount < amount {
            panic!("insufficient balance");
        }
        from_bal.amount -= amount;
        if from_bal.amount == 0 {
            env.storage().persistent().remove(&from_key);
        } else {
            env.storage().persistent().set(&from_key, &from_bal);
        }

        let to_key = DataKey::Balance(to.clone(), asset_id.clone());
        let to_bal = if let Some(mut b) = env
            .storage()
            .persistent()
            .get::<DataKey, AssetBalance>(&to_key)
        {
            b.amount += amount;
            b
        } else {
            AssetBalance {
                owner: to.clone(),
                asset_id: asset_id.clone(),
                amount,
                nft_serial: None,
                acquired_at: env.ledger().timestamp(),
                source_game_id: from_game_id,
            }
        };
        env.storage().persistent().set(&to_key, &to_bal);
        Self::add_inventory_asset(&env, &to, &asset_id);

        env.events().publish(
            (soroban_sdk::symbol_short!("XFER"), asset_id, from, to),
            (amount, from_game_id, to_game_id),
        );
    }

    /// Move an owner's asset into another compatible game context.
    pub fn transfer_asset_to_game(
        env: Env,
        owner: Address,
        asset_id: BytesN<32>,
        from_game: u32,
        to_game: u32,
    ) {
        Self::require_not_paused(&env);
        owner.require_auth();
        if !Self::validate_asset_compatibility(env.clone(), asset_id.clone(), to_game) {
            panic!("target game not compatible");
        }
        let bal_key = DataKey::Balance(owner.clone(), asset_id.clone());
        let mut bal: AssetBalance = env
            .storage()
            .persistent()
            .get(&bal_key)
            .expect("asset not owned");
        if bal.source_game_id != from_game {
            panic!("source game mismatch");
        }
        bal.source_game_id = to_game;
        env.storage().persistent().set(&bal_key, &bal);
        env.events().publish(
            (soroban_sdk::symbol_short!("GAME_XFER"), asset_id),
            (owner, from_game, to_game),
        );
    }

    /// Burn (consume) an asset — e.g. spending in-game currency.
    pub fn burn(env: Env, owner: Address, asset_id: BytesN<32>, amount: i128) {
        Self::require_not_paused(&env);
        owner.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let bal_key = DataKey::Balance(owner.clone(), asset_id.clone());
        let mut bal: AssetBalance = env
            .storage()
            .persistent()
            .get(&bal_key)
            .expect("no balance");
        if bal.amount < amount {
            panic!("insufficient balance");
        }
        bal.amount -= amount;
        if bal.amount == 0 {
            env.storage().persistent().remove(&bal_key);
        } else {
            env.storage().persistent().set(&bal_key, &bal);
        }

        let mut def: AssetDefinition = env
            .storage()
            .persistent()
            .get(&DataKey::AssetDef(asset_id.clone()))
            .unwrap();
        def.current_supply -= amount;
        env.storage()
            .persistent()
            .set(&DataKey::AssetDef(asset_id.clone()), &def);

        env.events().publish(
            (soroban_sdk::symbol_short!("BURNED"), asset_id, owner),
            amount,
        );
    }

    pub fn burn_cross_game_asset(
        env: Env,
        asset_id: BytesN<32>,
        game_id: u32,
        owner: Address,
        amount: i128,
    ) {
        if !Self::validate_asset_compatibility(env.clone(), asset_id.clone(), game_id) {
            panic!("game not compatible");
        }
        Self::burn(env, owner, asset_id, amount);
    }

    // ── Bridging ───────────────────────────────────────────────────────────

    /// Register a supported external chain for bridging
    pub fn register_chain(
        env: Env,
        chain_id: String,
        chain_name: String,
        bridge_contract: Address,
        max_bridge_amount: i128,
        bridge_fee_bps: u32,
        cooldown_secs: u64,
    ) {
        Self::require_admin(&env);
        let config = ChainConfig {
            chain_id: chain_id.clone(),
            chain_name,
            bridge_contract,
            is_active: true,
            max_bridge_amount,
            bridge_fee_bps,
            cooldown_secs,
        };
        env.storage()
            .persistent()
            .set(&DataKey::ChainConfig(chain_id.clone()), &config);

        // Add to supported chains list
        let mut chains: Vec<String> = env
            .storage()
            .instance()
            .get(&DataKey::SupportedChains)
            .unwrap_or(Vec::new(&env));
        let mut found = false;
        let mut i = 0;
        while i < chains.len() {
            if chains.get(i).unwrap() == chain_id {
                found = true;
                break;
            }
            i += 1;
        }
        if !found {
            chains.push_back(chain_id);
            env.storage()
                .instance()
                .set(&DataKey::SupportedChains, &chains);
        }

        env.events().publish(
            (soroban_sdk::symbol_short!("CHAIN_REG"), chain_id),
            (bridge_contract, max_bridge_amount, bridge_fee_bps),
        );
    }

    /// Deactivate a chain
    pub fn deactivate_chain(env: Env, chain_id: String) {
        Self::require_admin(&env);
        let mut config: ChainConfig = env
            .storage()
            .persistent()
            .get(&DataKey::ChainConfig(chain_id.clone()))
            .expect("chain not found");
        config.is_active = false;
        env.storage()
            .persistent()
            .set(&DataKey::ChainConfig(chain_id), &config);
    }

    /// Initiate a bridge request - locks assets on source chain
    pub fn initiate_bridge(
        env: Env,
        owner: Address,
        asset_id: BytesN<32>,
        amount: i128,
        target_chain: String,
        source_game_id: u32,
        target_game_id: u32,
    ) -> BytesN<32> {
        Self::require_not_paused(&env);
        owner.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }

        // Verify asset is transferable
        let def: AssetDefinition = env
            .storage()
            .persistent()
            .get(&DataKey::AssetDef(asset_id.clone()))
            .expect("asset not registered");
        if !def.is_transferable {
            panic!("asset not transferable");
        }

        // Verify chain is active
        let chain_config: ChainConfig = env
            .storage()
            .persistent()
            .get(&DataKey::ChainConfig(target_chain.clone()))
            .expect("target chain not registered");
        if !chain_config.is_active {
            panic!("target chain is not active");
        }

        // Check bridge amount limit
        if chain_config.max_bridge_amount > 0 && amount > chain_config.max_bridge_amount {
            panic!("bridge amount exceeds chain limit");
        }

        // Check cooldown
        let cooldown_key = DataKey::BridgeCooldown(owner.clone(), target_chain.clone());
        let last_bridge: u64 = env.storage().persistent().get(&cooldown_key).unwrap_or(0);
        let now = env.ledger().timestamp();
        if now < last_bridge + chain_config.cooldown_secs {
            panic!("bridge cooldown not elapsed");
        }

        // Lock assets - reduce owner balance
        let bal_key = DataKey::Balance(owner.clone(), asset_id.clone());
        let mut bal: AssetBalance = env
            .storage()
            .persistent()
            .get(&bal_key)
            .expect("insufficient balance");
        if bal.amount < amount {
            panic!("insufficient balance");
        }
        bal.amount -= amount;
        if bal.amount == 0 {
            env.storage().persistent().remove(&bal_key);
        } else {
            env.storage().persistent().set(&bal_key, &bal);
        }

        // Generate request ID
        let nonce: u64 = env
            .storage()
            .instance()
            .get(&DataKey::BridgeNonce)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::BridgeNonce, &(nonce + 1));
        let mut request_bytes = [0u8; 32];
        request_bytes[0..8].copy_from_slice(&nonce.to_be_bytes());
        request_bytes[8..12].copy_from_slice(&source_game_id.to_be_bytes());
        request_bytes[12..16].copy_from_slice(&target_game_id.to_be_bytes());
        let request_id = BytesN::from_array(env, &request_bytes);

        // Create bridge request
        let request = BridgeRequest {
            request_id: request_id.clone(),
            owner: owner.clone(),
            asset_id: asset_id.clone(),
            amount,
            source_chain: soroban_sdk::String::from_str(&env, "stellar"),
            target_chain: target_chain.clone(),
            source_game_id,
            target_game_id,
            status: BRIDGE_STATUS_PENDING,
            created_at: now,
            completed_at: None,
            nonce,
        };
        env.storage()
            .persistent()
            .set(&DataKey::BridgeRequest(request_id.clone()), &request);

        // Set cooldown
        env.storage()
            .persistent()
            .set(&DataKey::BridgeCooldown(owner.clone(), target_chain), &now);

        // Lock the assets record
        env.storage()
            .persistent()
            .set(&DataKey::BridgeLock(owner, asset_id.clone()), &amount);

        env.events().publish(
            (
                soroban_sdk::symbol_short!("BRIDGE_INIT"),
                request_id.clone(),
                asset_id,
            ),
            (amount, source_game_id, target_game_id),
        );

        request_id
    }

    /// Complete a bridge request (called by bridge oracle/admin)
    pub fn complete_bridge(env: Env, request_id: BytesN<32>) {
        Self::require_admin(&env);
        let mut request: BridgeRequest = env
            .storage()
            .persistent()
            .get(&DataKey::BridgeRequest(request_id.clone()))
            .expect("bridge request not found");

        if request.status != BRIDGE_STATUS_PENDING {
            panic!("bridge request not in pending status");
        }

        let now = env.ledger().timestamp();
        request.status = BRIDGE_STATUS_COMPLETED;
        request.completed_at = Some(now);

        env.storage()
            .persistent()
            .set(&DataKey::BridgeRequest(request_id.clone()), &request);

        // Remove the lock
        env.storage().persistent().remove(&DataKey::BridgeLock(
            request.owner.clone(),
            request.asset_id.clone(),
        ));

        env.events().publish(
            (soroban_sdk::symbol_short!("BRIDGE_DONE"), request_id),
            (request.amount, request.source_chain, request.target_chain),
        );
    }

    /// Fail a bridge request (called by bridge oracle/admin)
    pub fn fail_bridge(env: Env, request_id: BytesN<32>) {
        Self::require_admin(&env);
        let mut request: BridgeRequest = env
            .storage()
            .persistent()
            .get(&DataKey::BridgeRequest(request_id.clone()))
            .expect("bridge request not found");

        if request.status != BRIDGE_STATUS_PENDING {
            panic!("bridge request not in pending status");
        }

        request.status = BRIDGE_STATUS_FAILED;
        request.completed_at = Some(env.ledger().timestamp());

        // Refund the locked assets
        let bal_key = DataKey::Balance(request.owner.clone(), request.asset_id.clone());
        let existing: Option<AssetBalance> = env.storage().persistent().get(&bal_key);
        let balance = if let Some(mut b) = existing {
            b.amount += request.amount;
            b
        } else {
            AssetBalance {
                owner: request.owner.clone(),
                asset_id: request.asset_id.clone(),
                amount: request.amount,
                nft_serial: None,
                acquired_at: env.ledger().timestamp(),
                source_game_id: request.source_game_id,
            }
        };
        env.storage().persistent().set(&bal_key, &balance);

        env.storage()
            .persistent()
            .set(&DataKey::BridgeRequest(request_id.clone()), &request);

        // Remove the lock
        env.storage()
            .persistent()
            .remove(&DataKey::BridgeLock(request.owner, request.asset_id));

        env.events().publish(
            (soroban_sdk::symbol_short!("BRIDGE_FAIL"), request_id),
            request.amount,
        );
    }

    /// Cancel a bridge request (called by owner)
    pub fn cancel_bridge(env: Env, owner: Address, request_id: BytesN<32>) {
        owner.require_auth();
        let mut request: BridgeRequest = env
            .storage()
            .persistent()
            .get(&DataKey::BridgeRequest(request_id.clone()))
            .expect("bridge request not found");

        if request.owner != owner {
            panic!("not the bridge request owner");
        }

        if request.status != BRIDGE_STATUS_PENDING {
            panic!("bridge request not in pending status");
        }

        request.status = BRIDGE_STATUS_CANCELLED;

        // Refund the locked assets
        let bal_key = DataKey::Balance(owner.clone(), request.asset_id.clone());
        let existing: Option<AssetBalance> = env.storage().persistent().get(&bal_key);
        let balance = if let Some(mut b) = existing {
            b.amount += request.amount;
            b
        } else {
            AssetBalance {
                owner: owner.clone(),
                asset_id: request.asset_id.clone(),
                amount: request.amount,
                nft_serial: None,
                acquired_at: env.ledger().timestamp(),
                source_game_id: request.source_game_id,
            }
        };
        env.storage().persistent().set(&bal_key, &balance);

        env.storage()
            .persistent()
            .set(&DataKey::BridgeRequest(request_id.clone()), &request);

        // Remove the lock
        env.storage()
            .persistent()
            .remove(&DataKey::BridgeLock(owner, request.asset_id));

        env.events().publish(
            (soroban_sdk::symbol_short!("BRIDGE_CANCEL"), request_id),
            request.amount,
        );
    }

    /// Get bridge request status
    pub fn get_bridge_request(env: Env, request_id: BytesN<32>) -> Option<BridgeRequest> {
        env.storage()
            .persistent()
            .get(&DataKey::BridgeRequest(request_id))
    }

    /// Get supported chains
    pub fn get_supported_chains(env: Env) -> Vec<String> {
        env.storage()
            .instance()
            .get(&DataKey::SupportedChains)
            .unwrap_or(Vec::new(&env))
    }

    /// Get chain configuration
    pub fn get_chain_config(env: Env, chain_id: String) -> Option<ChainConfig> {
        env.storage()
            .persistent()
            .get(&DataKey::ChainConfig(chain_id))
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn get_balance(env: Env, owner: Address, asset_id: BytesN<32>) -> i128 {
        env.storage()
            .persistent()
            .get::<DataKey, AssetBalance>(&DataKey::Balance(owner, asset_id))
            .map(|b| b.amount)
            .unwrap_or(0)
    }

    pub fn get_balance_info(
        env: Env,
        owner: Address,
        asset_id: BytesN<32>,
    ) -> Option<AssetBalance> {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(owner, asset_id))
    }

    pub fn get_asset_definition(env: Env, asset_id: BytesN<32>) -> AssetDefinition {
        env.storage()
            .persistent()
            .get(&DataKey::AssetDef(asset_id))
            .expect("asset not found")
    }

    pub fn is_game_compatible(env: Env, asset_id: BytesN<32>, game_id: u32) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, AssetDefinition>(&DataKey::AssetDef(asset_id))
            .map(|d| game_id >= 64 || (d.compatible_games & (1u64 << game_id)) != 0)
            .unwrap_or(false)
    }

    pub fn validate_asset_compatibility(env: Env, asset_id: BytesN<32>, target_game: u32) -> bool {
        Self::is_game_compatible(env, asset_id, target_game)
    }

    pub fn get_cross_game_inventory(env: Env, player: Address) -> Vec<AssetBalance> {
        let ids: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::Inventory(player.clone()))
            .unwrap_or(Vec::new(&env));
        let mut inventory = Vec::new(&env);
        let mut i = 0;
        while i < ids.len() {
            let asset_id = ids.get(i).expect("asset id");
            if let Some(balance) = env
                .storage()
                .persistent()
                .get::<DataKey, AssetBalance>(&DataKey::Balance(player.clone(), asset_id))
            {
                inventory.push_back(balance);
            }
            i += 1;
        }
        inventory
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    pub fn set_paused(env: Env, paused: bool) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Paused, &paused);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
    }

    fn require_not_paused(env: &Env) {
        if env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Paused)
            .unwrap_or(false)
        {
            panic!("contract is paused");
        }
    }

    fn require_authorised_caller(env: &Env, caller: &Address, game_id: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if caller == &admin {
            return;
        }
        if let Some(gc) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::AuthorisedGame(game_id))
        {
            if caller == &gc {
                return;
            }
        }
        panic!("caller not authorised");
    }

    fn add_inventory_asset(env: &Env, owner: &Address, asset_id: &BytesN<32>) {
        let key = DataKey::Inventory(owner.clone());
        let mut ids: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(env));
        let mut i = 0;
        while i < ids.len() {
            if ids.get(i).expect("asset id") == *asset_id {
                return;
            }
            i += 1;
        }
        ids.push_back(asset_id.clone());
        env.storage().persistent().set(&key, &ids);
    }

    fn asset_id_from_game(env: &Env, game_id: u32, asset_type: u32) -> BytesN<32> {
        let mut bytes = [0u8; 32];
        bytes[0..4].copy_from_slice(&game_id.to_be_bytes());
        bytes[4..8].copy_from_slice(&asset_type.to_be_bytes());
        BytesN::from_array(env, &bytes)
    }
}
