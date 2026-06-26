#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, Env, symbol_short};

#[test]
fn test_gas_benchmarks() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let _user2 = Address::generate(&env);

    let contract_id = env.register(ExampleContract, ());
    let client = ExampleContractClient::new(&env, &contract_id);

    // Initialize
    client.initialize(&admin);

    // Benchmark 1: Measure set_greeting (Persistent storage write)
    env.budget().reset_default();
    client.set_greeting(&user1, &symbol_short!("hello"));
    let cpu_write = env.budget().cpu_instruction_cost();
    let mem_write = env.budget().memory_bytes_cost();
    
    // Benchmark 2: Measure get_greeting (Persistent storage read)
    env.budget().reset_default();
    client.get_greeting(&user1);
    let cpu_read = env.budget().cpu_instruction_cost();
    let mem_read = env.budget().memory_bytes_cost();

    // Benchmark 3: Compare with instance storage read (get admin)
    env.budget().reset_default();
    client.admin();
    let cpu_instance = env.budget().cpu_instruction_cost();
    let mem_instance = env.budget().memory_bytes_cost();

    // Print gas cost report to stdout
    std::print!("\n");
    std::print!("===================================================\n");
    std::print!("          SOROBAN GAS BENCHMARK REPORT             \n");
    std::print!("===================================================\n");
    std::print!("Operation            | CPU Instructions | Memory Bytes\n");
    std::print!("---------------------|------------------|-------------\n");
    std::print!("Persistent Write     | {:<16} | {:<12}\n", cpu_write, mem_write);
    std::print!("Persistent Read      | {:<16} | {:<12}\n", cpu_read, mem_read);
    std::print!("Instance Read        | {:<16} | {:<12}\n", cpu_instance, mem_instance);
    std::print!("===================================================\n");
    std::print!("\n");

    // Assert that instance reads are generally cheaper than persistent reads/writes
    assert!(cpu_instance <= cpu_write, "Instance read should be more efficient than persistent write");
}
