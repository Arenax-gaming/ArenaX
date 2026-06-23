#![cfg(test)]
extern crate std;

use super::*;
use dispute_resolution::DisputeResolutionContractClient;
use match_contract::MatchContractClient;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{StellarAssetClient, TokenClient as SdkTokenClient},
    Address, BytesN, Env, String, Symbol,
};

// Mock Identity Contract for dispute resolution and match operator roles
#[contract]
pub struct MockIdentityContract;

#[contractimpl]
impl MockIdentityContract {
    pub fn get_role(_env: Env, _user: Address) -> u32 {
        2 // Admin/Operator role
    }
}

struct TestContext {
    env: Env,
    admin: Address,
    creator: Address,
    player_a: Address,
    player_b: Address,
    winner_1: Address,
    winner_2: Address,
    winner_3: Address,
    token_address: Address,
    match_client: MatchContractClient<'static>,
    dispute_client: DisputeResolutionContractClient<'static>,
    prize_client: PrizeDistributionContractClient<'static>,
}

fn setup_test() -> TestContext {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);
    let winner_1 = Address::generate(&env);
    let winner_2 = Address::generate(&env);
    let winner_3 = Address::generate(&env);

    // 1. Setup Mock Token
    let token_address = env.register_stellar_asset_contract_v2(admin.clone()).address();

    // 2. Setup Match Contract
    let match_id = env.register(match_contract::MatchContract, ());
    let match_client = MatchContractClient::new(&env, &match_id);

    // 3. Setup Dispute Resolution Contract
    let dispute_id = env.register(dispute_resolution::DisputeResolutionContract, ());
    let dispute_client = DisputeResolutionContractClient::new(&env, &dispute_id);
    let identity_id = env.register(MockIdentityContract, ());
    dispute_client.initialize(&admin, &identity_id, &3600u64);

    // 4. Setup Prize Distribution Contract
    let prize_id = env.register(PrizeDistributionContract, ());
    let prize_client = PrizeDistributionContractClient::new(&env, &prize_id);
    prize_client.initialize(&admin, &match_id, &dispute_id);

    // Mint tokens to creator
    let token_client = StellarAssetClient::new(&env, &token_address);
    token_client.mint(&creator, &100000i128);

    TestContext {
        env,
        admin,
        creator,
        player_a,
        player_b,
        winner_1,
        winner_2,
        winner_3,
        token_address,
        match_client,
        dispute_client,
        prize_client,
    }
}

fn generate_match_id(env: &Env, id: u8) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[0] = id;
    BytesN::from_array(env, &bytes)
}

#[test]
fn test_initialize_success() {
    let ctx = setup_test();
    assert_eq!(ctx.prize_client.get_admin(), ctx.admin);
    assert!(!ctx.prize_client.is_paused());
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice_fails() {
    let ctx = setup_test();
    ctx.prize_client.initialize(&ctx.admin, &ctx.admin, &ctx.admin);
}

#[test]
fn test_create_pool_success() {
    let ctx = setup_test();
    let match_id = generate_match_id(&ctx.env, 1);

    // Create match in MatchContract first
    ctx.match_client.create_match(&match_id, &ctx.player_a, &ctx.player_b);

    let amount = 1000i128;
    let pool_id = ctx.prize_client.create_pool(
        &ctx.creator,
        &match_id,
        &ctx.token_address,
        &amount,
    );

    assert_eq!(pool_id, 1);
    assert!(ctx.prize_client.pool_exists(&pool_id));

    let pool = ctx.prize_client.get_pool(&pool_id);
    assert_eq!(pool.pool_id, 1);
    assert_eq!(pool.amount_locked, amount);
    assert_eq!(pool.match_id, match_id);
    assert_eq!(pool.asset, ctx.token_address);
    assert_eq!(pool.state, PoolState::Locked as u32);

    // Verify creator's tokens are locked in the contract
    let token_sdk = SdkTokenClient::new(&ctx.env, &ctx.token_address);
    assert_eq!(token_sdk.balance(&ctx.prize_client.address), amount);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_create_pool_invalid_amount_fails() {
    let ctx = setup_test();
    let match_id = generate_match_id(&ctx.env, 1);
    ctx.match_client.create_match(&match_id, &ctx.player_a, &ctx.player_b);

    ctx.prize_client.create_pool(
        &ctx.creator,
        &match_id,
        &ctx.token_address,
        &0,
    );
}

#[test]
fn test_distribute_single_winner_success() {
    let ctx = setup_test();
    let match_id = generate_match_id(&ctx.env, 1);

    // Setup match and pool
    ctx.match_client.create_match(&match_id, &ctx.player_a, &ctx.player_b);
    let amount = 5000i128;
    let pool_id = ctx.prize_client.create_pool(
        &ctx.creator,
        &match_id,
        &ctx.token_address,
        &amount,
    );

    // Distribute all to player_a
    let mut winners = Vec::new(&ctx.env);
    winners.push_back(ctx.player_a.clone());

    let mut weights = Vec::new(&ctx.env);
    weights.push_back(10000u32); // 100%

    ctx.prize_client.distribute(&ctx.admin, &pool_id, &winners, &weights);

    // Check pool state
    let pool = ctx.prize_client.get_pool(&pool_id);
    assert_eq!(pool.state, PoolState::Distributed as u32);
    assert_eq!(pool.weights.get(0).unwrap(), 10000);

    // Check balances
    let token_sdk = SdkTokenClient::new(&ctx.env, &ctx.token_address);
    assert_eq!(token_sdk.balance(&ctx.prize_client.address), 0);
    assert_eq!(token_sdk.balance(&ctx.player_a), amount);
}

#[test]
fn test_distribute_multiple_winners_success() {
    let ctx = setup_test();
    let match_id = generate_match_id(&ctx.env, 1);

    // Setup match and pool
    ctx.match_client.create_match(&match_id, &ctx.player_a, &ctx.player_b);
    let amount = 10000i128;
    let pool_id = ctx.prize_client.create_pool(
        &ctx.creator,
        &match_id,
        &ctx.token_address,
        &amount,
    );

    // Distribute to 3 winners: 50%, 30%, 20%
    let mut winners = Vec::new(&ctx.env);
    winners.push_back(ctx.winner_1.clone());
    winners.push_back(ctx.winner_2.clone());
    winners.push_back(ctx.winner_3.clone());

    let mut weights = Vec::new(&ctx.env);
    weights.push_back(5000u32); // 50%
    weights.push_back(3000u32); // 30%
    weights.push_back(2000u32); // 20%

    ctx.prize_client.distribute(&ctx.admin, &pool_id, &winners, &weights);

    // Check balances
    let token_sdk = SdkTokenClient::new(&ctx.env, &ctx.token_address);
    assert_eq!(token_sdk.balance(&ctx.winner_1), 5000i128);
    assert_eq!(token_sdk.balance(&ctx.winner_2), 3000i128);
    assert_eq!(token_sdk.balance(&ctx.winner_3), 2000i128);
    assert_eq!(token_sdk.balance(&ctx.prize_client.address), 0);
}

#[test]
fn test_distribute_rounding_adjustment() {
    let ctx = setup_test();
    let match_id = generate_match_id(&ctx.env, 1);

    // Setup match and pool
    ctx.match_client.create_match(&match_id, &ctx.player_a, &ctx.player_b);
    
    // Amount is 1003 tokens (cannot be split cleanly 33.33%, 33.33%, 33.34%)
    let amount = 1003i128;
    let pool_id = ctx.prize_client.create_pool(
        &ctx.creator,
        &match_id,
        &ctx.token_address,
        &amount,
    );

    // Distribute to 3 winners: 33.33%, 33.33%, 33.34%
    let mut winners = Vec::new(&ctx.env);
    winners.push_back(ctx.winner_1.clone());
    winners.push_back(ctx.winner_2.clone());
    winners.push_back(ctx.winner_3.clone());

    let mut weights = Vec::new(&ctx.env);
    weights.push_back(3333u32);
    weights.push_back(3333u32);
    weights.push_back(3334u32);

    ctx.prize_client.distribute(&ctx.admin, &pool_id, &winners, &weights);

    // 1003 * 3333 / 10000 = 334.29 -> 334
    // Winner 1: 334
    // Winner 2: 334
    // Winner 3 gets the remainder: 1003 - (334 + 334) = 335
    let token_sdk = SdkTokenClient::new(&ctx.env, &ctx.token_address);
    assert_eq!(token_sdk.balance(&ctx.winner_1), 334i128);
    assert_eq!(token_sdk.balance(&ctx.winner_2), 334i128);
    assert_eq!(token_sdk.balance(&ctx.winner_3), 335i128);
    assert_eq!(token_sdk.balance(&ctx.prize_client.address), 0);
}

#[test]
#[should_panic(expected = "weights must sum to 10000")]
fn test_distribute_invalid_weights_sum_fails() {
    let ctx = setup_test();
    let match_id = generate_match_id(&ctx.env, 1);
    ctx.match_client.create_match(&match_id, &ctx.player_a, &ctx.player_b);
    let pool_id = ctx.prize_client.create_pool(&ctx.creator, &match_id, &ctx.token_address, &1000);

    let mut winners = Vec::new(&ctx.env);
    winners.push_back(ctx.winner_1.clone());
    winners.push_back(ctx.winner_2.clone());

    let mut weights = Vec::new(&ctx.env);
    weights.push_back(5000u32);
    weights.push_back(4999u32); // Sum is 9999

    ctx.prize_client.distribute(&ctx.admin, &pool_id, &winners, &weights);
}

#[test]
#[should_panic(expected = "unauthorized caller")]
fn test_distribute_unauthorized_caller_fails() {
    let ctx = setup_test();
    let match_id = generate_match_id(&ctx.env, 1);
    ctx.match_client.create_match(&match_id, &ctx.player_a, &ctx.player_b);
    let pool_id = ctx.prize_client.create_pool(&ctx.creator, &match_id, &ctx.token_address, &1000);

    let mut winners = Vec::new(&ctx.env);
    winners.push_back(ctx.player_a.clone());

    let mut weights = Vec::new(&ctx.env);
    weights.push_back(10000u32);

    let random_caller = Address::generate(&ctx.env);
    ctx.prize_client.distribute(&random_caller, &pool_id, &winners, &weights);
}

#[test]
fn test_distribute_blocked_by_dispute() {
    let ctx = setup_test();
    let match_id = generate_match_id(&ctx.env, 1);
    ctx.match_client.create_match(&match_id, &ctx.player_a, &ctx.player_b);
    let pool_id = ctx.prize_client.create_pool(&ctx.creator, &match_id, &ctx.token_address, &1000);

    // Open a dispute in DisputeResolutionContract
    let reason = String::from_str(&ctx.env, "Cheated");
    let evidence = String::from_str(&ctx.env, "ipfs://some-proof");
    ctx.dispute_client.open_dispute(&match_id, &reason, &evidence);

    let mut winners = Vec::new(&ctx.env);
    winners.push_back(ctx.player_a.clone());
    let mut weights = Vec::new(&ctx.env);
    weights.push_back(10000u32);

    // Call distribute. It should auto-transition to Held, and then panic.
    let result = ctx.env.as_contract(&ctx.prize_client.address, || {
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            ctx.prize_client.distribute(&ctx.admin, &pool_id, &winners, &weights);
        }));
        assert!(res.is_err());
    });

    // Verify state is Held
    let pool = ctx.prize_client.get_pool(&pool_id);
    assert_eq!(pool.state, PoolState::Held as u32);
}

#[test]
fn test_manual_hold_and_release() {
    let ctx = setup_test();
    let match_id = generate_match_id(&ctx.env, 1);
    ctx.match_client.create_match(&match_id, &ctx.player_a, &ctx.player_b);
    let pool_id = ctx.prize_client.create_pool(&ctx.creator, &match_id, &ctx.token_address, &1000);

    // Admin holds the payout manually
    ctx.prize_client.hold_payout(&ctx.admin, &pool_id);
    let pool = ctx.prize_client.get_pool(&pool_id);
    assert_eq!(pool.state, PoolState::Held as u32);

    // Releasing payout immediately is allowed because the match is not disputed
    ctx.prize_client.release_payout(&pool_id);
    let pool = ctx.prize_client.get_pool(&pool_id);
    assert_eq!(pool.state, PoolState::Locked as u32);
}

#[test]
fn test_resolve_dispute_and_release_success() {
    let ctx = setup_test();
    let match_id = generate_match_id(&ctx.env, 1);
    ctx.match_client.create_match(&match_id, &ctx.player_a, &ctx.player_b);
    let pool_id = ctx.prize_client.create_pool(&ctx.creator, &match_id, &ctx.token_address, &1000);

    // Open a dispute
    let reason = String::from_str(&ctx.env, "Collusion");
    let evidence = String::from_str(&ctx.env, "ipfs://evidence");
    ctx.dispute_client.open_dispute(&match_id, &reason, &evidence);

    // Payout hold
    ctx.prize_client.hold_payout(&ctx.admin, &pool_id);

    // Try to release - should panic because still disputed
    let release_res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        ctx.prize_client.release_payout(&pool_id);
    }));
    assert!(release_res.is_err());

    // Resolve dispute in DisputeResolution
    let decision = String::from_str(&ctx.env, "resolved");
    ctx.dispute_client.resolve_dispute(&match_id, &ctx.admin, &decision);

    // Release payout
    ctx.prize_client.release_payout(&pool_id);
    let pool = ctx.prize_client.get_pool(&pool_id);
    assert_eq!(pool.state, PoolState::Locked as u32);

    // Distribute successfully
    let mut winners = Vec::new(&ctx.env);
    winners.push_back(ctx.player_b.clone());
    let mut weights = Vec::new(&ctx.env);
    weights.push_back(10000u32);

    ctx.prize_client.distribute(&ctx.admin, &pool_id, &winners, &weights);
    let pool = ctx.prize_client.get_pool(&pool_id);
    assert_eq!(pool.state, PoolState::Distributed as u32);
}
