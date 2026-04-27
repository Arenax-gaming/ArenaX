#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, BytesN, Env, String, Vec,
};

// ─── Types ───────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum AssetKind {
    Nft         = 0,
    Currency    = 1,
    Achievement = 2,
    Cosmetic    = 3,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum AssetRarity {
    Common    = 0,
    Uncommon  = 1,
    Rare      = 2,
    Epic      = 3,
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
    pub max_supply: i128,   // 0 = unlimited
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

// ─── Storage Keys ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    AssetDef(BytesN<32>),
    Balance(Address, BytesN<32>),
    /// Authorised game contracts that can mint/grant assets
    AuthorisedGame(u32),
    Paused,
    NftSerial(BytesN<32>),
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
        env.storage().instance().set(&DataKey::AuthorisedGame(game_id), &game_contract);
    }

    pub fn revoke_game(env: Env, game_id: u32) {
        Self::require_admin(&env);
        env.storage().instance().remove(&DataKey::AuthorisedGame(game_id));
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
        if env.storage().persistent().has(&DataKey::AssetDef(asset_id.clone())) {
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
        env.storage().persistent().set(&DataKey::AssetDef(asset_id.clone()), &def);
        env.events().publish(
            (soroban_sdk::symbol_short!("ASSET_REG"), asset_id),
            (kind, rarity, compatible_games),
        );
    }

    pub fn update_compatible_games(env: Env, asset_id: BytesN<32>, compatible_games: u64) {
        Self::require_admin(&env);
        let mut def: AssetDefinition = env.storage().persistent()
            .get(&DataKey::AssetDef(asset_id.clone()))
            .expect("asset not found");
        def.compatible_games = compatible_games;
        env.storage().persistent().set(&DataKey::AssetDef(asset_id), &def);
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
        if amount <= 0 { panic!("amount must be positive"); }

        let mut def: AssetDefinition = env.storage().persistent()
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
        env.storage().persistent().set(&DataKey::AssetDef(asset_id.clone()), &def);

        // NFT serial tracking
        let nft_serial = if def.kind == AssetKind::Nft as u32 {
            let serial: u64 = env.storage().instance()
                .get(&DataKey::NftSerial(asset_id.clone()))
                .unwrap_or(0);
            let new_serial = serial + 1;
            env.storage().instance().set(&DataKey::NftSerial(asset_id.clone()), &new_serial);
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
        if amount <= 0 { panic!("amount must be positive"); }
        if from == to { panic!("cannot transfer to self"); }

        let def: AssetDefinition = env.storage().persistent()
            .get(&DataKey::AssetDef(asset_id.clone()))
            .expect("asset not registered");

        if !def.is_transferable { panic!("asset not transferable"); }

        // Validate destination game compatibility
        if to_game_id < 64 && (def.compatible_games & (1u64 << to_game_id)) == 0 {
            panic!("destination game not compatible");
        }

        let from_key = DataKey::Balance(from.clone(), asset_id.clone());
        let mut from_bal: AssetBalance = env.storage().persistent()
            .get(&from_key).expect("insufficient balance");
        if from_bal.amount < amount { panic!("insufficient balance"); }
        from_bal.amount -= amount;
        if from_bal.amount == 0 {
            env.storage().persistent().remove(&from_key);
        } else {
            env.storage().persistent().set(&from_key, &from_bal);
        }

        let to_key = DataKey::Balance(to.clone(), asset_id.clone());
        let to_bal = if let Some(mut b) = env.storage().persistent()
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

        env.events().publish(
            (soroban_sdk::symbol_short!("XFER"), asset_id, from, to),
            (amount, from_game_id, to_game_id),
        );
    }

    /// Burn (consume) an asset — e.g. spending in-game currency.
    pub fn burn(env: Env, owner: Address, asset_id: BytesN<32>, amount: i128) {
        Self::require_not_paused(&env);
        owner.require_auth();
        if amount <= 0 { panic!("amount must be positive"); }

        let bal_key = DataKey::Balance(owner.clone(), asset_id.clone());
        let mut bal: AssetBalance = env.storage().persistent()
            .get(&bal_key).expect("no balance");
        if bal.amount < amount { panic!("insufficient balance"); }
        bal.amount -= amount;
        if bal.amount == 0 {
            env.storage().persistent().remove(&bal_key);
        } else {
            env.storage().persistent().set(&bal_key, &bal);
        }

        let mut def: AssetDefinition = env.storage().persistent()
            .get(&DataKey::AssetDef(asset_id.clone())).unwrap();
        def.current_supply -= amount;
        env.storage().persistent().set(&DataKey::AssetDef(asset_id.clone()), &def);

        env.events().publish(
            (soroban_sdk::symbol_short!("BURNED"), asset_id, owner),
            amount,
        );
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn get_balance(env: Env, owner: Address, asset_id: BytesN<32>) -> i128 {
        env.storage().persistent()
            .get::<DataKey, AssetBalance>(&DataKey::Balance(owner, asset_id))
            .map(|b| b.amount)
            .unwrap_or(0)
    }

    pub fn get_balance_info(env: Env, owner: Address, asset_id: BytesN<32>) -> Option<AssetBalance> {
        env.storage().persistent().get(&DataKey::Balance(owner, asset_id))
    }

    pub fn get_asset_definition(env: Env, asset_id: BytesN<32>) -> AssetDefinition {
        env.storage().persistent()
            .get(&DataKey::AssetDef(asset_id))
            .expect("asset not found")
    }

    pub fn is_game_compatible(env: Env, asset_id: BytesN<32>, game_id: u32) -> bool {
        env.storage().persistent()
            .get::<DataKey, AssetDefinition>(&DataKey::AssetDef(asset_id))
            .map(|d| game_id >= 64 || (d.compatible_games & (1u64 << game_id)) != 0)
            .unwrap_or(false)
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).expect("not initialized")
    }

    pub fn set_paused(env: Env, paused: bool) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Paused, &paused);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        admin.require_auth();
    }

    fn require_not_paused(env: &Env) {
        if env.storage().instance().get::<DataKey, bool>(&DataKey::Paused).unwrap_or(false) {
            panic!("contract is paused");
        }
    }

    fn require_authorised_caller(env: &Env, caller: &Address, game_id: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if caller == &admin { return; }
        if let Some(gc) = env.storage().instance()
            .get::<DataKey, Address>(&DataKey::AuthorisedGame(game_id))
        {
            if caller == &gc { return; }
        }
        panic!("caller not authorised");
    }
}
