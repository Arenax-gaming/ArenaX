use soroban_sdk::{Address, Env, String, token};
use escrow::{EscrowContract, EscrowContractClient};

/// Comprehensive usage example for ArenaX Escrow Contract
/// This example demonstrates a complete tournament escrow workflow

pub fn tournament_escrow_workflow_example(env: &Env) {
    // Step 1: Setup
    let admin = Address::generate(env);
    let arbitrator = Address::generate(env);
    let tournament_organizer = Address::generate(env);
    let participant1 = Address::generate(env);
    let participant2 = Address::generate(env);
    let participant3 = Address::generate(env);
    
    // Create escrow contract
    let escrow_client = EscrowContractClient::new(env, &env.register_contract(None, EscrowContract));
    
    // Create token contract
    let token_client = create_token_contract(env, &admin);
    
    // Initialize escrow contract
    escrow_client.initialize(&admin);
    escrow_client.add_arbitrator(&admin, &arbitrator);
    
    // Step 2: Tournament Setup
    let entry_fee = 1000i128;
    let tournament_duration = 86400u64; // 1 day
    let auto_release_time = env.ledger().timestamp() + tournament_duration + 3600; // +1 hour buffer
    let dispute_timeout = 86400u64; // 1 day
    let release_conditions = String::from_str(env, "Tournament completion and winner determination");
    
    // Step 3: Participants Register and Create Escrows
    let mut escrow_ids = Vec::new(env);
    
    // Participant 1 registers
    let escrow_id1 = escrow_client.create_escrow(
        &participant1,
        &tournament_organizer, // Prize pool goes to organizer who distributes to winners
        &arbitrator,
        &entry_fee,
        &token_client.address,
        &release_conditions,
        &dispute_timeout,
        &auto_release_time,
    );
    escrow_ids.push_back(escrow_id1);
    
    // Participant 2 registers
    let escrow_id2 = escrow_client.create_escrow(
        &participant2,
        &tournament_organizer,
        &arbitrator,
        &entry_fee,
        &token_client.address,
        &release_conditions,
        &dispute_timeout,
        &auto_release_time,
    );
    escrow_ids.push_back(escrow_id2);
    
    // Participant 3 registers
    let escrow_id3 = escrow_client.create_escrow(
        &participant3,
        &tournament_organizer,
        &arbitrator,
        &entry_fee,
        &token_client.address,
        &release_conditions,
        &dispute_timeout,
        &auto_release_time,
    );
    escrow_ids.push_back(escrow_id3);
    
    // Step 4: Participants Deposit Entry Fees
    // Mint tokens to participants
    token_client.mint(&participant1, &entry_fee);
    token_client.mint(&participant2, &entry_fee);
    token_client.mint(&participant3, &entry_fee);
    
    // Participants deposit funds
    escrow_client.deposit_funds(&escrow_id1, &participant1);
    escrow_client.deposit_funds(&escrow_id2, &participant2);
    escrow_client.deposit_funds(&escrow_id3, &participant3);
    
    // Verify all escrows are funded
    assert_eq!(escrow_client.get_escrow_state(escrow_id1), 1); // Funded
    assert_eq!(escrow_client.get_escrow_state(escrow_id2), 1); // Funded
    assert_eq!(escrow_client.get_escrow_state(escrow_id3), 1); // Funded
    
    // Step 5: Tournament Proceeds (Simulated)
    // Tournament starts and completes successfully
    
    // Step 6: Tournament Completion - Release Funds
    // Organizer releases funds for prize distribution
    escrow_client.release_funds(&escrow_id1, &tournament_organizer);
    escrow_client.release_funds(&escrow_id2, &tournament_organizer);
    escrow_client.release_funds(&escrow_id3, &tournament_organizer);
    
    // Verify funds released
    assert_eq!(escrow_client.get_escrow_state(escrow_id1), 3); // Released
    assert_eq!(escrow_client.get_escrow_state(escrow_id2), 3); // Released
    assert_eq!(escrow_client.get_escrow_state(escrow_id3), 3); // Released
}

pub fn dispute_resolution_example(env: &Env) {
    // Step 1: Setup
    let admin = Address::generate(env);
    let arbitrator = Address::generate(env);
    let participant = Address::generate(env);
    let tournament_organizer = Address::generate(env);
    
    let escrow_client = EscrowContractClient::new(env, &env.register_contract(None, EscrowContract));
    let token_client = create_token_contract(env, &admin);
    
    escrow_client.initialize(&admin);
    escrow_client.add_arbitrator(&admin, &arbitrator);
    
    // Step 2: Create and Fund Escrow
    let entry_fee = 1000i128;
    let auto_release_time = env.ledger().timestamp() + 86400;
    let dispute_timeout = 86400;
    let release_conditions = String::from_str(env, "Tournament completion");
    
    let escrow_id = escrow_client.create_escrow(
        &participant,
        &tournament_organizer,
        &arbitrator,
        &entry_fee,
        &token_client.address,
        &release_conditions,
        &dispute_timeout,
        &auto_release_time,
    );
    
    token_client.mint(&participant, &entry_fee);
    escrow_client.deposit_funds(&escrow_id, &participant);
    
    // Step 3: Dispute Scenario - Tournament Cancelled
    let dispute_reason = String::from_str(env, "Tournament was cancelled by organizer");
    escrow_client.raise_dispute(&escrow_id, &participant, &dispute_reason);
    
    assert_eq!(escrow_client.get_escrow_state(escrow_id), 2); // Disputed
    assert_eq!(escrow_client.get_escrow_dispute_status(escrow_id), 1); // Pending
    
    // Step 4: Arbitrator Resolution
    let arbitration_reason = String::from_str(env, "Tournament cancellation confirmed - full refund warranted");
    escrow_client.resolve_dispute(
        &escrow_id,
        &arbitrator,
        &1u32, // Favor depositor (full refund)
        &entry_fee, // depositor amount
        &0i128, // beneficiary amount
        &arbitration_reason,
    );
    
    // Verify resolution
    assert_eq!(escrow_client.get_escrow_state(escrow_id), 4); // Refunded
    assert_eq!(escrow_client.get_escrow_dispute_status(escrow_id), 2); // Resolved
    assert_eq!(token_client.balance(&participant), entry_fee); // Participant got refund
}

pub fn auto_release_example(env: &Env) {
    // Step 1: Setup
    let admin = Address::generate(env);
    let arbitrator = Address::generate(env);
    let participant = Address::generate(env);
    let tournament_organizer = Address::generate(env);
    
    let escrow_client = EscrowContractClient::new(env, &env.register_contract(None, EscrowContract));
    let token_client = create_token_contract(env, &admin);
    
    escrow_client.initialize(&admin);
    escrow_client.add_arbitrator(&admin, &arbitrator);
    
    // Step 2: Create Escrow with Short Auto-Release Time
    let entry_fee = 1000i128;
    let auto_release_time = env.ledger().timestamp() + 100; // Very short time
    let dispute_timeout = 86400;
    let release_conditions = String::from_str(env, "Auto-release after tournament completion");
    
    let escrow_id = escrow_client.create_escrow(
        &participant,
        &tournament_organizer,
        &arbitrator,
        &entry_fee,
        &token_client.address,
        &release_conditions,
        &dispute_timeout,
        &auto_release_time,
    );
    
    token_client.mint(&participant, &entry_fee);
    escrow_client.deposit_funds(&escrow_id, &participant);
    
    // Step 3: Fast Forward Time
    env.ledger().set_timestamp(env.ledger().timestamp() + 200);
    
    // Step 4: Check Auto-Release Eligibility
    assert!(escrow_client.is_eligible_for_auto_release(escrow_id));
    
    // Step 5: Trigger Auto-Release
    escrow_client.check_auto_release(&escrow_id);
    
    // Verify auto-release
    assert_eq!(escrow_client.get_escrow_state(escrow_id), 3); // Released
    assert_eq!(token_client.balance(&tournament_organizer), entry_fee); // Organizer got funds
}

pub fn emergency_recovery_example(env: &Env) {
    // Step 1: Setup
    let admin = Address::generate(env);
    let arbitrator = Address::generate(env);
    let participant = Address::generate(env);
    let tournament_organizer = Address::generate(env);
    let recovery_address = Address::generate(env);
    
    let escrow_client = EscrowContractClient::new(env, &env.register_contract(None, EscrowContract));
    let token_client = create_token_contract(env, &admin);
    
    escrow_client.initialize(&admin);
    escrow_client.add_arbitrator(&admin, &arbitrator);
    
    // Step 2: Create and Fund Escrow
    let entry_fee = 1000i128;
    let auto_release_time = env.ledger().timestamp() + 86400;
    let dispute_timeout = 86400;
    let release_conditions = String::from_str(env, "Normal tournament completion");
    
    let escrow_id = escrow_client.create_escrow(
        &participant,
        &tournament_organizer,
        &arbitrator,
        &entry_fee,
        &token_client.address,
        &release_conditions,
        &dispute_timeout,
        &auto_release_time,
    );
    
    token_client.mint(&participant, &entry_fee);
    escrow_client.deposit_funds(&escrow_id, &participant);
    
    // Step 3: Emergency Recovery Scenario
    // In case of critical issues (e.g., arbitrator compromised, contract bugs)
    escrow_client.emergency_recovery(&escrow_id, &admin, &recovery_address);
    
    // Verify emergency recovery
    assert_eq!(escrow_client.get_escrow_state(escrow_id), 5); // Cancelled
    assert_eq!(token_client.balance(&recovery_address), entry_fee); // Recovery address got funds
}

pub fn multi_arbitrator_example(env: &Env) {
    // Step 1: Setup Multiple Arbitrators
    let admin = Address::generate(env);
    let arbitrator1 = Address::generate(env);
    let arbitrator2 = Address::generate(env);
    let arbitrator3 = Address::generate(env);
    
    let escrow_client = EscrowContractClient::new(env, &env.register_contract(None, EscrowContract));
    
    escrow_client.initialize(&admin);
    
    // Add multiple arbitrators
    escrow_client.add_arbitrator(&admin, &arbitrator1);
    escrow_client.add_arbitrator(&admin, &arbitrator2);
    escrow_client.add_arbitrator(&admin, &arbitrator3);
    
    // Verify arbitrators added
    let arbitrators = escrow_client.get_arbitrators();
    assert_eq!(arbitrators.len(), 3);
    
    // Remove one arbitrator
    escrow_client.remove_arbitrator(&admin, &arbitrator2);
    
    // Verify arbitrator removed
    let arbitrators = escrow_client.get_arbitrators();
    assert_eq!(arbitrators.len(), 2);
}

fn create_token_contract(env: &Env, admin: &Address) -> token::Client {
    let token_address = env.register_stellar_asset_contract(admin.clone());
    token::Client::new(env, &token_address)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tournament_escrow_workflow() {
        let env = Env::default();
        tournament_escrow_workflow_example(&env);
    }

    #[test]
    fn test_dispute_resolution() {
        let env = Env::default();
        dispute_resolution_example(&env);
    }

    #[test]
    fn test_auto_release() {
        let env = Env::default();
        auto_release_example(&env);
    }

    #[test]
    fn test_emergency_recovery() {
        let env = Env::default();
        emergency_recovery_example(&env);
    }

    #[test]
    fn test_multi_arbitrator() {
        let env = Env::default();
        multi_arbitrator_example(&env);
    }
}
