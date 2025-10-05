//! Tests for the ArenaX Staking Contract

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _, Events as _},
    token, Address, Env, String, Vec,
};

// Mock token contract for testing
use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum TokenError {
    InsufficientBalance = 1,
    Unauthorized = 2,
}

#[contract]
pub struct TestToken;

#[contractimpl]
impl TestToken {
    pub fn initialize(env: Env, admin: Address, decimal: u32, name: String, symbol: String) {
        env.storage().instance().set(&String::from_str(&env, "admin"), &admin);
        env.storage().instance().set(&String::from_str(&env, "decimal"), &decimal);
        env.storage().instance().set(&String::from_str(&env, "name"), &name);
        env.storage().instance().set(&String::from_str(&env, "symbol"), &symbol);
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let admin: Address = env.storage().instance().get(&String::from_str(&env, "admin")).unwrap();
        admin.require_auth();

        let balance_key = String::from_str(&env, &format!("balance_{}", to));
        let balance: i128 = env.storage().instance().get(&balance_key).unwrap_or(0);
        env.storage().instance().set(&balance_key, &(balance + amount));
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        let balance_key = String::from_str(&env, &format!("balance_{}", id));
        env.storage().instance().get(&balance_key).unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();

        let from_balance_key = String::from_str(&env, &format!("balance_{}", from));
        let to_balance_key = String::from_str(&env, &format!("balance_{}", to));

        let from_balance: i128 = env.storage().instance().get(&from_balance_key).unwrap_or(0);
        if from_balance < amount {
            panic!("Insufficient balance");
        }

        let to_balance: i128 = env.storage().instance().get(&to_balance_key).unwrap_or(0);

        env.storage().instance().set(&from_balance_key, &(from_balance - amount));
        env.storage().instance().set(&to_balance_key, &(to_balance + amount));
    }

    pub fn approve(_env: Env, _from: Address, _spender: Address, _amount: i128) {
        // Simplified approve for testing
    }

    pub fn allowance(_env: Env, _from: Address, _spender: Address) -> i128 {
        i128::MAX
    }
}

fn create_test_setup() -> (Env, Address, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    // Deploy test token
    let token_id = env.register(TestToken, ());
    let token_client = TestTokenClient::new(&env, &token_id);
    token_client.initialize(
        &admin,
        &7,
        &String::from_str(&env, "ArenaX Token"),
        &String::from_str(&env, "ARENAX"),
    );

    // Mint tokens to users
    token_client.mint(&user1, &10_000 * 10_000_000); // 10,000 tokens with 7 decimals
    token_client.mint(&user2, &5_000 * 10_000_000);  // 5,000 tokens with 7 decimals

    // Deploy staking contract
    let staking_id = env.register(StakingContract, ());

    (env, admin, user1, user2, token_id, staking_id)
}

#[test]
fn test_initialize() {
    let (env, admin, _user1, _user2, token_id, staking_id) = create_test_setup();
    let staking_client = StakingContractClient::new(&env, &staking_id);

    // Initialize the staking contract
    let result = staking_client.initialize(
        &admin,
        &token_id,
        &86400, // 1 day min voting period
        &2000,  // 20% default quorum
    );
    assert!(result.is_ok());

    // Verify config
    let config = staking_client.get_config().unwrap();
    assert_eq!(config.admin, admin);
    assert_eq!(config.token_address, token_id);
    assert_eq!(config.min_voting_period, 86400);
    assert_eq!(config.default_quorum, 2000);
    assert!(!config.is_paused);
}

#[test]
fn test_create_pool() {
    let (env, admin, _user1, _user2, token_id, staking_id) = create_test_setup();
    let staking_client = StakingContractClient::new(&env, &staking_id);

    // Initialize contract
    staking_client.initialize(&admin, &token_id, &86400, &2000).unwrap();

    // Create a staking pool
    let pool_id = staking_client.create_pool(
        &String::from_str(&env, "High Yield Pool"),
        &100 * 10_000_000, // 100 tokens minimum
        &0,                 // No maximum
        &1000,             // 10% APY
        &30 * 86400,       // 30 days lock period
        &0,                // No maximum total stake
        &1000,             // 10% early withdrawal penalty
        &10000,            // 100% governance multiplier
    ).unwrap();

    assert_eq!(pool_id, 1);

    // Verify pool details
    let pool = staking_client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.pool_id, 1);
    assert_eq!(pool.min_stake, 100 * 10_000_000);
    assert_eq!(pool.apy, 1000);
    assert_eq!(pool.lock_period, 30 * 86400);
    assert!(pool.is_active);
}

#[test]
fn test_stake_tokens() {
    let (env, admin, user1, _user2, token_id, staking_id) = create_test_setup();
    let staking_client = StakingContractClient::new(&env, &staking_id);
    let token_client = TestTokenClient::new(&env, &token_id);

    // Initialize contract and create pool
    staking_client.initialize(&admin, &token_id, &86400, &2000).unwrap();
    let pool_id = staking_client.create_pool(
        &String::from_str(&env, "Test Pool"),
        &100 * 10_000_000,
        &0,
        &1000,
        &30 * 86400,
        &0,
        &1000,
        &10000,
    ).unwrap();

    // Check initial balance
    let initial_balance = token_client.balance(&user1);
    assert_eq!(initial_balance, 10_000 * 10_000_000);

    // Stake tokens
    let stake_amount = 500 * 10_000_000; // 500 tokens
    let result = staking_client.stake(&user1, &pool_id, &stake_amount);
    assert!(result.is_ok());

    // Verify stake
    let user_stake = staking_client.get_user_stake(&user1, &pool_id).unwrap();
    assert_eq!(user_stake.amount, stake_amount);
    assert_eq!(user_stake.staker, user1);
    assert_eq!(user_stake.pool_id, pool_id);

    // Verify pool total
    let pool = staking_client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.total_staked, stake_amount);

    // Verify token transfer
    let user_balance = token_client.balance(&user1);
    assert_eq!(user_balance, initial_balance - stake_amount);

    // Verify contract has tokens
    let contract_balance = token_client.balance(&staking_id);
    assert_eq!(contract_balance, stake_amount);
}

#[test]
fn test_stake_validation() {
    let (env, admin, user1, _user2, token_id, staking_id) = create_test_setup();
    let staking_client = StakingContractClient::new(&env, &staking_id);

    // Initialize contract and create pool with minimum stake requirement
    staking_client.initialize(&admin, &token_id, &86400, &2000).unwrap();
    let pool_id = staking_client.create_pool(
        &String::from_str(&env, "Test Pool"),
        &100 * 10_000_000, // 100 tokens minimum
        &1000 * 10_000_000, // 1000 tokens maximum
        &1000,
        &30 * 86400,
        &0,
        &1000,
        &10000,
    ).unwrap();

    // Test stake too low
    let result = staking_client.stake(&user1, &pool_id, &50 * 10_000_000);
    assert!(result.is_err());

    // Test stake too high
    let result = staking_client.stake(&user1, &pool_id, &1500 * 10_000_000);
    assert!(result.is_err());

    // Test valid stake
    let result = staking_client.stake(&user1, &pool_id, &500 * 10_000_000);
    assert!(result.is_ok());
}

#[test]
fn test_reward_calculation() {
    let (env, admin, user1, _user2, token_id, staking_id) = create_test_setup();
    let staking_client = StakingContractClient::new(&env, &staking_id);

    // Initialize contract and create pool
    staking_client.initialize(&admin, &token_id, &86400, &2000).unwrap();
    let pool_id = staking_client.create_pool(
        &String::from_str(&env, "Test Pool"),
        &100 * 10_000_000,
        &0,
        &1000, // 10% APY
        &30 * 86400,
        &0,
        &1000,
        &10000,
    ).unwrap();

    // Stake tokens
    let stake_amount = 1000 * 10_000_000; // 1000 tokens
    staking_client.stake(&user1, &pool_id, &stake_amount).unwrap();

    // Fast forward time (1 year)
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 365 * 24 * 3600;
    });

    // Check pending rewards
    let pending_rewards = staking_client.get_pending_rewards(&user1, &pool_id).unwrap();
    
    // Expected reward: 1000 tokens * 10% APY = 100 tokens (approximately)
    let expected_reward = 100 * 10_000_000; // 100 tokens
    let tolerance = 1 * 10_000_000; // 1 token tolerance
    
    assert!(
        (pending_rewards - expected_reward).abs() < tolerance,
        "Reward calculation incorrect. Expected: ~{}, Got: {}",
        expected_reward,
        pending_rewards
    );
}

#[test]
fn test_claim_rewards() {
    let (env, admin, user1, _user2, token_id, staking_id) = create_test_setup();
    let staking_client = StakingContractClient::new(&env, &staking_id);
    let token_client = TestTokenClient::new(&env, &token_id);

    // Setup
    staking_client.initialize(&admin, &token_id, &86400, &2000).unwrap();
    let pool_id = staking_client.create_pool(
        &String::from_str(&env, "Test Pool"),
        &100 * 10_000_000,
        &0,
        &3650, // 36.5% APY for easier calculation
        &30 * 86400,
        &0,
        &1000,
        &10000,
    ).unwrap();

    // Stake and fast forward
    let stake_amount = 1000 * 10_000_000;
    staking_client.stake(&user1, &pool_id, &stake_amount).unwrap();
    
    // Add rewards to contract (simulate reward pool)
    token_client.mint(&staking_id, &1000 * 10_000_000);

    // Fast forward 100 days
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 100 * 24 * 3600;
    });

    let initial_balance = token_client.balance(&user1);
    let rewards_claimed = staking_client.claim_rewards(&user1, &pool_id).unwrap();
    let final_balance = token_client.balance(&user1);

    // Verify rewards were transferred
    assert!(rewards_claimed > 0);
    assert!(final_balance > initial_balance);
    
    // Verify pending rewards reset
    let pending_after_claim = staking_client.get_pending_rewards(&user1, &pool_id).unwrap();
    assert_eq!(pending_after_claim, 0);
}

#[test]
fn test_compound_rewards() {
    let (env, admin, user1, _user2, token_id, staking_id) = create_test_setup();
    let staking_client = StakingContractClient::new(&env, &staking_id);
    let token_client = TestTokenClient::new(&env, &token_id);

    // Setup
    staking_client.initialize(&admin, &token_id, &86400, &2000).unwrap();
    let pool_id = staking_client.create_pool(
        &String::from_str(&env, "Test Pool"),
        &100 * 10_000_000,
        &0,
        &3650, // High APY for testing
        &30 * 86400,
        &0,
        &1000,
        &10000,
    ).unwrap();

    // Stake and enable compounding
    let stake_amount = 1000 * 10_000_000;
    staking_client.stake(&user1, &pool_id, &stake_amount).unwrap();
    staking_client.set_compound_rewards(&user1, &pool_id, &true).unwrap();

    // Add rewards to contract
    token_client.mint(&staking_id, &1000 * 10_000_000);

    // Fast forward and compound
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 100 * 24 * 3600;
    });

    let initial_stake = staking_client.get_user_stake(&user1, &pool_id).unwrap().amount;
    let compounded_amount = staking_client.compound_rewards(&user1, &pool_id).unwrap();
    let final_stake = staking_client.get_user_stake(&user1, &pool_id).unwrap().amount;

    // Verify stake increased by compounded amount
    assert!(compounded_amount > 0);
    assert_eq!(final_stake, initial_stake + compounded_amount);
}

#[test]
fn test_unstaking_with_lock_period() {
    let (env, admin, user1, _user2, token_id, staking_id) = create_test_setup();
    let staking_client = StakingContractClient::new(&env, &staking_id);

    // Setup with lock period
    staking_client.initialize(&admin, &token_id, &86400, &2000).unwrap();
    let pool_id = staking_client.create_pool(
        &String::from_str(&env, "Test Pool"),
        &100 * 10_000_000,
        &0,
        &1000,
        &30 * 86400, // 30 days lock
        &0,
        &1000, // 10% early withdrawal penalty
        &10000,
    ).unwrap();

    // Stake tokens
    let stake_amount = 500 * 10_000_000;
    staking_client.stake(&user1, &pool_id, &stake_amount).unwrap();

    // Request unstaking immediately
    staking_client.request_unstake(&user1, &pool_id, &stake_amount).unwrap();

    // Try to unstake before lock period ends - should fail
    let result = staking_client.unstake(&user1, &pool_id);
    assert!(result.is_err());

    // Fast forward past lock period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 31 * 24 * 3600; // 31 days
    });

    // Now unstaking should work
    let result = staking_client.unstake(&user1, &pool_id);
    assert!(result.is_ok());
}

#[test]
fn test_early_withdrawal_penalty() {
    let (env, admin, user1, _user2, token_id, staking_id) = create_test_setup();
    let staking_client = StakingContractClient::new(&env, &staking_id);
    let token_client = TestTokenClient::new(&env, &token_id);

    // Setup
    staking_client.initialize(&admin, &token_id, &86400, &2000).unwrap();
    let pool_id = staking_client.create_pool(
        &String::from_str(&env, "Test Pool"),
        &100 * 10_000_000,
        &0,
        &1000,
        &30 * 86400, // 30 days lock
        &0,
        &1000, // 10% penalty
        &10000,
    ).unwrap();

    // Enable emergency withdrawals
    // We'll create and execute an emergency proposal for this
    let proposal_id = staking_client.create_proposal(
        &admin,
        &String::from_str(&env, "Enable Emergency Withdrawal"),
        &String::from_str(&env, "Allow early withdrawals with penalty"),
        &86400,
        &ProposalType::Emergency,
        &Vec::from_slice(&env, &[3u8]), // Enable emergency withdrawal
    ).unwrap();

    // Vote on proposal
    staking_client.stake(&admin, &pool_id, &1000 * 10_000_000).unwrap(); // Give admin voting power
    staking_client.vote(&admin, &proposal_id, &true).unwrap();

    // Fast forward past voting period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 2 * 86400;
    });

    // Execute proposal
    staking_client.execute_proposal(&admin, &proposal_id).unwrap();

    // Now test early withdrawal
    let stake_amount = 500 * 10_000_000;
    staking_client.stake(&user1, &pool_id, &stake_amount).unwrap();

    let initial_balance = token_client.balance(&user1);
    
    staking_client.request_unstake(&user1, &pool_id, &stake_amount).unwrap();
    staking_client.unstake(&user1, &pool_id).unwrap();

    let final_balance = token_client.balance(&user1);
    let returned_amount = final_balance - initial_balance;

    // Should receive less than staked amount due to penalty
    let expected_penalty = stake_amount * 1000 / 10000; // 10% penalty
    let expected_return = stake_amount - expected_penalty;
    
    assert_eq!(returned_amount, expected_return);
}

#[test]
fn test_governance_proposal_creation() {
    let (env, admin, user1, _user2, token_id, staking_id) = create_test_setup();
    let staking_client = StakingContractClient::new(&env, &staking_id);

    // Setup
    staking_client.initialize(&admin, &token_id, &86400, &2000).unwrap();
    let pool_id = staking_client.create_pool(
        &String::from_str(&env, "Test Pool"),
        &100 * 10_000_000,
        &0,
        &1000,
        &30 * 86400,
        &0,
        &1000,
        &10000,
    ).unwrap();

    // Give user1 enough voting power
    staking_client.stake(&user1, &pool_id, &1000 * 10_000_000).unwrap();

    // Create proposal
    let proposal_id = staking_client.create_proposal(
        &user1,
        &String::from_str(&env, "Test Proposal"),
        &String::from_str(&env, "This is a test proposal"),
        &7 * 86400, // 7 days voting period
        &ProposalType::General,
        &Vec::new(&env),
    ).unwrap();

    assert_eq!(proposal_id, 1);

    // Verify proposal
    let proposal = staking_client.get_proposal(&proposal_id).unwrap();
    assert_eq!(proposal.proposer, user1);
    assert_eq!(proposal.status, ProposalStatus::Active);
}

#[test]
fn test_voting_on_proposal() {
    let (env, admin, user1, user2, token_id, staking_id) = create_test_setup();
    let staking_client = StakingContractClient::new(&env, &staking_id);

    // Setup
    staking_client.initialize(&admin, &token_id, &86400, &2000).unwrap();
    let pool_id = staking_client.create_pool(
        &String::from_str(&env, "Test Pool"),
        &100 * 10_000_000,
        &0,
        &1000,
        &30 * 86400,
        &0,
        &1000,
        &10000,
    ).unwrap();

    // Give users voting power
    staking_client.stake(&user1, &pool_id, &1000 * 10_000_000).unwrap();
    staking_client.stake(&user2, &pool_id, &500 * 10_000_000).unwrap();

    // Create proposal
    let proposal_id = staking_client.create_proposal(
        &user1,
        &String::from_str(&env, "Test Proposal"),
        &String::from_str(&env, "This is a test proposal"),
        &7 * 86400,
        &ProposalType::General,
        &Vec::new(&env),
    ).unwrap();

    // Vote on proposal
    staking_client.vote(&user1, &proposal_id, &true).unwrap();
    staking_client.vote(&user2, &proposal_id, &false).unwrap();

    // Verify votes
    let vote1 = staking_client.get_vote(&proposal_id, &user1).unwrap();
    let vote2 = staking_client.get_vote(&proposal_id, &user2).unwrap();

    assert!(vote1.vote_for);
    assert!(!vote2.vote_for);
    assert_eq!(vote1.voting_power, 1000 * 10_000_000);
    assert_eq!(vote2.voting_power, 500 * 10_000_000);

    // Verify proposal vote counts
    let proposal = staking_client.get_proposal(&proposal_id).unwrap();
    assert_eq!(proposal.votes_for, 1000 * 10_000_000);
    assert_eq!(proposal.votes_against, 500 * 10_000_000);
}

#[test]
fn test_slashing() {
    let (env, admin, user1, _user2, token_id, staking_id) = create_test_setup();
    let staking_client = StakingContractClient::new(&env, &staking_id);

    // Setup
    staking_client.initialize(&admin, &token_id, &86400, &2000).unwrap();
    let pool_id = staking_client.create_pool(
        &String::from_str(&env, "Test Pool"),
        &100 * 10_000_000,
        &0,
        &1000,
        &30 * 86400,
        &0,
        &1000,
        &10000,
    ).unwrap();

    // Stake tokens
    let stake_amount = 1000 * 10_000_000;
    staking_client.stake(&user1, &pool_id, &stake_amount).unwrap();

    let initial_stake = staking_client.get_user_stake(&user1, &pool_id).unwrap();
    let initial_reputation = initial_stake.reputation_multiplier;

    // Slash user
    let slash_amount = 100 * 10_000_000; // 10% slash
    let result = staking_client.slash_user(
        &admin,
        &user1,
        &pool_id,
        &slash_amount,
        &String::from_str(&env, "Malicious behavior"),
    );
    assert!(result.is_ok());

    // Verify slash effects
    let final_stake = staking_client.get_user_stake(&user1, &pool_id).unwrap();
    assert_eq!(final_stake.amount, initial_stake.amount - slash_amount);
    assert!(final_stake.reputation_multiplier < initial_reputation);

    // Verify pool total updated
    let pool = staking_client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.total_staked, stake_amount - slash_amount);
}

#[test]
fn test_mass_slashing() {
    let (env, admin, user1, user2, token_id, staking_id) = create_test_setup();
    let staking_client = StakingContractClient::new(&env, &staking_id);

    // Setup
    staking_client.initialize(&admin, &token_id, &86400, &2000).unwrap();
    let pool_id = staking_client.create_pool(
        &String::from_str(&env, "Test Pool"),
        &100 * 10_000_000,
        &0,
        &1000,
        &30 * 86400,
        &0,
        &1000,
        &10000,
    ).unwrap();

    // Both users stake
    staking_client.stake(&user1, &pool_id, &1000 * 10_000_000).unwrap();
    staking_client.stake(&user2, &pool_id, &500 * 10_000_000).unwrap();

    // Prepare slash data
    let slash_data = Vec::from_slice(
        &env,
        &[
            (user1.clone(), pool_id, 100 * 10_000_000, String::from_str(&env, "Violation 1")),
            (user2.clone(), pool_id, 50 * 10_000_000, String::from_str(&env, "Violation 2")),
        ],
    );

    // Mass slash
    let result = staking_client.mass_slash(&admin, &slash_data);
    assert!(result.is_ok());

    // Verify both users were slashed
    let user1_stake = staking_client.get_user_stake(&user1, &pool_id).unwrap();
    let user2_stake = staking_client.get_user_stake(&user2, &pool_id).unwrap();

    assert_eq!(user1_stake.amount, 900 * 10_000_000); // 1000 - 100
    assert_eq!(user2_stake.amount, 450 * 10_000_000); // 500 - 50
}

#[test]  
fn test_event_emission() {
    let (env, admin, user1, _user2, token_id, staking_id) = create_test_setup();
    let staking_client = StakingContractClient::new(&env, &staking_id);

    // Setup
    staking_client.initialize(&admin, &token_id, &86400, &2000).unwrap();
    let pool_id = staking_client.create_pool(
        &String::from_str(&env, "Test Pool"),
        &100 * 10_000_000,
        &0,
        &1000,
        &30 * 86400,
        &0,
        &1000,
        &10000,
    ).unwrap();

    // Clear any existing events
    env.events().all();

    // Stake tokens
    staking_client.stake(&user1, &pool_id, &500 * 10_000_000).unwrap();

    // Check events
    let events = env.events().all();
    assert!(!events.is_empty());

    // Verify staking event was emitted
    let staking_events: Vec<_> = events
        .iter()
        .filter(|e| e.topics.contains(&soroban_sdk::symbol_short!("stake_event")))
        .collect();
    
    assert!(!staking_events.is_empty());
}

#[test]
fn test_contract_pause_functionality() {
    let (env, admin, user1, _user2, token_id, staking_id) = create_test_setup();
    let staking_client = StakingContractClient::new(&env, &staking_id);

    // Setup
    staking_client.initialize(&admin, &token_id, &86400, &2000).unwrap();
    let pool_id = staking_client.create_pool(
        &String::from_str(&env, "Test Pool"),
        &100 * 10_000_000,
        &0,
        &1000,
        &30 * 86400,
        &0,
        &1000,
        &10000,
    ).unwrap();

    // Stake to get voting power
    staking_client.stake(&admin, &pool_id, &1000 * 10_000_000).unwrap();

    // Create pause proposal
    let proposal_id = staking_client.create_proposal(
        &admin,
        &String::from_str(&env, "Emergency Pause"),
        &String::from_str(&env, "Pause the contract"),
        &86400,
        &ProposalType::Emergency,
        &Vec::from_slice(&env, &[1u8]), // Pause contract
    ).unwrap();

    // Vote and execute
    staking_client.vote(&admin, &proposal_id, &true).unwrap();
    
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 2 * 86400;
    });
    
    staking_client.execute_proposal(&admin, &proposal_id).unwrap();

    // Try to stake while paused - should fail
    let result = staking_client.stake(&user1, &pool_id, &500 * 10_000_000);
    assert!(result.is_err());

    // Verify contract is paused
    let config = staking_client.get_config().unwrap();
    assert!(config.is_paused);
}

#[test]
fn test_get_voting_power() {
    let (env, admin, user1, _user2, token_id, staking_id) = create_test_setup();
    let staking_client = StakingContractClient::new(&env, &staking_id);

    // Setup
    staking_client.initialize(&admin, &token_id, &86400, &2000).unwrap();
    let pool_id = staking_client.create_pool(
        &String::from_str(&env, "Test Pool"),
        &100 * 10_000_000,
        &0,
        &1000,
        &30 * 86400,
        &0,
        &1000,
        &10000,
    ).unwrap();

    // Initially no voting power
    let initial_power = staking_client.get_voting_power(&user1).unwrap();
    assert_eq!(initial_power, 0);

    // Stake tokens
    let stake_amount = 500 * 10_000_000;
    staking_client.stake(&user1, &pool_id, &stake_amount).unwrap();

    // Voting power should equal staked amount
    let voting_power = staking_client.get_voting_power(&user1).unwrap();
    assert_eq!(voting_power, stake_amount);
}