# ArenaX Stellar Smart Contracts

## Overview

The ArenaX contracts workspace contains a suite of **Soroban smart contracts** powering the ArenaX gaming platform on the Stellar blockchain. It includes token economics, NFT marketplaces, staking, governance, anti-cheat, and batch operations—all composable, gas-optimized, and rigorously tested.

---

## Table of Contents

1. [Video Introduction](#-video-introduction)
2. [Setup Guide](#-setup-guide)
3. [Mint / Transfer / Burn Tutorial](#-mint--transfer--burn-tutorial)
4. [Example Contracts](#-example-contracts)
5. [API Reference](#-api-reference)
6. [Gas Optimization Tips](#-gas-optimization-tips)

---

## 🎬 Video Introduction

> **Watch the onboarding walkthrough**: [ArenaX Contracts — Developer Quick Start](https://www.youtube.com/watch?v=PLACEHOLDER_ARENAX_CONTRACTS_INTRO)
>
> [![ArenaX Contracts Intro](https://img.youtube.com/vi/PLACEHOLDER_ARENAX_CONTRACTS_INTRO/0.jpg)](https://www.youtube.com/watch?v=PLACEHOLDER_ARENAX_CONTRACTS_INTRO)
>
> What you'll learn in 6 minutes:
> - Architecture overview of the 20+ contract modules
> - How `ax-token` + `virtual-economy` + `staking-manager` compose together
> - Deploying your first contract to testnet in under 60 seconds
> - Where to find the batch-operation gas savings benchmarks

---

## 🛠️ Setup Guide

### 1. Prerequisites

| Tool           | Version   | Install Command                                             |
|----------------|-----------|-------------------------------------------------------------|
| Rust           | ≥ 1.75    | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| `wasm32` target | latest   | `rustup target add wasm32-unknown-unknown`                  |
| Soroban CLI    | ≥ 23.5.2  | `cargo install --locked soroban-cli --version 23.5.2`       |
| Cargo Make     | latest    | `cargo install cargo-make`                                  |

### 2. Clone & Configure Environment

```bash
git clone https://github.com/arenax/arenax.git
cd arenax/contracts

# Copy env template and fill in your keys
cp env.example .env
```

`.env` contents:

```bash
# Network
STELLAR_NETWORK=testnet
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org:443

# Admin account — fund via https://laboratory.stellar.org/#account-creator?network=test
ADMIN_SECRET_KEY=SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
ADMIN_PUBLIC_KEY=GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### 3. Install Soroban Network & Identity Config

```bash
# Add testnet RPC
soroban config network add testnet \
  --rpc-url https://soroban-testnet.stellar.org:443 \
  --network-passphrase "Test SDF Network ; September 2015"

# Import admin identity from secret key
soroban config identity add admin --secret-key "$ADMIN_SECRET_KEY"

# Fund the admin account on testnet (free XLM)
curl "https://friendbot.stellar.org/?addr=$ADMIN_PUBLIC_KEY"
```

### 4. Build the Workspace

```bash
# Build all contracts optimized for on-chain size
cargo build --target wasm32-unknown-unknown --release

# Build a single contract
cargo build --target wasm32-unknown-unknown --release --package ax-token
cargo build --target wasm32-unknown-unknown --release --package virtual-economy
cargo build --target wasm32-unknown-unknown --release --package staking-manager
cargo build --target wasm32-unknown-unknown --release --package batch-operations
```

Expected output directory:
```
target/wasm32-unknown-unknown/release/
├── ax_token.wasm              (~180 KB)
├── virtual_economy.wasm       (~250 KB)
├── staking_manager.wasm       (~220 KB)
└── ...
```

### 5. Run the Test Suite

```bash
# All unit + integration tests
cargo test --workspace

# Verbose output for a specific package
cargo test --package ax-token -- --nocapture

# Token tests only
cargo test --package testing-infrastructure token_tests

# Fuzz testing (requires nightly toolchain)
cargo test --package testing-infrastructure fuzz_tests
```

### 6. Deploy AX Token to Testnet (Hello World)

```bash
# 1. Deploy the WASM
TOKEN_ID=$(soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/ax_token.wasm \
  --source-account admin \
  --network testnet)
echo "Token deployed at: $TOKEN_ID"

# 2. Initialize with admin as owner
soroban contract invoke \
  --id "$TOKEN_ID" \
  --source-account admin \
  --network testnet \
  -- \
  initialize --admin "$ADMIN_PUBLIC_KEY"

# 3. Set supply cap to 1B
soroban contract invoke \
  --id "$TOKEN_ID" \
  --source-account admin \
  --network testnet \
  -- \
  set_supply_cap --cap 10000000000000000  # 1B with 7 decimals

# 4. Verify total supply
soroban contract invoke \
  --id "$TOKEN_ID" \
  --network testnet \
  -- \
  total_supply
# -> 0
```

---

## 💰 Mint / Transfer / Burn Tutorial

This tutorial walks through the **AX Token** (`ax-token/`) contract — the native ERC-20-style token of the ArenaX economy. We cover minting, transfers with flash-loan protection, burning, and the CLI/Rust client invocations.

All functions shown live in [ax-token/src/lib.rs](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/ax-token/src/lib.rs).

### Prerequisites

- You completed the [Setup Guide](#-setup-guide) above.
- `$TOKEN_ID`, `$ADMIN_PUBLIC_KEY` are set in your shell.
- A second test account (Alice):
  ```bash
  soroban config identity generate alice
  ALICE_PUBKEY=$(soroban config identity address alice)
  curl "https://friendbot.stellar.org/?addr=$ALICE_PUBKEY"
  ```

---

### Step 1: Mint Tokens

**Function**: [`AxToken::mint`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/ax-token/src/lib.rs#L119-L148)
- Access: **Admin only**
- Panics: `amount <= 0`, supply cap exceeded

#### CLI

```bash
# Mint 1,000,000 AX to Alice (7 decimals → use 1_000_000_0000000)
soroban contract invoke \
  --id "$TOKEN_ID" \
  --source-account admin \
  --network testnet \
  -- \
  mint --to "$ALICE_PUBKEY" --amount 10000000000000

# Verify balance
soroban contract invoke \
  --id "$TOKEN_ID" --network testnet -- \
  balance --addr "$ALICE_PUBKEY"
# -> 10000000000000
```

#### Rust Client (SDK)

```rust
use soroban_sdk::{Address, Env};
use soroban_clients::ax_token::Client as AxTokenClient;

async fn mint_to_alice(env: &Env, token_id: Address, admin: Address, alice: Address) {
    let client = AxTokenClient::new(env, &token_id);
    client.mint(&alice, &1_000_000_0000000_i128);
    assert_eq!(client.balance(&alice), 1_000_000_0000000_i128);
}
```

---

### Step 2: Transfer Tokens (Flash-Loan Protected)

**Function**: [`AxToken::transfer`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/ax-token/src/lib.rs#L187-L224)
- Access: **Signer of `from`**
- Safety: Rejects same-ledger-sequence reuse (flash-loan guard)
- Panics: contract paused, amount ≤ 0, self-transfer, insufficient balance

Create Bob:
```bash
soroban config identity generate bob
BOB_PUBKEY=$(soroban config identity address bob)
```

#### CLI

```bash
# Alice sends 50,000 AX to Bob
soroban contract invoke \
  --id "$TOKEN_ID" \
  --source-account alice \
  --network testnet \
  -- \
  transfer --from "$ALICE_PUBKEY" --to "$BOB_PUBKEY" --amount 500000000000

# Verify balances
soroban contract invoke --id "$TOKEN_ID" --network testnet -- balance --addr "$ALICE_PUBKEY"
# -> 9500000000000
soroban contract invoke --id "$TOKEN_ID" --network testnet -- balance --addr "$BOB_PUBKEY"
# -> 500000000000
```

#### Batch Transfer (Gas Saving)

For N transfers from one sender, use the batch contracts instead of N sequential calls. See [`batch-operations/src/lib.rs::batch_transfer`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/batch-operations/src/lib.rs#L590-L652):

```rust
// 1 call instead of 10 → ~70% fewer storage round-trips
batch_ops.batch_transfer(
    &alice,
    &vec![&env, bob.clone(), charlie.clone(), dave.clone(), ...],
    &vec![&env, 50_000_0000000, 25_000_0000000, 10_000_0000000, ...],
)?;
```

---

### Step 3: Burn Tokens

**Function**: [`AxToken::burn`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/ax-token/src/lib.rs#L150-L185)
- Access: **Admin only**
- Side effects: decrements `TotalSupply`, *reduces* the supply cap by the same amount (so the cap is a hard lifetime ceiling)
- Safety: same-sequence flash-loan guard

#### CLI

```bash
# Admin burns 100,000 AX from Alice
soroban contract invoke \
  --id "$TOKEN_ID" \
  --source-account admin \
  --network testnet \
  -- \
  burn --from "$ALICE_PUBKEY" --amount 1000000000000

# Check results
soroban contract invoke --id "$TOKEN_ID" --network testnet -- total_supply
# -> 9900000000000
soroban contract invoke --id "$TOKEN_ID" --network testnet -- get_supply_cap
# -> 9990000000000000  (cap reduced too)
```

---

### Step 4: End-to-End with Virtual Economy Currency

The `virtual-economy` contract exposes an independent in-game currency system alongside AX token. For mint/transfer/burn using **game currency** instead of the AX governance token, use:

| Action   | Function                                                                                                   |
|----------|-----------------------------------------------------------------------------------------------------------|
| Mint     | [`VirtualEconomyContract::mint_currency`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/src/lib.rs#L131-L174)   |
| Transfer | [`VirtualEconomyContract::transfer_currency`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/src/lib.rs#L177-L213) |
| Burn     | [`VirtualEconomyContract::burn_currency`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/src/lib.rs#L216-L255)   |
| Batch Mint | [`batch_mint_currency`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/src/lib.rs#L290-L339)                |
| Batch Transfer | [`batch_transfer_currency`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/src/lib.rs#L342-L385)          |
| Batch Burn | [`batch_burn_currency`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/src/lib.rs#L388-L441)                |

---

## 📦 Example Contracts

Each example includes the module path, purpose, key features, and links to the source.

### 1. ComposableExample — Minimal Ownable/Pausable Counter

**Location**: [composable-example/src/lib.rs](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/composable-example/src/lib.rs)

The smallest working contract in the repo. Perfect starting template for new contracts:

```rust
#[contract]
pub struct ComposableExample;

#[contractimpl]
impl ComposableExample {
    pub fn initialize(env: Env, owner: Address) { ... }
    pub fn owner(env: Env) -> Address { ... }
    pub fn transfer_ownership(env: Env, new_owner: Address) { ... }
    pub fn set_paused(env: Env, paused: bool) { ... }
    pub fn increment(env: Env) -> u32 { ... }  // gated on !is_paused
    pub fn decrement(env: Env) -> u32 { ... }  // saturated sub
}
```

**Patterns used**: `#[contracttype] enum DataKey`, `require_auth`, guarded functions, idempotent `initialize`.

---

### 2. AxToken — ERC-20 + Vesting + Locking + Governance + Buyback

**Location**: [ax-token/src/lib.rs](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/ax-token/src/lib.rs)

The full-featured native token. Single contract, 1100+ lines, composable with every other module:

| Layer              | Entry Points                                                                 |
|--------------------|------------------------------------------------------------------------------|
| Core ERC-20        | `initialize`, `mint`, `burn`, `transfer`, `balance`, `total_supply`        |
| Emergency Pause    | `pause`, `unpause_via_governance`, `is_paused`, `set_pause_timeout`        |
| Supply Cap         | `set_supply_cap`, `get_supply_cap`, `adjust_cap_via_governance`            |
| Vesting            | `create_vesting_schedule`, `claim_vested_tokens`, `revoke_vesting_schedule` |
| Token Locking      | `lock_tokens`, `unlock_tokens`, `get_locked_balance`, `get_total_locked_supply` |
| Governance         | `create_proposal`, `vote_on_proposal`, `get_proposal`                        |
| Vote Delegation    | `delegate`, `revoke_delegation`, `get_voting_power`                          |
| Buyback & Burn     | `deposit_revenue`, `configure_buyback`, `execute_buyback_and_burn`           |

See also: [ax-token/src/flash_loan_protection.rs](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/ax-token/src/flash_loan_protection.rs) for the same-sequence re-use guard.

---

### 3. VirtualEconomyContract — NFTs + Currency + Marketplace + AMM + Auctions

**Location**: [virtual-economy/src/lib.rs](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/src/lib.rs)

Everything needed for an in-game economy:

```rust
// Currency
mint_currency / transfer_currency / burn_currency / batch_*_currency

// NFTs
mint_nft / transfer_nft / get_nft_owner / get_nft_metadata / get_owned_nfts

// Fixed-price marketplace
create_marketplace_order / execute_marketplace_trade / cancel_marketplace_order

// Dutch auctions (NFT price decay over time)
create_dutch_auction / get_auction_price / purchase_dutch_auction

// Bonding-curve drops (price rises with each minted unit)
create_bonding_curve_drop / get_drop_price / mint_from_drop

// Referral program
configure_referrals / register_referral / record_referral_activity
```

---

### 4. BatchOperations — 6 Gas-Optimized Multi-Item Entry Points

**Location**: [batch-operations/src/lib.rs](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/batch-operations/src/lib.rs)

Collapses N separate on-chain calls into 1:

| Entry Point                    | Semantics   | Optimization Target                    |
|--------------------------------|-------------|----------------------------------------|
| `batch_transfer`               | Atomic      | 1 read/write of sender balance        |
| `batch_mint`                   | Atomic      | 1 read/write of `TotalSupply`         |
| `batch_register_tournaments`   | Partial     | Single-player, N tournament IDs       |
| `batch_update_reputation`      | Atomic      | N players, 1 write each               |
| `batch_unlock_achievements`    | Partial     | **1 bitmask read + 1 write for N**    |
| `batch_mint_nft`               | Atomic      | 1 read/write of `NftCount`            |

See § [Gas Optimization Tips](#-gas-optimization-tips) for benchmark numbers.

---

### 5. StakingManager — Tournament Stakes + Reward Pools + Validator Slashing

**Location**: [staking-manager/src/lib.rs](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/staking-manager/src/lib.rs)

Three staking subsystems in one contract:
- **Tournament stakes** — lock AX to enter, auto-return on completion or slashed on cheating
- **Reward pools** — flexible 30/90/180/365-day lock tiers with pro-rata APY
- **Validator slashing** — 5 severity levels, appeal window, burn-to-reward-pool split

---

### 6. Rest of the Workspace (20+ Modules)

| Module                       | Purpose                                                 |
|------------------------------|---------------------------------------------------------|
| `access-control/`            | Role-based access: ADMIN / MINTER / PAUSER / GOVERNOR |
| `airdrop/`                   | Merkle-tree airdrops with linear vesting                |
| `analytics/`                 | Economy telemetry aggregator                            |
| `anti-cheat/` + `anti-cheat-oracle/` | On-chain fraud detection + ZK oracle proofs      |
| `auth-gateway/`              | SIWE + session-token + rate-limit entry point         |
| `contract-registry/`         | Upgradable contract address book                        |
| `contract-standards/`        | SRC-20 / SRC-721 interface definitions                |
| `contract-utils/`            | Shared helpers: safe_math, bytes, encoding             |
| `cross-contract-utils/`      | Reusable cross-contract call patterns                  |
| `cross-game-assets/`         | Cross-title NFT bridge + wrapped assets                |
| `event-manager/`             | Webhook-style event dispatch to off-chain indexers     |
| `staking-rewards/`           | Standalone reward calculator (used by staking-manager) |
| `time-lock/`                 | TimelockExecutor for governance proposals (≥ 48h wait) |
| `treasury/`                  | Multi-sig + streaming treasury management             |
| `upgrade-system/`            | WASM hash-pinned upgrade proxy                         |
| `zk-proof/`                  | ZK-SNARK verification (Groth16 + Plonk adapters)      |
| `arenax-events/`             | All `#[contractevent]` / `Events::publish` types shared |
| `testing-infrastructure/`    | Fuzz, integration, economic simulation test suite     |

---

## 📖 API Reference

Quick lookup for the 4 most-used contracts. Click the function links for full source.

### AxToken ([ax-token/src/lib.rs](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/ax-token/src/lib.rs))

| Function | Signature | Access |
|---|---|---|
| [`initialize`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/ax-token/src/lib.rs#L104-L117) | `(env, admin: Address)` | Deployer once |
| [`mint`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/ax-token/src/lib.rs#L119-L148) | `(env, to: Address, amount: i128)` | Admin |
| [`burn`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/ax-token/src/lib.rs#L150-L185) | `(env, from: Address, amount: i128)` | Admin |
| [`transfer`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/ax-token/src/lib.rs#L187-L224) | `(env, from, to: Address, amount: i128)` | `from` signer |
| [`balance`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/ax-token/src/lib.rs#L226-L231) | `(env, addr: Address) -> i128` | Public |
| [`total_supply`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/ax-token/src/lib.rs#L233-L238) | `(env) -> i128` | Public |
| [`pause`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/ax-token/src/lib.rs#L253-L280) | `(env, reason: Symbol)` | Admin |
| [`lock_tokens`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/ax-token/src/lib.rs#L559-L606) | `(env, from, amount, unlock_time)` | `from` signer |
| [`create_proposal`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/ax-token/src/lib.rs#L689-L735) | `(env, proposer, desc, duration) -> u64` | ≥ 1000 AX holders |
| [`delegate`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/ax-token/src/lib.rs#L800-L839) | `(env, delegator, delegatee)` | `delegator` signer |
| [`execute_buyback_and_burn`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/ax-token/src/lib.rs#L997-L1065) | `(env) -> i128` | Public (timelocked) |

### VirtualEconomyContract ([virtual-economy/src/lib.rs](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/src/lib.rs))

| Function | Signature | Access |
|---|---|---|
| [`initialize`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/src/lib.rs#L44-L94) | `(env, admin, currency_config, marketplace_config)` | Deployer |
| [`mint_currency`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/src/lib.rs#L131-L174) | `(env, recipient, amount, reason)` | Authorized minter |
| [`transfer_currency`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/src/lib.rs#L177-L213) | `(env, from, to, amount)` | `from` signer |
| [`burn_currency`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/src/lib.rs#L216-L255) | `(env, owner, amount)` | `owner` signer |
| [`batch_mint_currency`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/src/lib.rs#L290-L339) | `(env, recipients, amounts, reason) -> BatchResult` | Authorized minter |
| [`mint_nft`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/src/lib.rs#L448-L511) | `(env, owner, metadata, token_id?) -> BytesN<32>` | Authorized minter |
| [`transfer_nft`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/src/lib.rs#L514-L568) | `(env, from, to, token_id)` | `from` signer |
| [`execute_marketplace_trade`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/src/lib.rs#L672-L822) | `(env, buyer, order_id)` | `buyer` signer |
| [`create_dutch_auction`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/src/lib.rs#L879-L947) | `(env, seller, token_id, start_price, floor_price, start/end_time, curve)` | Seller |
| [`mint_from_drop`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/src/lib.rs#L1172-L1236) | `(env, buyer, drop_id) -> BytesN<32>` | `buyer` signer |

### BatchOperations ([batch-operations/src/lib.rs](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/batch-operations/src/lib.rs))

| Function | Signature | Access |
|---|---|---|
| [`batch_transfer`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/batch-operations/src/lib.rs#L590-L652) | `(env, from, recipients: Vec, amounts: Vec)` | `from` signer |
| [`batch_mint`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/batch-operations/src/lib.rs#L660-L707) | `(env, recipients: Vec, amounts: Vec)` | Admin |
| [`batch_unlock_achievements`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/batch-operations/src/lib.rs#L827-L891) | `(env, player, ids: Vec<u32>) -> Vec<ItemResult>` | Admin |
| [`batch_register_tournaments`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/batch-operations/src/lib.rs#L717-L768) | `(env, player, tournament_ids) -> Vec<ItemResult>` | Player |
| [`enqueue_operation`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/batch-operations/src/lib.rs#L337-L377) | `(env, submitter, op_type, data) -> u32` | Submitter |
| [`get_analytics`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/batch-operations/src/lib.rs#L300-L325) | `(env) -> BatchAnalytics` | Public |

### StakingManager ([staking-manager/src/lib.rs](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/staking-manager/src/lib.rs))

| Function | Signature | Access |
|---|---|---|
| `stake_for_tournament` | `(env, user, tournament_id, amount)` | `user` signer |
| `unstake_from_tournament` | `(env, user, tournament_id)` | `user` signer |
| `stake_in_reward_pool` | `(env, user, pool_id, amount, lock_days)` | `user` signer |
| `claim_rewards` | `(env, user, pool_id)` | `user` signer |
| `slash_validator` | `(env, validator, severity, reason)` | Admin |
| `submit_appeal` | `(env, appellant, slash_id, reason)` | Appellant |
| `get_user_stake_info` | `(env, user) -> UserStakeInfo` | Public |

---

## ⚡ Gas Optimization Tips

### 1. Use Batch Entry Points — 70%+ Savings on Aggregate State

Every time you call a single-item mint/transfer N times, `TotalSupply` (mint/burn) or `EconomyAnalytics` gets read+written N times independently. The batch variants read once, accumulate in memory, write once.

Measured benchmarks from [virtual-economy/docs/BATCH_GAS_BENCHMARKS.md](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/virtual-economy/docs/BATCH_GAS_BENCHMARKS.md):

| Batch size | Individual: storage ops | Batch: storage ops | Reduction |
|-----------:|------------------------:|--------------------:|----------:|
| 10         | 40                      | 12                  | **70 %** |
| 25         | 100                     | 27                  | **73 %** |
| 50 (max)   | 200                     | 52                  | **74 %** |

**Rule of thumb**: if you have ≥ 4 items, always use the batch path.

### 2. Pack Booleans and Enums into Bitmasks

`batch_unlock_achievements` stores 64 achievements in one `u64`:

```rust
// 1 read + 1 write for N=64 items — vs 64 reads/writes naively
let mut mask: u64 = env.storage().instance().get(&DataKey::AchievementMask(player)).unwrap_or(0);
mask |= 1u64 << achievement_id;
env.storage().instance().set(&DataKey::AchievementMask(player), &mask);
```

Apply this pattern whenever you have sets of ≤ 64 flags per user.

### 3. Choose the Right Storage Backend

Soroban has three storage tiers; pick the cheapest one that fits:

| Tier            | Cost Per IO | Persistence                  | Use For                                     |
|-----------------|-------------|------------------------------|---------------------------------------------|
| `instance()`    | **Lowest**  | Expires if contract idle 12d | Admin, counters, configs, analytics, auth  |
| `persistent()`  | Medium      | Permanent                    | Balances, NFT ownership, user records      |
| `temporary()`   | Variable    | Single ledger                | Intra-txn scratch space — only when needed  |

The AX Token balance map uses `instance()` because it's read every block for liquidity; the Virtual Economy's NFT metadata goes to `persistent()` because old NFTs are rarely accessed.

### 4. Validate Everything *Before* Any Write

All batch entry points (and the single-item ones) run full validation of every input (lengths, amounts, balances, addresses) **before** mutating a single storage key. This:

- Keeps partial state from ever hitting storage on failure
- Lets the VM skip storage-diff rollback entirely
- Makes failure-case gas cost predictable (no wasted writes)

```rust
// Good: validate first, write second
for amount in amounts.iter() {
    if amount <= 0 { return Err(BatchError::InvalidAmount); }
}
// ... then do the writes
```

### 5. Release Profile: `opt-level = "z"` + LTO + 1 CGU

The workspace [Cargo.toml](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/Cargo.toml#L39-L44) pins:

```toml
[profile.release]
opt-level = "z"    # Optimize for WASM byte size
lto = true         # Link-time optimization across crates
codegen-units = 1  # Max inlining across the crate graph
panic = "abort"    # Drop unwinding machinery
```

Result: ~20-30% smaller WASM files than the default release profile → smaller deploy tx fees and lower per-invoke load cost.

### 6. Cache Repeated Storage Reads in Local Variables

```rust
// Bad — reads TotalSupply 3 times from instance storage
if env.storage().instance().get(&DataKey::TotalSupply).unwrap() > cap { ... }
let s: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap() + 100;
env.storage().instance().set(&DataKey::TotalSupply, &(s + 50));

// Good — 1 read, 1 write
let mut supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
if supply > cap { ... }
supply += 100;
supply += 50;
env.storage().instance().set(&DataKey::TotalSupply, &supply);
```

Each `instance()` call is a real VM instruction with fixed cost — caching is the single biggest per-function win.

### 7. Use `Vec::get_unchecked` After Length Validation

After `validate_batch(a.len(), b.len())` succeeds, all indices 0..n are guaranteed valid inside both arrays. Swap `vec.get(i).unwrap()` for `vec.get_unchecked(i)` inside hot loops — drops the bounds-branch and unwrap panic path per iteration. Used throughout [`batch-operations`](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/batch-operations/src/lib.rs#L303).

### 8. Avoid Replicating Cross-Contract State; Query On Demand

If contract A needs `balance(addr)` from the token, do **not** mirror the balance into A's storage. Use the generated Soroban client to invoke `ax_token.balance(&addr)` at the moment it's needed. Mirroring state doubles your write costs and guarantees drift.

---

## Project Structure

```
contracts/
├── access-control/             Role-based access control primitives
├── airdrop/                    Merkle airdrop + vesting
├── analytics/                  Economy analytics aggregator
├── anti-cheat/                 On-chain anti-cheat engine
├── anti-cheat-oracle/          ZK anti-cheat oracle adapter
├── arenax-events/              Shared #[contractevent] / event types
├── auth-gateway/               SIWE + session-token gateway
├── ax-token/                   AX native token (ERC-20 + vesting + governance)
├── batch-operations/           6 gas-optimized batch entry points
├── composable-example/         Minimal ownable/pausable counter (starter template)
├── contract-registry/          Upgradable contract address book
├── contract-standards/         SRC-20 / SRC-721 interface definitions
├── contract-utils/             Shared safe_math / serialization helpers
├── cross-contract-utils/       Cross-contract call patterns
├── cross-game-assets/          Cross-title NFT bridge
├── event-manager/              Webhook dispatch to indexers
├── specs/                      TLA+ model specs for key contracts
├── staking-manager/            Tournament stakes + reward pools + slashing
├── staking-rewards/            Standalone reward calculator
├── testing-infrastructure/     Fuzz, integration, economic sim tests
├── time-lock/                  TimelockExecutor for governance
├── treasury/                   Multi-sig streaming treasury
├── upgrade-system/             WASM upgrade proxy
├── virtual-economy/            Currency + NFTs + Marketplace + AMM + Auctions
├── zk-proof/                   ZK-SNARK verifier (Groth16 / Plonk)
├── Cargo.toml                  Workspace manifest + release profile
├── env.example                 Env template
└── README.md                   This file
```

## Quick Reference — CLI Cheatsheet

```bash
# Build
cargo build --target wasm32-unknown-unknown --release -p <PKG>

# Test
cargo test --package <PKG> -- --nocapture

# Deploy
ID=$(soroban contract deploy --wasm target/wasm32-unknown-unknown/release/<pkg>.wasm \
         --source-account admin --network testnet)

# Invoke read (no auth needed)
soroban contract invoke --id "$ID" --network testnet -- balance --addr "$ADDR"

# Invoke write (signer required)
soroban contract invoke --id "$ID" --source-account alice --network testnet -- \
  transfer --from "$ALICE" --to "$BOB" --amount 10000000000

# View deployed contract WASM hash on-chain
soroban contract inspect --id "$ID" --network testnet
```

## Support & Further Reading

- **Soroban Docs**: https://developers.stellar.org/docs/build/smart-contracts/overview
- **Testnet Faucet**: https://friendbot.stellar.org
- **TLA+ Invariants**: [contracts/specs/INVARIANTS.md](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/specs/INVARIANTS.md)
- **Testing Guide**: [contracts/testing-infrastructure/README.md](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/testing-infrastructure/README.md)
- **Security Checklist**: [contracts/testing-infrastructure/security/audit_checklist.md](file:///C:/Users/s-barau/Documents/GitHub/ArenaX/contracts/testing-infrastructure/security/audit_checklist.md)
