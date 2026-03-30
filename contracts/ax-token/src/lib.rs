#![no_std]

use soroban_sdk::{contract, contractevent, contractimpl, contracttype, Address, Env, String};

/// Storage keys for the AX Token contract
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// Contract administrator address (governance multisig)
    Admin,
    /// Token balance for a specific address
    Balance(Address),
    /// Allowance from owner to spender
    Allowance(Address, Address), // (owner, spender)
    /// Total token supply in circulation
    TotalSupply,
    /// Maximum token supply cap (immutable after init)
    MaxSupply,
    /// Treasury address for platform fees and slashed tokens
    Treasury,
    /// Token metadata
    TokenInfo,
}

/// Token metadata information
#[derive(Clone)]
#[contracttype]
pub struct TokenInfo {
    pub name: String,
    pub symbol: String,
    pub decimals: u32,
}

/// Error codes for the AX Token contract
#[derive(Clone, Copy)]
#[contracttype]
pub enum TokenError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    InsufficientBalance = 5,
    InsufficientAllowance = 6,
    MaxSupplyExceeded = 7,
    SelfTransfer = 8,
    InvalidAddress = 9,
}

/// Event emitted when tokens are minted
#[contractevent]
pub struct Minted {
    pub to: Address,
    pub amount: i128,
    pub new_total_supply: i128,
}

/// Event emitted when tokens are burned
#[contractevent]
pub struct Burned {
    pub from: Address,
    pub amount: i128,
    pub new_total_supply: i128,
}

/// Event emitted when tokens are transferred
#[contractevent]
pub struct Transferred {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
}

/// Event emitted when allowance is approved
#[contractevent]
pub struct Approved {
    pub owner: Address,
    pub spender: Address,
    pub amount: i128,
}

/// Event emitted when admin is changed
#[contractevent]
pub struct AdminChanged {
    pub old_admin: Address,
    pub new_admin: Address,
}

/// Event emitted when treasury is set
#[contractevent]
pub struct TreasurySet {
    pub treasury: Address,
}

#[contract]
pub struct AxToken;

#[contractimpl]
impl AxToken {
    /// Initialize the AX Token contract
    /// 
    /// # Arguments
    /// * `admin` - Administrator address (should be governance multisig)
    /// * `max_supply` - Maximum token supply cap (e.g., 1_000_000_000 * 10^7 for 1B tokens)
    /// * `treasury` - Treasury address for platform fees
    /// 
    /// # Panics
    /// Panics if contract is already initialized
    pub fn initialize(
        env: Env,
        admin: Address,
        max_supply: i128,
        treasury: Address,
    ) {
        if Self::has_admin(&env) {
            panic!("already initialized");
        }

        // Validate inputs
        if max_supply <= 0 {
            panic!("max supply must be positive");
        }

        // Set token metadata
        let token_info = TokenInfo {
            name: String::from_str(&env, "ArenaX Token"),
            symbol: String::from_str(&env, "AX"),
            decimals: 7, // Standard Stellar decimal places
        };

        // Initialize storage
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::MaxSupply, &max_supply);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage().instance().set(&DataKey::TokenInfo, &token_info);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);

        TreasurySet { treasury }.publish(&env);
    }

    /// Mint new tokens to a specified address
    /// 
    /// # Arguments
    /// * `to` - Recipient address
    /// * `amount` - Amount of tokens to mint (in stroops, 1 AX = 10^7 stroops)
    /// 
    /// # Authorization
    /// Requires admin authorization
    /// 
    /// # Panics
    /// - If caller is not admin
    /// - If amount is not positive
    /// - If minting would exceed max supply
    pub fn mint(env: Env, to: Address, amount: i128) {
        Self::require_admin(&env);

        if amount <= 0 {
            panic!("amount must be positive");
        }

        let current_supply = Self::total_supply(env.clone());
        let max_supply = Self::max_supply(env.clone());
        let new_supply = current_supply
            .checked_add(amount)
            .expect("supply overflow");

        if new_supply > max_supply {
            panic!("minting would exceed max supply");
        }

        // Update recipient balance
        let current_balance = Self::balance(env.clone(), to.clone());
        let new_balance = current_balance
            .checked_add(amount)
            .expect("balance overflow");
        env.storage()
            .instance()
            .set(&DataKey::Balance(to.clone()), &new_balance);

        // Update total supply
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &new_supply);

        Minted {
            to,
            amount,
            new_total_supply: new_supply,
        }
        .publish(&env);
    }

    /// Burn tokens from a specified address
    /// 
    /// # Arguments
    /// * `from` - Address to burn tokens from
    /// * `amount` - Amount of tokens to burn
    /// 
    /// # Authorization
    /// Requires authorization from the `from` address
    /// 
    /// # Panics
    /// - If caller is not authorized
    /// - If amount is not positive
    /// - If balance is insufficient
    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        let current_balance = Self::balance(env.clone(), from.clone());
        if current_balance < amount {
            panic!("insufficient balance");
        }

        let new_balance = current_balance
            .checked_sub(amount)
            .expect("balance underflow");
        env.storage()
            .instance()
            .set(&DataKey::Balance(from.clone()), &new_balance);

        let current_supply = Self::total_supply(env.clone());
        let new_supply = current_supply
            .checked_sub(amount)
            .expect("supply underflow");
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &new_supply);

        Burned {
            from,
            amount,
            new_total_supply: new_supply,
        }
        .publish(&env);
    }

    /// Transfer tokens from one address to another
    /// 
    /// # Arguments
    /// * `from` - Sender address
    /// * `to` - Recipient address
    /// * `amount` - Amount of tokens to transfer
    /// 
    /// # Authorization
    /// Requires authorization from the `from` address
    /// 
    /// # Panics
    /// - If caller is not authorized
    /// - If amount is not positive
    /// - If balance is insufficient
    /// - If transferring to self
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        if from == to {
            panic!("cannot transfer to self");
        }

        // Deduct from sender
        let from_balance = Self::balance(env.clone(), from.clone());
        if from_balance < amount {
            panic!("insufficient balance");
        }

        let new_from_balance = from_balance
            .checked_sub(amount)
            .expect("balance underflow");
        env.storage()
            .instance()
            .set(&DataKey::Balance(from.clone()), &new_from_balance);

        // Add to recipient
        let to_balance = Self::balance(env.clone(), to.clone());
        let new_to_balance = to_balance
            .checked_add(amount)
            .expect("balance overflow");
        env.storage()
            .instance()
            .set(&DataKey::Balance(to.clone()), &new_to_balance);

        Transferred { from, to, amount }.publish(&env);
    }

    /// Approve a spender to transfer tokens on behalf of the owner
    /// 
    /// # Arguments
    /// * `owner` - Token owner address
    /// * `spender` - Address authorized to spend tokens
    /// * `amount` - Maximum amount the spender can transfer
    /// 
    /// # Authorization
    /// Requires authorization from the `owner` address
    pub fn approve(env: Env, owner: Address, spender: Address, amount: i128) {
        owner.require_auth();

        if amount < 0 {
            panic!("amount cannot be negative");
        }

        env.storage()
            .instance()
            .set(&DataKey::Allowance(owner.clone(), spender.clone()), &amount);

        Approved {
            owner,
            spender,
            amount,
        }
        .publish(&env);
    }

    /// Transfer tokens from one address to another using allowance
    /// 
    /// # Arguments
    /// * `spender` - Address executing the transfer (must have allowance)
    /// * `from` - Token owner address
    /// * `to` - Recipient address
    /// * `amount` - Amount of tokens to transfer
    /// 
    /// # Authorization
    /// Requires authorization from the `spender` address
    /// 
    /// # Panics
    /// - If spender is not authorized
    /// - If amount exceeds allowance
    /// - If balance is insufficient
    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        amount: i128,
    ) {
        spender.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        if from == to {
            panic!("cannot transfer to self");
        }

        // Check and update allowance
        let allowance = Self::allowance(env.clone(), from.clone(), spender.clone());
        if allowance < amount {
            panic!("insufficient allowance");
        }

        let new_allowance = allowance
            .checked_sub(amount)
            .expect("allowance underflow");
        env.storage().instance().set(
            &DataKey::Allowance(from.clone(), spender.clone()),
            &new_allowance,
        );

        // Deduct from sender
        let from_balance = Self::balance(env.clone(), from.clone());
        if from_balance < amount {
            panic!("insufficient balance");
        }

        let new_from_balance = from_balance
            .checked_sub(amount)
            .expect("balance underflow");
        env.storage()
            .instance()
            .set(&DataKey::Balance(from.clone()), &new_from_balance);

        // Add to recipient
        let to_balance = Self::balance(env.clone(), to.clone());
        let new_to_balance = to_balance
            .checked_add(amount)
            .expect("balance overflow");
        env.storage()
            .instance()
            .set(&DataKey::Balance(to.clone()), &new_to_balance);

        Transferred { from, to, amount }.publish(&env);
    }

    // ========================================================================
    // Query Functions (View-only, no state changes)
    // ========================================================================

    /// Get token balance for an address
    pub fn balance(env: Env, addr: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Balance(addr))
            .unwrap_or(0)
    }

    /// Get allowance from owner to spender
    pub fn allowance(env: Env, owner: Address, spender: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Allowance(owner, spender))
            .unwrap_or(0)
    }

    /// Get total token supply in circulation
    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    /// Get maximum token supply cap
    pub fn max_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::MaxSupply)
            .unwrap_or(0)
    }

    /// Get token metadata (name, symbol, decimals)
    pub fn token_info(env: Env) -> TokenInfo {
        env.storage()
            .instance()
            .get(&DataKey::TokenInfo)
            .expect("token not initialized")
    }

    /// Get contract administrator address
    pub fn admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set")
    }

    /// Get treasury address
    pub fn treasury(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Treasury)
            .expect("treasury not set")
    }

    // ========================================================================
    // Admin Functions
    // ========================================================================

    /// Transfer admin role to a new address
    /// 
    /// # Arguments
    /// * `new_admin` - New administrator address
    /// 
    /// # Authorization
    /// Requires current admin authorization
    pub fn set_admin(env: Env, new_admin: Address) {
        let old_admin = Self::admin(env.clone());
        old_admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        AdminChanged {
            old_admin,
            new_admin,
        }
        .publish(&env);
    }

    /// Update treasury address
    /// 
    /// # Arguments
    /// * `new_treasury` - New treasury address
    /// 
    /// # Authorization
    /// Requires admin authorization
    pub fn set_treasury(env: Env, new_treasury: Address) {
        Self::require_admin(&env);

        env.storage()
            .instance()
            .set(&DataKey::Treasury, &new_treasury);

        TreasurySet {
            treasury: new_treasury,
        }
        .publish(&env);
    }

    // ========================================================================
    // Internal Helper Functions
    // ========================================================================

    fn has_admin(env: &Env) -> bool {
        env.storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::Admin)
            .is_some()
    }

    fn require_admin(env: &Env) {
        let admin = Self::admin(env.clone());
        admin.require_auth();
    }
}

#[cfg(test)]
mod test;
