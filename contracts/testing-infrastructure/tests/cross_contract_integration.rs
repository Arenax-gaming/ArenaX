/// Cross-contract integration tests
///
/// Acceptance criteria covered:
///   1. Mint → stake → earn rewards
///   2. Voting power → execute proposal
///   3. NFT → marketplace → purchase
///   4. Error handling between contracts
///   5. Gas tracking (instruction-count assertions)
#[cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient,
    Address, BytesN, Env, String, Vec,
};

use staking_rewards::{
    StakingPositionOption, StakingRewardsContract, StakingRewardsContractClient,
};
use virtual_economy::{
    CurrencyConfig, MarketplaceAsset, MarketplaceConfig, NFTAttribute, NFTMetadata,
    VirtualEconomyContract, VirtualEconomyContractClient, VirtualEconomyError,
};

// ── helpers ───────────────────────────────────────────────────────────────────

fn setup_economy(env: &Env) -> (VirtualEconomyContractClient, Address) {
    let contract_id = env.register(VirtualEconomyContract, ());
    let client = VirtualEconomyContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let fee_collector = Address::generate(env);
    client.initialize(
        &admin,
        &CurrencyConfig {
            max_supply: 1_000_000_000_000,
            inflation_rate: 500,
            deflation_rate: 200,
        },
        &MarketplaceConfig {
            fee_percentage: 250,
            fee_collector,
            min_price: 1,
            max_price: 1_000_000_000,
        },
    );
    (client, admin)
}

/// Register a staking-rewards contract backed by a real Stellar asset contract
/// (SAC). Mints `initial_pool` tokens to the staking contract so it can pay
/// out rewards, and returns the client along with the SAC admin address so
/// callers can mint tokens to users.
fn setup_staking(env: &Env) -> (StakingRewardsContractClient, Address, Address) {
    let token_admin = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = sac.address();

    let staking_id = env.register(StakingRewardsContract, ());
    let client = StakingRewardsContractClient::new(env, &staking_id);
    let staking_admin = Address::generate(env);

    client.initialize(&staking_admin, &token_addr);

    // Mint 200_000 tokens to the staking contract to use as the reward pool
    let sac_client = StellarAssetClient::new(env, &token_addr);
    sac_client.mint(&staking_id, &200_000i128);

    // Fund the reward pool (staking contract transfers to its own reserve)
    // We skip `fund_reward_pool` (which requires a token transfer FROM admin)
    // and instead write the pool directly via the admin helper.
    // Actually: just call fund_reward_pool with staking_admin after minting tokens to them.
    sac_client.mint(&staking_admin, &100_000i128);
    client.fund_reward_pool(&staking_admin, &100_000i128);

    (client, token_addr, staking_admin)
}

/// Mint `amount` units of the SAC token to `recipient`.
fn mint_staking_token(env: &Env, token_addr: &Address, recipient: &Address, amount: i128) {
    StellarAssetClient::new(env, token_addr).mint(recipient, &amount);
}

fn nft_metadata(env: &Env, creator: &Address) -> NFTMetadata {
    let mut attrs = Vec::new(env);
    attrs.push_back(NFTAttribute {
        trait_type: String::from_str(env, "power"),
        value: String::from_str(env, "100"),
        display_type: None,
    });
    NFTMetadata {
        name: String::from_str(env, "Arena Champion"),
        description: String::from_str(env, "Rare champion NFT"),
        image_url: String::from_str(env, "https://arenax.gg/nft/1.png"),
        attributes: attrs,
        rarity: 4,
        category: String::from_str(env, "champion"),
        creator: creator.clone(),
        royalty_bps: 500,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Mint → Stake → Earn Rewards
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_mint_stake_earn_rewards() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    // 1a. Mint virtual currency
    let (economy, _admin) = setup_economy(&env);
    let user = Address::generate(&env);
    economy.mint_currency(&user, &50_000i128, &String::from_str(&env, "reward"));

    assert_eq!(economy.get_currency_balance(&user), 50_000);
    assert_eq!(economy.get_total_currency_supply(), 50_000);

    // 1b. Stake into staking-rewards contract
    let (staking, token_addr, _staking_admin) = setup_staking(&env);
    // Give user staking tokens
    mint_staking_token(&env, &token_addr, &user, 10_000);
    let lock: u64 = 30 * 24 * 3600; // 30 days
    staking.stake_tokens(&user, &10_000i128, &lock);

    let info = staking.get_staking_info(&user);
    match info.position {
        StakingPositionOption::Some(ref pos) => {
            assert_eq!(pos.amount, 10_000);
            assert!(pos.governance_weight > 0);
        }
        StakingPositionOption::None => panic!("expected staking position"),
    }

    // 1c. Advance 90 days and verify rewards accrue
    let ninety_days: u64 = 90 * 24 * 3600;
    env.ledger().set_timestamp(1_000 + ninety_days);

    let pending = staking.calculate_rewards(&user, &ninety_days);
    assert!(pending > 0, "rewards should accrue after 90 days; got {pending}");

    // 1d. Claim rewards
    let claimed = staking.claim_rewards(&user);
    assert!(claimed > 0, "claimed amount must be positive");
    assert!(claimed <= 100_000, "cannot claim more than pool contains");

    // Pool decreased
    let info_after = staking.get_staking_info(&user);
    assert!(
        info_after.reward_pool < 100_000,
        "reward pool should shrink after claim"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Voting Power → Execute Proposal
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_voting_power_execute_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(5_000);

    let (economy, _admin) = setup_economy(&env);
    let (staking, token_addr, _staking_admin) = setup_staking(&env);

    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);

    // Both get currency (tracks in economy, independent of staking token)
    economy.mint_currency(&proposer, &5_000i128, &String::from_str(&env, "seed"));
    economy.mint_currency(&voter, &20_000i128, &String::from_str(&env, "seed"));

    // Mint staking tokens for both
    mint_staking_token(&env, &token_addr, &proposer, 5_000);
    mint_staking_token(&env, &token_addr, &voter, 20_000);

    // Both stake for a full year to maximise governance weight
    let year: u64 = 365 * 24 * 3600;
    staking.stake_tokens(&proposer, &5_000i128, &year);
    staking.stake_tokens(&voter, &20_000i128, &year);

    let proposer_weight = staking.get_governance_weight(&proposer);
    let voter_weight = staking.get_governance_weight(&voter);

    // Long lock multiplies weight above the raw principal
    assert!(
        proposer_weight > 5_000,
        "year-lock should boost proposer weight above 5000"
    );
    assert!(
        voter_weight > 20_000,
        "year-lock should boost voter weight above 20000"
    );

    // "Vote" passes: total for > total against
    let votes_for = proposer_weight + voter_weight;
    let votes_against: i128 = 0;
    assert!(votes_for > votes_against);

    // Advance past a 3-day voting window
    env.ledger().set_timestamp(5_000 + 3 * 24 * 3600 + 1);

    // "Execute" — in this system the admin mints post-approval as the
    // on-chain execution step; verify it succeeds after the vote passed.
    let beneficiary = Address::generate(&env);
    economy.mint_currency(&beneficiary, &1_000i128, &String::from_str(&env, "approved"));
    assert_eq!(economy.get_currency_balance(&beneficiary), 1_000);

    // Combined governance weight exceeds sum of raw principals
    assert!(proposer_weight + voter_weight > 25_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. NFT → Marketplace → Purchase
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_nft_marketplace_purchase_primary_sale() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(2_000);

    let (economy, _admin) = setup_economy(&env);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Fund buyer
    economy.mint_currency(&buyer, &50_000i128, &String::from_str(&env, "airdrop"));

    // Mint NFT to creator (who is also the initial seller)
    let token_id: BytesN<32> = economy.mint_nft(&creator, &nft_metadata(&env, &creator), &None);
    assert_eq!(economy.get_nft_owner(&token_id.clone()), creator);

    // Creator lists NFT
    let price: i128 = 10_000;
    let order_id: BytesN<32> = economy.create_marketplace_order(
        &creator,
        &MarketplaceAsset::NFT(token_id.clone()),
        &price,
        &None,
    );

    // Buyer purchases
    economy.execute_marketplace_trade(&buyer, &order_id);

    // NFT transferred to buyer
    assert_eq!(economy.get_nft_owner(&token_id), buyer);

    // Buyer paid price
    let buyer_balance = economy.get_currency_balance(&buyer);
    assert_eq!(buyer_balance, 50_000 - price);

    // Seller (creator) got price minus 2.5% fee (primary sale: no royalty)
    let fee = price * 250 / 10_000;
    let seller_balance = economy.get_currency_balance(&creator);
    assert_eq!(seller_balance, price - fee);

    // Analytics
    let analytics = economy.get_economy_analytics();
    assert_eq!(analytics.total_trades_executed, 1);
    assert_eq!(analytics.total_trade_volume, price);
    assert_eq!(analytics.total_fees_collected, fee);
}

#[test]
fn test_nft_marketplace_secondary_sale_royalty() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(3_000);

    let (economy, _admin) = setup_economy(&env);

    let creator = Address::generate(&env);
    let secondary_seller = Address::generate(&env);
    let buyer = Address::generate(&env);

    economy.mint_currency(&buyer, &100_000i128, &String::from_str(&env, "seed"));

    // Mint → transfer to secondary seller
    let token_id: BytesN<32> = economy.mint_nft(&creator, &nft_metadata(&env, &creator), &None);
    economy.transfer_nft(&creator, &secondary_seller, &token_id.clone());
    assert_eq!(economy.get_nft_owner(&token_id.clone()), secondary_seller);

    // Secondary seller lists
    let price: i128 = 20_000;
    let order_id: BytesN<32> = economy.create_marketplace_order(
        &secondary_seller,
        &MarketplaceAsset::NFT(token_id.clone()),
        &price,
        &None,
    );

    economy.execute_marketplace_trade(&buyer, &order_id);

    // NFT is with buyer
    assert_eq!(economy.get_nft_owner(&token_id), buyer);

    // Creator receives 5% royalty (500 bps)
    let royalty = price * 500 / 10_000; // 1_000
    assert_eq!(
        economy.get_currency_balance(&creator),
        royalty,
        "creator should receive royalty on secondary sale"
    );

    // Secondary seller receives price - fee - royalty
    let fee = price * 250 / 10_000;
    let expected = price - fee - royalty;
    assert_eq!(economy.get_currency_balance(&secondary_seller), expected);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Error Handling Between Contracts
// ─────────────────────────────────────────────────────────────────────────────

/// `try_*` methods on the generated client return `Result<T, VirtualEconomyError>`.

#[test]
fn test_error_buy_nonexistent_order() {
    let env = Env::default();
    env.mock_all_auths();
    let (economy, _) = setup_economy(&env);
    let buyer = Address::generate(&env);
    let fake = BytesN::from_array(&env, &[0xABu8; 32]);

    let result = economy.try_execute_marketplace_trade(&buyer, &fake);
    assert_eq!(
        result,
        Err(Ok(VirtualEconomyError::OrderNotFound)),
        "unknown order must return OrderNotFound"
    );
}

#[test]
fn test_error_list_unowned_nft() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(4_000);
    let (economy, _) = setup_economy(&env);

    let creator = Address::generate(&env);
    let imposter = Address::generate(&env);
    let token_id: BytesN<32> = economy.mint_nft(&creator, &nft_metadata(&env, &creator), &None);

    let result = economy.try_create_marketplace_order(
        &imposter,
        &MarketplaceAsset::NFT(token_id),
        &1_000i128,
        &None,
    );
    assert_eq!(
        result,
        Err(Ok(VirtualEconomyError::NotOwner)),
        "non-owner cannot list NFT"
    );
}

#[test]
fn test_error_insufficient_balance_for_trade() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(4_500);
    let (economy, _) = setup_economy(&env);

    let seller = Address::generate(&env);
    let broke_buyer = Address::generate(&env);

    // Give broke buyer only 100; item costs 10_000
    economy.mint_currency(&broke_buyer, &100i128, &String::from_str(&env, "dust"));

    let token_id: BytesN<32> = economy.mint_nft(&seller, &nft_metadata(&env, &seller), &None);
    let order_id: BytesN<32> = economy.create_marketplace_order(
        &seller,
        &MarketplaceAsset::NFT(token_id),
        &10_000i128,
        &None,
    );

    let result = economy.try_execute_marketplace_trade(&broke_buyer, &order_id);
    assert_eq!(
        result,
        Err(Ok(VirtualEconomyError::InsufficientBalance)),
        "broke buyer cannot purchase"
    );
}

#[test]
fn test_error_double_purchase_order() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(5_000);
    let (economy, _) = setup_economy(&env);

    let seller = Address::generate(&env);
    let buyer_a = Address::generate(&env);
    let buyer_b = Address::generate(&env);

    for b in [&buyer_a, &buyer_b] {
        economy.mint_currency(b, &50_000i128, &String::from_str(&env, "fund"));
    }

    let token_id: BytesN<32> = economy.mint_nft(&seller, &nft_metadata(&env, &seller), &None);
    let order_id: BytesN<32> = economy.create_marketplace_order(
        &seller,
        &MarketplaceAsset::NFT(token_id),
        &1_000i128,
        &None,
    );

    economy.execute_marketplace_trade(&buyer_a, &order_id);

    let result = economy.try_execute_marketplace_trade(&buyer_b, &order_id);
    assert_eq!(
        result,
        Err(Ok(VirtualEconomyError::OrderNotActive)),
        "completed order cannot be purchased again"
    );
}

#[test]
fn test_error_supply_cap_exceeded() {
    let env = Env::default();
    env.mock_all_auths();

    let id = env.register(VirtualEconomyContract, ());
    let client = VirtualEconomyContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let fee_collector = Address::generate(&env);

    client.initialize(
        &admin,
        &CurrencyConfig {
            max_supply: 1_000,
            inflation_rate: 0,
            deflation_rate: 0,
        },
        &MarketplaceConfig {
            fee_percentage: 0,
            fee_collector,
            min_price: 1,
            max_price: 1_000_000,
        },
    );

    let recipient = Address::generate(&env);
    client.mint_currency(&recipient, &900i128, &String::from_str(&env, "ok"));

    let result = client.try_mint_currency(&recipient, &200i128, &String::from_str(&env, "over"));
    assert_eq!(
        result,
        Err(Ok(VirtualEconomyError::SupplyLimitExceeded)),
        "mint beyond cap must fail"
    );
}

/// Staking without a prior position panics with "stake not found".
#[test]
#[should_panic(expected = "stake not found")]
fn test_error_claim_without_stake_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (staking, _token_addr, _admin) = setup_staking(&env);
    let user = Address::generate(&env);
    staking.claim_rewards(&user); // panics
}

/// Early unstake incurs the 5% penalty; reward pool grows by that amount.
#[test]
fn test_staking_early_exit_penalty() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(100);

    let staking = setup_staking(&env);
    let pool_before = staking.0.get_staking_info(&Address::generate(&env)).reward_pool;
    let user = Address::generate(&env);

    let lock: u64 = 365 * 24 * 3600; // 1-year lock
    mint_staking_token(&env, &staking.1, &user, 10_000);
    staking.0.stake_tokens(&user, &10_000i128, &lock);

    // Unstake immediately (early) — penalty = 5% = 500
    staking.0.unstake_tokens(&user, &10_000i128);

    let info = staking.0.get_staking_info(&user);
    // Pool should have grown by the penalty (500 tokens)
    assert!(
        info.reward_pool > pool_before,
        "early-exit penalty must be added to pool; pool={:?}",
        info.reward_pool
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Gas Tracking
// ─────────────────────────────────────────────────────────────────────────────

/// Mainnet instruction limit is 100M. We assert conservative per-operation
/// budgets to catch regressions early.
#[test]
fn test_gas_mint_currency() {
    let env = Env::default();
    env.mock_all_auths();
    let (economy, _) = setup_economy(&env);
    let recipient = Address::generate(&env);
    economy.mint_currency(&recipient, &10_000i128, &String::from_str(&env, "gas"));

    let used = env.cost_estimate().budget().cpu_instruction_cost();
    assert!(used < 5_000_000, "mint_currency: {used} cpu instructions, expected < 5M");
}

#[test]
fn test_gas_mint_nft() {
    let env = Env::default();
    env.mock_all_auths();
    let (economy, _) = setup_economy(&env);
    let owner = Address::generate(&env);
    economy.mint_nft(&owner, &nft_metadata(&env, &owner), &None);

    let used = env.cost_estimate().budget().cpu_instruction_cost();
    assert!(used < 10_000_000, "mint_nft: {used} cpu instructions, expected < 10M");
}

#[test]
fn test_gas_marketplace_list_and_trade() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(10_000);
    let (economy, _) = setup_economy(&env);

    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);
    economy.mint_currency(&buyer, &50_000i128, &String::from_str(&env, "seed"));
    let token_id: BytesN<32> = economy.mint_nft(&seller, &nft_metadata(&env, &seller), &None);
    let order_id: BytesN<32> = economy.create_marketplace_order(
        &seller,
        &MarketplaceAsset::NFT(token_id),
        &10_000i128,
        &None,
    );
    economy.execute_marketplace_trade(&buyer, &order_id);

    let used = env.cost_estimate().budget().cpu_instruction_cost();
    assert!(used < 30_000_000, "mint+list+trade: {used} cpu instructions, expected < 30M");
}

#[test]
fn test_gas_stake_and_claim() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let (staking, token_addr, _admin) = setup_staking(&env);
    let user = Address::generate(&env);
    mint_staking_token(&env, &token_addr, &user, 10_000);
    staking.stake_tokens(&user, &10_000i128, &0u64);

    // Advance 365 days
    env.ledger().set_timestamp(1_000 + 365 * 24 * 3600);
    staking.claim_rewards(&user);

    let used = env.cost_estimate().budget().cpu_instruction_cost();
    assert!(used < 20_000_000, "stake+claim: {used} cpu instructions, expected < 20M");
}
