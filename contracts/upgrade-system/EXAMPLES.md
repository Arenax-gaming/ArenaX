# Upgrade System Examples

This document provides practical examples of using the Upgrade System in various scenarios.

## Table of Contents

1. [Basic Upgrade Flow](#basic-upgrade-flow)
2. [Emergency Scenarios](#emergency-scenarios)
3. [Integration Examples](#integration-examples)
4. [Testing Examples](#testing-examples)

## Basic Upgrade Flow

### Example 1: Feature Upgrade

Upgrading the match contract to add a new matchmaking algorithm.

```rust
use soroban_sdk::{Env, Address, BytesN, String};

// Step 1: Propose the upgrade
let proposal_id = generate_proposal_id(&env, 1);
let match_contract_addr = Address::from_string(&String::from_str(
    &env,
    "CAXXX...MATCH",
));
let new_wasm_hash = BytesN::from_array(&env, &[/* hash bytes */]);

upgrade_system.propose_upgrade(
    governance_addr.clone(),
    proposal_id.clone(),
    match_contract_addr.clone(),
    new_wasm_hash.clone(),
    UpgradeType::Feature as u32,
    48 * 60 * 60,  // 48 hours timelock
    String::from_str(&env, "Add Elo-based matchmaking algorithm"),
);

// Step 2: Validate the upgrade
let security_issues: Vec<String> = Vec::new(&env);

upgrade_system.validate_upgrade(
    validator_addr.clone(),
    proposal_id.clone(),
    92,     // 92% compatibility
    false,  // No breaking changes
    security_issues,
);

// Step 3: Approve the upgrade (3 approvers)
let sig_hash_1 = BytesN::from_array(&env, &[/* signature 1 */]);
upgrade_system.approve_upgrade(
    approver_1.clone(),
    proposal_id.clone(),
    sig_hash_1,
);

let sig_hash_2 = BytesN::from_array(&env, &[/* signature 2 */]);
upgrade_system.approve_upgrade(
    approver_2.clone(),
    proposal_id.clone(),
    sig_hash_2,
);

let sig_hash_3 = BytesN::from_array(&env, &[/* signature 3 */]);
upgrade_system.approve_upgrade(
    approver_3.clone(),
    proposal_id.clone(),
    sig_hash_3,
);

// Step 4: Wait for timelock (48 hours)
// ... time passes ...

// Step 5: Execute the upgrade
upgrade_system.execute_upgrade(
    executor_addr.clone(),
    proposal_id.clone(),
);

// Step 6: Verify execution
let proposal = upgrade_system.get_proposal(proposal_id.clone()).unwrap();
assert_eq!(proposal.status, UpgradeStatus::Executed as u32);
```

### Example 2: Security Patch

Quick security patch with expedited approval.

```rust
// Propose security upgrade
let proposal_id = generate_proposal_id(&env, 2);

upgrade_system.propose_upgrade(
    governance_addr.clone(),
    proposal_id.clone(),
    escrow_contract_addr.clone(),
    security_patch_hash.clone(),
    UpgradeType::Security as u32,
    24 * 60 * 60,  // 24 hours (minimum)
    String::from_str(&env, "Fix critical vulnerability in fund withdrawal"),
);

// Fast-track validation
upgrade_system.validate_upgrade(
    validator_addr.clone(),
    proposal_id.clone(),
    95,     // High compatibility
    false,  // No breaking changes
    Vec::new(&env),  // No security issues
);

// Rapid approval process
for approver in approvers.iter() {
    let sig_hash = generate_signature(&env, &approver, &proposal_id);
    upgrade_system.approve_upgrade(
        approver.clone(),
        proposal_id.clone(),
        sig_hash,
    );
}

// Execute after timelock
upgrade_system.execute_upgrade(
    executor_addr.clone(),
    proposal_id.clone(),
);
```

### Example 3: Bug Fix

Minor bug fix with standard process.

```rust
// Propose bug fix
let proposal_id = generate_proposal_id(&env, 3);

upgrade_system.propose_upgrade(
    governance_addr.clone(),
    proposal_id.clone(),
    tournament_contract_addr.clone(),
    bugfix_wasm_hash.clone(),
    UpgradeType::BugFix as u32,
    24 * 60 * 60,  // 24 hours
    String::from_str(&env, "Fix tournament bracket generation edge case"),
);

// Validate
upgrade_system.validate_upgrade(
    validator_addr.clone(),
    proposal_id.clone(),
    98,     // Very compatible
    false,
    Vec::new(&env),
);

// Approve and execute
// ... approval process ...
upgrade_system.execute_upgrade(executor_addr, proposal_id);
```

## Emergency Scenarios

### Example 4: Emergency Pause

Immediate pause due to critical exploit.

```rust
// Detect exploit
let exploit_detected = true;

if exploit_detected {
    // Immediately pause the contract
    upgrade_system.emergency_pause(
        admin_addr.clone(),
        vulnerable_contract_addr.clone(),
        String::from_str(&env, "Critical exploit detected in fund transfer logic"),
    );
    
    // Verify pause
    let state = upgrade_system.get_emergency_state(vulnerable_contract_addr.clone());
    assert!(state.is_paused);
    
    // Notify users
    notify_users("System temporarily paused for security");
    
    // Prepare fix
    let fix_wasm = prepare_security_fix();
    
    // Deploy fix via upgrade system
    let proposal_id = generate_proposal_id(&env, 999);
    upgrade_system.propose_upgrade(
        governance_addr.clone(),
        proposal_id.clone(),
        vulnerable_contract_addr.clone(),
        calculate_wasm_hash(&fix_wasm),
        UpgradeType::Security as u32,
        6 * 60 * 60,  // 6 hours (expedited)
        String::from_str(&env, "Emergency security fix"),
    );
    
    // Fast-track approval
    // ... rapid approval process ...
    
    // Execute fix
    upgrade_system.execute_upgrade(executor_addr, proposal_id);
    
    // Unpause
    upgrade_system.unpause_contract(
        admin_addr.clone(),
        vulnerable_contract_addr.clone(),
    );
}
```

### Example 5: Rollback Failed Upgrade

Rollback after discovering issues post-upgrade.

```rust
// Execute upgrade
let proposal_id = generate_proposal_id(&env, 5);
// ... upgrade process ...
upgrade_system.execute_upgrade(executor_addr.clone(), proposal_id.clone());

// Monitor for issues
let issues_detected = monitor_contract_health(&match_contract_addr);

if issues_detected {
    // Pause immediately
    upgrade_system.emergency_pause(
        admin_addr.clone(),
        match_contract_addr.clone(),
        String::from_str(&env, "Performance degradation detected"),
    );
    
    // Rollback to previous version
    upgrade_system.rollback_upgrade(
        admin_addr.clone(),
        match_contract_addr.clone(),
        String::from_str(&env, "Rollback due to performance issues"),
    );
    
    // Unpause
    upgrade_system.unpause_contract(
        admin_addr.clone(),
        match_contract_addr.clone(),
    );
    
    // Investigate and prepare new fix
    investigate_issues();
}
```

## Integration Examples

### Example 6: Backend Integration

Complete backend integration with monitoring.

```rust
use actix_web::{web, App, HttpServer};
use tokio::time::{interval, Duration};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Initialize upgrade service
    let upgrade_service = UpgradeService::new(
        "https://horizon-testnet.stellar.org",
        upgrade_system_addr,
        governance_addr,
    );
    
    // Start event monitoring
    tokio::spawn(async move {
        upgrade_service.monitor_upgrades().await.unwrap();
    });
    
    // Start health checks
    tokio::spawn(async move {
        let mut interval = interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            check_contract_health().await;
        }
    });
    
    // Start API server
    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(upgrade_service.clone()))
            .route("/api/upgrades/proposals", web::get().to(list_proposals))
            .route("/api/upgrades/proposals/{id}", web::get().to(get_proposal))
            .route("/api/upgrades/history/{contract}", web::get().to(get_history))
    })
    .bind(("127.0.0.1", 8080))?
    .run()
    .await
}

async fn check_contract_health() {
    // Check each critical contract
    for contract_addr in CRITICAL_CONTRACTS.iter() {
        let state = upgrade_service.get_emergency_state(contract_addr).await;
        
        if state.is_paused {
            alert_admins(&format!("Contract {} is paused: {}", 
                contract_addr, 
                state.reason.unwrap_or_default()
            ));
        }
        
        // Check performance metrics
        let metrics = get_contract_metrics(contract_addr).await;
        if metrics.error_rate > 0.05 {
            alert_admins(&format!("High error rate on {}", contract_addr));
        }
    }
}
```

### Example 7: Frontend Notification System

Real-time upgrade notifications in the frontend.

```typescript
import { useEffect, useState } from 'react';
import { useUpgradeSystem } from '@/hooks/useUpgradeSystem';

export function UpgradeNotifications() {
  const [notifications, setNotifications] = useState([]);
  const { subscribeToEvents } = useUpgradeSystem();
  
  useEffect(() => {
    const unsubscribe = subscribeToEvents({
      onUpgradeProposed: (event) => {
        addNotification({
          type: 'info',
          title: 'Upgrade Proposed',
          message: `New upgrade proposed for ${event.contract}`,
          timestamp: Date.now(),
        });
      },
      
      onUpgradeScheduled: (event) => {
        addNotification({
          type: 'warning',
          title: 'Upgrade Scheduled',
          message: `Upgrade will execute at ${new Date(event.scheduled_at * 1000).toLocaleString()}`,
          timestamp: Date.now(),
        });
      },
      
      onUpgradeExecuted: (event) => {
        addNotification({
          type: 'success',
          title: 'Upgrade Completed',
          message: `Contract ${event.contract} has been upgraded`,
          timestamp: Date.now(),
        });
      },
      
      onEmergencyPause: (event) => {
        addNotification({
          type: 'error',
          title: 'Emergency Maintenance',
          message: event.reason,
          timestamp: Date.now(),
          persistent: true,
        });
      },
    });
    
    return () => unsubscribe();
  }, []);
  
  const addNotification = (notification) => {
    setNotifications(prev => [notification, ...prev].slice(0, 10));
  };
  
  return (
    <div className="notifications">
      {notifications.map((notif, i) => (
        <Notification key={i} {...notif} />
      ))}
    </div>
  );
}
```

## Testing Examples

### Example 8: Unit Tests

Comprehensive unit tests for upgrade flow.

```rust
#[test]
fn test_complete_upgrade_flow() {
    let (env, governance, proposer, validator) = create_test_env();
    
    // Initialize
    UpgradeSystem::initialize(
        env.clone(),
        governance.clone(),
        24 * 60 * 60,
        3,
        2,
    ).unwrap();
    
    // Propose
    let proposal_id = generate_proposal_id(&env, 1);
    let contract_addr = Address::generate(&env);
    let wasm_hash = generate_wasm_hash(&env, 1);
    
    env.mock_all_auths();
    
    UpgradeSystem::propose_upgrade(
        env.clone(),
        governance.clone(),
        proposal_id.clone(),
        contract_addr.clone(),
        wasm_hash,
        UpgradeType::Feature as u32,
        24 * 60 * 60,
        String::from_str(&env, "Test upgrade"),
    ).unwrap();
    
    // Validate
    UpgradeSystem::validate_upgrade(
        env.clone(),
        governance.clone(),
        proposal_id.clone(),
        85,
        false,
        Vec::new(&env),
    ).unwrap();
    
    // Approve (3 times)
    for i in 0..3 {
        let approver = Address::generate(&env);
        let sig_hash = generate_wasm_hash(&env, i + 100);
        
        UpgradeSystem::approve_upgrade(
            env.clone(),
            governance.clone(),
            proposal_id.clone(),
            sig_hash,
        ).unwrap();
    }
    
    // Check scheduled
    let proposal = UpgradeSystem::get_proposal(env.clone(), proposal_id.clone()).unwrap();
    assert_eq!(proposal.status, UpgradeStatus::Scheduled as u32);
    
    // Advance time past timelock
    env.ledger().with_mut(|li| {
        li.timestamp = proposal.timelock_end + 1;
    });
    
    // Execute
    UpgradeSystem::execute_upgrade(
        env.clone(),
        governance.clone(),
        proposal_id.clone(),
    ).unwrap();
    
    // Verify
    let proposal = UpgradeSystem::get_proposal(env.clone(), proposal_id.clone()).unwrap();
    assert_eq!(proposal.status, UpgradeStatus::Executed as u32);
    
    // Check history
    let history = UpgradeSystem::get_upgrade_history(env.clone(), contract_addr);
    assert_eq!(history.len(), 1);
}

#[test]
fn test_emergency_pause_and_rollback() {
    let (env, governance, _, _) = create_test_env();
    
    UpgradeSystem::initialize(
        env.clone(),
        governance.clone(),
        24 * 60 * 60,
        3,
        2,
    ).unwrap();
    
    let contract_addr = Address::generate(&env);
    
    env.mock_all_auths();
    
    // Pause
    UpgradeSystem::emergency_pause(
        env.clone(),
        governance.clone(),
        contract_addr.clone(),
        String::from_str(&env, "Test emergency"),
    ).unwrap();
    
    // Verify paused
    let state = UpgradeSystem::get_emergency_state(env.clone(), contract_addr.clone());
    assert!(state.is_paused);
    
    // Unpause
    UpgradeSystem::unpause_contract(
        env.clone(),
        governance.clone(),
        contract_addr.clone(),
    ).unwrap();
    
    // Verify unpaused
    let state = UpgradeSystem::get_emergency_state(env.clone(), contract_addr);
    assert!(!state.is_paused);
}
```

### Example 9: Integration Tests

End-to-end integration tests.

```rust
#[test]
fn test_integration_with_governance() {
    let env = Env::default();
    
    // Deploy governance multisig
    let governance_id = env.register_contract_wasm(None, governance_wasm());
    let governance = GovernanceMultisigClient::new(&env, &governance_id);
    
    // Initialize governance
    let signers = vec![
        &env,
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];
    governance.initialize(&signers, &2);
    
    // Deploy upgrade system
    let upgrade_id = env.register_contract_wasm(None, upgrade_system_wasm());
    let upgrade_system = UpgradeSystemClient::new(&env, &upgrade_id);
    
    // Initialize upgrade system
    upgrade_system.initialize(
        &governance_id,
        &(24 * 60 * 60),
        &2,
        &2,
    );
    
    // Create upgrade proposal via governance
    let proposal_id = generate_proposal_id(&env, 1);
    let target_contract = Address::generate(&env);
    let wasm_hash = generate_wasm_hash(&env, 1);
    
    env.mock_all_auths();
    
    // Governance creates proposal
    governance.create_proposal(
        &proposal_id,
        &upgrade_id,
        &Symbol::new(&env, "propose_upgrade"),
        &(
            governance_id.clone(),
            proposal_id.clone(),
            target_contract,
            wasm_hash,
            UpgradeType::Feature as u32,
            24 * 60 * 60u64,
            String::from_str(&env, "Test"),
        ),
        &None,
    );
    
    // Approve in governance
    governance.approve(&signers.get(0).unwrap(), &proposal_id);
    governance.approve(&signers.get(1).unwrap(), &proposal_id);
    
    // Execute governance proposal (which calls upgrade system)
    governance.execute(&signers.get(0).unwrap(), &proposal_id);
    
    // Verify upgrade proposal created
    let upgrade_proposal = upgrade_system.get_proposal(&proposal_id);
    assert!(upgrade_proposal.is_ok());
}
```

## Best Practices

1. **Always test on testnet first**
2. **Use appropriate timelock durations**
3. **Validate thoroughly before approval**
4. **Monitor after execution**
5. **Have rollback plan ready**
6. **Communicate with users**
7. **Document all changes**
8. **Keep audit trail**

## Common Patterns

### Pattern 1: Gradual Rollout

```rust
// Phase 1: Deploy to testnet
deploy_to_testnet();

// Phase 2: Test thoroughly
run_integration_tests();

// Phase 3: Deploy to mainnet with long timelock
propose_with_long_timelock(7 * 24 * 60 * 60);  // 7 days

// Phase 4: Monitor and be ready to rollback
monitor_and_prepare_rollback();
```

### Pattern 2: Feature Flags

```rust
// Include feature flags in upgrade
let new_wasm_with_flags = build_with_feature_flags(&[
    ("new_matchmaking", false),  // Disabled by default
]);

// After upgrade, gradually enable
enable_feature_flag("new_matchmaking", 0.1);  // 10% of users
// ... monitor ...
enable_feature_flag("new_matchmaking", 1.0);  // 100% of users
```

### Pattern 3: Canary Deployment

```rust
// Deploy to canary contract first
let canary_addr = deploy_canary_contract();
upgrade_system.propose_upgrade(/* canary upgrade */);

// Monitor canary
monitor_canary(canary_addr, Duration::from_days(3));

// If successful, upgrade main contract
if canary_successful {
    upgrade_system.propose_upgrade(/* main upgrade */);
}
```

## Troubleshooting

### Issue: Validation Fails

```rust
// Check validation result
let validation = upgrade_system.get_validation(proposal_id).unwrap();

if !validation.is_valid {
    if validation.breaking_changes {
        // Fix breaking changes
        fix_breaking_changes();
    }
    
    if !validation.security_issues.is_empty() {
        // Address security issues
        for issue in validation.security_issues.iter() {
            fix_security_issue(issue);
        }
    }
    
    if validation.compatibility_score < 70 {
        // Improve compatibility
        improve_compatibility();
    }
}
```

### Issue: Timelock Not Expired

```rust
let proposal = upgrade_system.get_proposal(proposal_id).unwrap();
let current_time = env.ledger().timestamp();

if current_time < proposal.timelock_end {
    let remaining = proposal.timelock_end - current_time;
    println!("Wait {} seconds before execution", remaining);
}
```

## Additional Resources

- [Main README](./README.md)
- [Integration Guide](./INTEGRATION_GUIDE.md)
- [API Documentation](https://docs.arenax.gg/upgrade-system)
- [GitHub Repository](https://github.com/arenax/arenax)
