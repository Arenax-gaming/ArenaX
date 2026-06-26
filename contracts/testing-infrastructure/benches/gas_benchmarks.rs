/// Gas optimization benchmarks for ArenaX contracts
use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, token::StellarAssetClient};
use match_contract::{MatchContract, MatchContractClient};
use staking_manager::{StakingManager, StakingManagerClient};

// Benchmark match creation gas costs
fn bench_match_creation(c: &mut Criterion) {
    let mut group = c.benchmark_group("match_creation");
    
    for num_matches in [1, 10].iter() {
        group.bench_with_input(
            BenchmarkId::from_parameter(num_matches),
            num_matches,
            |b, &num_matches| {
                b.iter(|| {
                    let env = Env::default();
                    env.mock_all_auths();
                    
                    let contract_id = env.register(MatchContract, ());
                    let client = MatchContractClient::new(&env, &contract_id);
                    
                    for i in 0..num_matches {
                        let match_id = BytesN::from_array(&env, &[i as u8; 32]);
                        let player_a = Address::generate(&env);
                        let player_b = Address::generate(&env);
                        
                        client.create_match(&match_id, &player_a, &player_b);
                        
                        // Measure gas
                        let cpu_cost = env.budget().cpu_instruction_cost();
                        let mem_cost = env.budget().memory_bytes_cost();
                        
                        black_box((cpu_cost, mem_cost));
                    }
                });
            },
        );
    }
    
    group.finish();
}

// Benchmark full match lifecycle
fn bench_match_lifecycle(c: &mut Criterion) {
    c.bench_function("match_lifecycle", |b| {
        b.iter(|| {
            let env = Env::default();
            env.mock_all_auths();
            env.ledger().set_timestamp(1000);
            
            let contract_id = env.register(MatchContract, ());
            let client = MatchContractClient::new(&env, &contract_id);
            let match_id = BytesN::from_array(&env, &[0u8; 32]);
            let player_a = Address::generate(&env);
            let player_b = Address::generate(&env);
            
            // Full lifecycle
            client.create_match(&match_id, &player_a, &player_b);
            client.start_match(&match_id);
            env.ledger().set_timestamp(2000);
            client.complete_match(&match_id, &player_a);
            
            let cpu_cost = env.budget().cpu_instruction_cost();
            black_box(cpu_cost);
        });
    });
}

// Benchmark staking operations
fn bench_staking_operations(c: &mut Criterion) {
    let mut group = c.benchmark_group("staking_operations");
    
    let operations = vec!["stake_for_rewards", "claim_rewards", "unstake_rewards"];
    
    for operation in operations {
        group.bench_function(operation, |b| {
            b.iter(|| {
                let env = Env::default();
                env.mock_all_auths();
                env.ledger().set_timestamp(1000);
                
                let admin = Address::generate(&env);
                let contract_id = env.register_contract(&Address::generate(&env), StakingManager);
                let client = StakingManagerClient::new(&env, &contract_id);
                let ax_token = env.register_stellar_asset_contract_v2(admin.clone());
                let ax_token_client = StellarAssetClient::new(&env, &ax_token.address());
                
                client.initialize(&admin, &ax_token.address());
                
                let user = Address::generate(&env);
                let amount = 10000i128;
                ax_token_client.mint(&user, &amount);
                
                match operation {
                    "stake_for_rewards" => {
                        client.stake_for_rewards(&user, &(amount / 2));
                    }
                    "claim_rewards" => {
                        client.stake_for_rewards(&user, &(amount / 2));
                        env.ledger().set_timestamp(31537000);
                        let _ = client.claim_rewards(&user);
                    }
                    "unstake_rewards" => {
                        client.stake_for_rewards(&user, &(amount / 2));
                        client.unstake_rewards(&user);
                    }
                    _ => {}
                }
                
                let cpu_cost = env.budget().cpu_instruction_cost();
                black_box(cpu_cost);
            });
        });
    }
    
    group.finish();
}

// Benchmark storage operations
fn bench_storage_operations(c: &mut Criterion) {
    let mut group = c.benchmark_group("storage_operations");
    
    for data_size in [32, 256, 1024].iter() {
        group.bench_with_input(
            BenchmarkId::from_parameter(data_size),
            data_size,
            |b, &data_size| {
                b.iter(|| {
                    let env = Env::default();
                    env.mock_all_auths();
                    
                    // Test storage write/read with varying data sizes
                    let _data = vec![0u8; data_size];
                    
                    let mem_cost = env.budget().memory_bytes_cost();
                    black_box(mem_cost);
                });
            },
        );
    }
    
    group.finish();
}

// Benchmark dispute resolution
fn bench_dispute_resolution(c: &mut Criterion) {
    c.bench_function("dispute_resolution", |b| {
        b.iter(|| {
            let env = Env::default();
            env.mock_all_auths();
            env.ledger().set_timestamp(1000);
            
            let match_contract_id = env.register(MatchContract, ());
            let match_client = MatchContractClient::new(&env, &match_contract_id);
            let identity_contract_id = env.register(crate::MockIdentityContract, ());
            
            let match_id = BytesN::from_array(&env, &[0u8; 32]);
            let player_a = Address::generate(&env);
            let player_b = Address::generate(&env);
            let resolver = Address::generate(&env);
            
            match_client.create_match(&match_id, &player_a, &player_b);
            match_client.start_match(&match_id);
            match_client.raise_dispute(&match_id);
            env.ledger().set_timestamp(2000);
            match_client.resolve_dispute(&match_id, &player_a, &identity_contract_id, &resolver);
            
            let cpu_cost = env.budget().cpu_instruction_cost();
            black_box(cpu_cost);
        });
    });
}

// Mock contract for testing
#[soroban_sdk::contract]
pub struct MockIdentityContract;
#[soroban_sdk::contractimpl]
impl MockIdentityContract {
    pub fn get_role(_env: Env, _user: Address) -> u32 {
        2
    }
}

criterion_group!(
    benches,
    bench_match_creation,
    bench_match_lifecycle,
    bench_staking_operations,
    bench_storage_operations,
    bench_dispute_resolution
);

criterion_main!(benches);
