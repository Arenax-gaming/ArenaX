#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, Vec};

fn setup() -> (Env, Address, VirtualEconomyContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(VirtualEconomyContract, ());
    let client = VirtualEconomyContractClient::new(&env, &contract_id);

    client.initialize(
        &admin,
        &CurrencyConfig {
            max_supply: 1_000_000_000,
            inflation_rate: 0,
            deflation_rate: 0,
        },
        &MarketplaceConfig {
            fee_percentage: 250,
            fee_collector: admin.clone(),
            min_price: 1,
            max_price: 1_000_000_000,
        },
    );

    (env, admin, client)
}

fn sample_metadata(env: &Env, creator: &Address, category: &str, royalty_bps: u32) -> NFTMetadata {
    NFTMetadata {
        name: String::from_str(env, "Test NFT"),
        description: String::from_str(env, "A test NFT"),
        image_url: String::from_str(env, "https://example.com/nft.png"),
        attributes: Vec::new(env),
        rarity: 3,
        category: String::from_str(env, category),
        creator: creator.clone(),
        royalty_bps,
    }
}

#[test]
fn mint_rejects_royalty_above_ten_percent() {
    let (env, admin, client) = setup();
    let metadata = sample_metadata(&env, &admin, "art", 1500); // 15% — over the 10% cap (#913)

    let result = client.try_mint_nft(&admin, &metadata, &None);
    assert!(result.is_err(), "minting with royalty_bps > 1000 must fail");
}

#[test]
fn mint_allows_royalty_at_ten_percent_boundary() {
    let (env, admin, client) = setup();
    let metadata = sample_metadata(&env, &admin, "art", 1000); // exactly 10%

    let token_id = client.mint_nft(&admin, &metadata, &None);
    let stored = client.get_nft_metadata(&token_id);
    assert_eq!(stored.royalty_bps, 1000);
}

#[test]
fn update_royalty_bps_rejects_above_ten_percent() {
    let (env, admin, client) = setup();
    let metadata = sample_metadata(&env, &admin, "art", 500);
    let token_id = client.mint_nft(&admin, &metadata, &None);

    let result = client.try_update_royalty_bps(&token_id, &admin, &1500);
    assert!(
        result.is_err(),
        "updating royalty_bps above 1000 must fail (#913)"
    );

    client.update_royalty_bps(&token_id, &admin, &1000);
    assert_eq!(client.get_nft_metadata(&token_id).royalty_bps, 1000);
}

#[test]
fn create_collection_rejects_duplicate_names() {
    let (env, admin, client) = setup();
    let name = String::from_str(&env, "genesis");

    client.create_collection(&admin, &name, &500);

    let result = client.try_create_collection(&admin, &name, &500);
    assert!(
        result.is_err(),
        "registering the same collection name twice must fail"
    );
}

#[test]
fn minting_into_a_registered_collection_increments_its_item_count() {
    let (env, admin, client) = setup();
    let name = String::from_str(&env, "genesis");
    client.create_collection(&admin, &name, &500);

    assert_eq!(client.get_collection(&name).item_count, 0);

    client.mint_nft(
        &admin,
        &sample_metadata(&env, &admin, "genesis", 200),
        &None,
    );
    assert_eq!(client.get_collection(&name).item_count, 1);

    client.mint_nft(
        &admin,
        &sample_metadata(&env, &admin, "genesis", 200),
        &None,
    );
    assert_eq!(client.get_collection(&name).item_count, 2);
}

#[test]
fn minting_into_an_unregistered_category_does_not_fail_and_touches_no_collection() {
    let (env, admin, client) = setup();

    // No panic/error minting with a category that was never registered.
    let token_id = client.mint_nft(
        &admin,
        &sample_metadata(&env, &admin, "unregistered", 0),
        &None,
    );
    assert!(client.get_nft_owner(&token_id) == admin);
}

#[test]
fn balance_of_and_token_uri_match_owned_nfts_and_metadata() {
    let (env, admin, client) = setup();
    let metadata = sample_metadata(&env, &admin, "art", 100);

    assert_eq!(client.balance_of(&admin), 0);

    let token_id = client.mint_nft(&admin, &metadata, &None);

    assert_eq!(client.balance_of(&admin), 1);
    assert_eq!(client.token_uri(&token_id), metadata.image_url);
}

// --- Trading rebates (#916) ---

fn setup_with_traders() -> (Env, VirtualEconomyContractClient<'static>, Address, Address) {
    let (env, _admin, client) = setup();
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);
    client.mint_currency(&buyer, &1_000_000, &String::from_str(&env, "seed"));
    (env, client, seller, buyer)
}

fn list_and_sell(
    env: &Env,
    client: &VirtualEconomyContractClient<'static>,
    seller: &Address,
    buyer: &Address,
    price: i128,
) {
    let metadata = sample_metadata(env, seller, "art", 0);
    let token_id = client.mint_nft(seller, &metadata, &None);
    let order_id =
        client.create_marketplace_order(seller, &MarketplaceAsset::NFT(token_id), &price, &None);
    client.execute_marketplace_trade(buyer, &order_id);
}

#[test]
fn a_completed_trade_accrues_volume_for_both_buyer_and_seller() {
    let (env, client, seller, buyer) = setup_with_traders();
    assert_eq!(client.get_trader_volume(&buyer), 0);
    assert_eq!(client.get_trader_volume(&seller), 0);

    list_and_sell(&env, &client, &seller, &buyer, 10_000);

    assert_eq!(client.get_trader_volume(&buyer), 10_000);
    assert_eq!(client.get_trader_volume(&seller), 10_000);
}

#[test]
fn rebate_tier_rises_with_accrued_volume() {
    let (env, client, seller, buyer) = setup_with_traders();
    client.configure_rebates(&1_000, &10_000, &100_000, &(30 * 24 * 60 * 60));

    assert_eq!(client.get_rebate_tier_bps(&buyer), 0);

    list_and_sell(&env, &client, &seller, &buyer, 1_000); // tier 1
    assert_eq!(client.get_rebate_tier_bps(&buyer), 100);

    list_and_sell(&env, &client, &seller, &buyer, 9_000); // cumulative 10_000 -> tier 2
    assert_eq!(client.get_rebate_tier_bps(&buyer), 200);

    list_and_sell(&env, &client, &seller, &buyer, 90_000); // cumulative 100_000 -> tier 3
    assert_eq!(client.get_rebate_tier_bps(&buyer), 500);
}

#[test]
fn monthly_rebate_run_pays_tiered_amount_and_resets_volume() {
    let (env, client, seller, buyer) = setup_with_traders();
    client.configure_rebates(&1_000, &10_000, &100_000, &(30 * 24 * 60 * 60));

    list_and_sell(&env, &client, &seller, &buyer, 20_000); // both sides clear tier 2 (2%)

    let balance_before = client.get_currency_balance(&buyer);
    let paid = client.calculate_monthly_rebates();
    assert_eq!(paid, 2); // both buyer and seller accrued 20_000 volume

    let expected_rebate = 20_000 * 200 / 10_000;
    assert_eq!(
        client.get_currency_balance(&buyer),
        balance_before + expected_rebate
    );
    assert_eq!(client.get_trader_volume(&buyer), 0);

    let history = client.get_rebate_history(&buyer);
    assert_eq!(history.len(), 1);
    assert_eq!(history.get(0).unwrap().amount, expected_rebate);
}

#[test]
fn monthly_rebate_run_rejects_before_the_period_elapses() {
    let (env, client, seller, buyer) = setup_with_traders();
    client.configure_rebates(&1_000, &10_000, &100_000, &(30 * 24 * 60 * 60));
    list_and_sell(&env, &client, &seller, &buyer, 5_000);

    client.calculate_monthly_rebates();

    list_and_sell(&env, &client, &seller, &buyer, 5_000);
    let result = client.try_calculate_monthly_rebates();
    assert!(
        result.is_err(),
        "a second run inside the same period must fail"
    );
}

// --- NFT Burn tests (#1057) ---

#[test]
fn test_burn_owned_nft_succeeds() {
    let (env, admin, client) = setup();
    let metadata = sample_metadata(&env, &admin, "art", 100);
    let token_id = client.mint_nft(&admin, &metadata, &None);

    assert_eq!(client.balance_of(&admin), 1);
    assert_eq!(client.get_economy_analytics().total_nfts_burned, 0);

    client.burn_nft(&admin, &token_id);

    assert_eq!(client.balance_of(&admin), 0);
    assert_eq!(client.get_economy_analytics().total_nfts_burned, 1);
    assert!(client.try_get_nft_owner(&token_id).is_err());
    assert!(client.try_get_nft_metadata(&token_id).is_err());
}

#[test]
fn test_burn_staked_nft_fails() {
    let (env, admin, client) = setup();
    client.configure_nft_staking(&NftStakeConfig {
        reward_rate_bps: 100,
        reward_interval: 3600,
        min_lock_period: 86400,
        paused: false,
    });

    let metadata = sample_metadata(&env, &admin, "art", 100);
    let token_id = client.mint_nft(&admin, &metadata, &None);

    client.stake_nft(&admin, &token_id);

    let res = client.try_burn_nft(&admin, &token_id);
    assert_eq!(res, Err(Ok(VirtualEconomyError::NftCurrentlyStaked)));
}

#[test]
fn test_burn_listed_nft_auto_cancels_order() {
    let (env, admin, client) = setup();
    let metadata = sample_metadata(&env, &admin, "art", 100);
    let token_id = client.mint_nft(&admin, &metadata, &None);

    let order_id = client.create_marketplace_order(
        &admin,
        &MarketplaceAsset::NFT(token_id.clone()),
        &1000,
        &None,
    );
    assert_eq!(client.get_economy_analytics().active_orders, 1);
    assert_eq!(
        client.get_marketplace_order(&order_id).status,
        OrderStatus::Active
    );

    client.burn_nft(&admin, &token_id);

    assert_eq!(
        client.get_marketplace_order(&order_id).status,
        OrderStatus::Cancelled
    );
    assert_eq!(client.get_economy_analytics().active_orders, 0);
    assert_eq!(client.get_economy_analytics().total_nfts_burned, 1);
    assert_eq!(client.balance_of(&admin), 0);
}
