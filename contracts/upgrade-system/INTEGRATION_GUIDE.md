# Upgrade System Integration Guide

This guide explains how to integrate the Upgrade System with other ArenaX contracts and the backend.

## Table of Contents

1. [Contract Integration](#contract-integration)
2. [Backend Integration](#backend-integration)
3. [Frontend Integration](#frontend-integration)
4. [Deployment](#deployment)
5. [Monitoring](#monitoring)

## Contract Integration

### Integrating with Governance Multisig

The Upgrade System works in conjunction with the Governance Multisig contract for authorization.

#### Step 1: Deploy Upgrade System

```rust
// Deploy upgrade system
let upgrade_system_addr = env.register_contract_wasm(None, upgrade_system_wasm);
let upgrade_client = UpgradeSystemClient::new(&env, &upgrade_system_addr);

// Initialize with governance address
upgrade_client.initialize(
    &governance_multisig_addr,
    &(24 * 60 * 60),  // 24 hour minimum timelock
    &3,               // 3 approvals required
    &2,               // 2 for emergency
);
```

#### Step 2: Grant Upgrade System Authority

```rust
// In governance multisig, add upgrade system as authorized contract
governance_client.add_authorized_contract(&upgrade_system_addr);
```

#### Step 3: Create Upgrade Proposal via Governance

```rust
// Governance creates proposal to upgrade a contract
let proposal_id = generate_proposal_id();
let target_contract = match_contract_addr;
let new_wasm_hash = calculate_wasm_hash(&new_wasm);

// Create governance proposal that calls upgrade system
let upgrade_args = (
    proposer_addr,
    proposal_id,
    target_contract,
    new_wasm_hash,
    UpgradeType::Feature as u32,
    48 * 60 * 60,  // 48 hours
    String::from_str(&env, "Add new feature"),
);

governance_client.create_proposal(
    &proposal_id,
    &upgrade_system_addr,
    &Symbol::new(&env, "propose_upgrade"),
    &upgrade_args,
    None,
);
```

### Making Contracts Upgradeable

To make a contract upgradeable, add upgrade checks:

```rust
use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    // Add upgrade system address to storage
    pub fn set_upgrade_system(env: Env, upgrade_system: Address) {
        env.storage().instance().set(&DataKey::UpgradeSystem, &upgrade_system);
    }
    
    // Check if contract is paused before critical operations
    fn check_not_paused(env: &Env) -> Result<(), Error> {
        let upgrade_system: Address = env.storage()
            .instance()
            .get(&DataKey::UpgradeSystem)
            .unwrap();
        
        let client = UpgradeSystemClient::new(env, &upgrade_system);
        let state = client.get_emergency_state(&env.current_contract_address());
        
        if state.is_paused {
            return Err(Error::ContractPaused);
        }
        
        Ok(())
    }
    
    // Use in critical functions
    pub fn critical_function(env: Env, /* params */) -> Result<(), Error> {
        Self::check_not_paused(&env)?;
        
        // Function logic
        Ok(())
    }
}
```

### Upgrade Notification System

Contracts can subscribe to upgrade events:

```rust
pub fn on_upgrade_proposed(
    env: Env,
    proposal_id: BytesN<32>,
    contract_address: Address,
) {
    // Check if this contract is being upgraded
    if contract_address == env.current_contract_address() {
        // Prepare for upgrade
        // - Finalize pending operations
        // - Notify users
        // - Lock critical functions
    }
}
```

## Backend Integration

### Rust Backend Integration

#### Add Dependencies

```toml
[dependencies]
stellar-sdk = "23.5.2"
tokio = { version = "1.0", features = ["full"] }
serde = { version = "1.0", features = ["derive"] }
```

#### Create Upgrade Service

```rust
use stellar_sdk::{Address, BytesN, SorobanClient};

pub struct UpgradeService {
    client: SorobanClient,
    upgrade_system_addr: Address,
    governance_addr: Address,
}

impl UpgradeService {
    pub fn new(
        network_url: &str,
        upgrade_system_addr: Address,
        governance_addr: Address,
    ) -> Self {
        let client = SorobanClient::new(network_url);
        Self {
            client,
            upgrade_system_addr,
            governance_addr,
        }
    }
    
    /// Propose a new upgrade
    pub async fn propose_upgrade(
        &self,
        proposer_secret: &str,
        contract_address: Address,
        new_wasm: Vec<u8>,
        upgrade_type: u32,
        description: String,
    ) -> Result<BytesN<32>, Error> {
        // Calculate WASM hash
        let wasm_hash = self.calculate_wasm_hash(&new_wasm);
        
        // Generate proposal ID
        let proposal_id = self.generate_proposal_id();
        
        // Call upgrade system
        let result = self.client.invoke_contract(
            &self.upgrade_system_addr,
            "propose_upgrade",
            vec![
                proposer_secret.into(),
                proposal_id.clone().into(),
                contract_address.into(),
                wasm_hash.into(),
                upgrade_type.into(),
                (48 * 60 * 60u64).into(),  // 48 hours
                description.into(),
            ],
        ).await?;
        
        Ok(proposal_id)
    }
    
    /// Get proposal status
    pub async fn get_proposal_status(
        &self,
        proposal_id: BytesN<32>,
    ) -> Result<UpgradeProposal, Error> {
        let result = self.client.invoke_contract(
            &self.upgrade_system_addr,
            "get_proposal",
            vec![proposal_id.into()],
        ).await?;
        
        Ok(result.try_into()?)
    }
    
    /// Monitor upgrade events
    pub async fn monitor_upgrades(&self) -> Result<(), Error> {
        let mut event_stream = self.client.stream_events(
            &self.upgrade_system_addr,
        ).await?;
        
        while let Some(event) = event_stream.next().await {
            match event.topic {
                ("upgrade", "proposed") => {
                    self.handle_upgrade_proposed(event).await?;
                }
                ("upgrade", "executed") => {
                    self.handle_upgrade_executed(event).await?;
                }
                ("emergenc", "pause") => {
                    self.handle_emergency_pause(event).await?;
                }
                _ => {}
            }
        }
        
        Ok(())
    }
    
    async fn handle_upgrade_proposed(&self, event: Event) -> Result<(), Error> {
        // Notify admins
        // Update database
        // Send notifications
        Ok(())
    }
    
    async fn handle_upgrade_executed(&self, event: Event) -> Result<(), Error> {
        // Update contract registry
        // Notify users
        // Update monitoring
        Ok(())
    }
    
    async fn handle_emergency_pause(&self, event: Event) -> Result<(), Error> {
        // Alert admins immediately
        // Disable affected features in backend
        // Notify users
        Ok(())
    }
}
```

#### Database Schema

```sql
-- Upgrade proposals table
CREATE TABLE upgrade_proposals (
    proposal_id BYTEA PRIMARY KEY,
    contract_address VARCHAR(56) NOT NULL,
    new_wasm_hash BYTEA NOT NULL,
    upgrade_type INTEGER NOT NULL,
    proposer VARCHAR(56) NOT NULL,
    status INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL,
    scheduled_at TIMESTAMP,
    executed_at TIMESTAMP,
    timelock_end TIMESTAMP NOT NULL,
    approval_count INTEGER NOT NULL,
    description TEXT NOT NULL,
    compatibility_score INTEGER,
    simulation_passed BOOLEAN
);

-- Upgrade history table
CREATE TABLE upgrade_history (
    id SERIAL PRIMARY KEY,
    upgrade_id BYTEA NOT NULL,
    contract_address VARCHAR(56) NOT NULL,
    old_wasm_hash BYTEA NOT NULL,
    new_wasm_hash BYTEA NOT NULL,
    upgrade_type INTEGER NOT NULL,
    executed_at TIMESTAMP NOT NULL,
    executed_by VARCHAR(56) NOT NULL,
    success BOOLEAN NOT NULL,
    FOREIGN KEY (upgrade_id) REFERENCES upgrade_proposals(proposal_id)
);

-- Emergency states table
CREATE TABLE emergency_states (
    contract_address VARCHAR(56) PRIMARY KEY,
    is_paused BOOLEAN NOT NULL,
    paused_at TIMESTAMP,
    paused_by VARCHAR(56),
    reason TEXT
);

-- Create indexes
CREATE INDEX idx_proposals_contract ON upgrade_proposals(contract_address);
CREATE INDEX idx_proposals_status ON upgrade_proposals(status);
CREATE INDEX idx_history_contract ON upgrade_history(contract_address);
CREATE INDEX idx_emergency_paused ON emergency_states(is_paused);
```

#### API Endpoints

```rust
use actix_web::{web, HttpResponse, Result};

// GET /api/upgrades/proposals
pub async fn list_proposals(
    upgrade_service: web::Data<UpgradeService>,
) -> Result<HttpResponse> {
    let proposals = upgrade_service.list_all_proposals().await?;
    Ok(HttpResponse::Ok().json(proposals))
}

// GET /api/upgrades/proposals/:id
pub async fn get_proposal(
    upgrade_service: web::Data<UpgradeService>,
    proposal_id: web::Path<String>,
) -> Result<HttpResponse> {
    let proposal = upgrade_service.get_proposal(&proposal_id).await?;
    Ok(HttpResponse::Ok().json(proposal))
}

// POST /api/upgrades/proposals
pub async fn create_proposal(
    upgrade_service: web::Data<UpgradeService>,
    req: web::Json<CreateProposalRequest>,
) -> Result<HttpResponse> {
    let proposal_id = upgrade_service.propose_upgrade(
        &req.proposer_secret,
        req.contract_address.clone(),
        req.new_wasm.clone(),
        req.upgrade_type,
        req.description.clone(),
    ).await?;
    
    Ok(HttpResponse::Created().json(proposal_id))
}

// GET /api/upgrades/history/:contract
pub async fn get_upgrade_history(
    upgrade_service: web::Data<UpgradeService>,
    contract_addr: web::Path<String>,
) -> Result<HttpResponse> {
    let history = upgrade_service.get_history(&contract_addr).await?;
    Ok(HttpResponse::Ok().json(history))
}

// POST /api/upgrades/emergency/pause
pub async fn emergency_pause(
    upgrade_service: web::Data<UpgradeService>,
    req: web::Json<EmergencyPauseRequest>,
) -> Result<HttpResponse> {
    upgrade_service.emergency_pause(
        &req.caller_secret,
        req.contract_address.clone(),
        req.reason.clone(),
    ).await?;
    
    Ok(HttpResponse::Ok().json({"status": "paused"}))
}
```

## Frontend Integration

### React/Next.js Integration

#### Create Upgrade Hook

```typescript
import { useSorobanReact } from '@soroban-react/core';
import { Contract, SorobanRpc } from 'stellar-sdk';

export function useUpgradeSystem() {
  const { server, activeChain } = useSorobanReact();
  const upgradeSystemAddress = process.env.NEXT_PUBLIC_UPGRADE_SYSTEM_ADDRESS;
  
  const getProposal = async (proposalId: string) => {
    const contract = new Contract(upgradeSystemAddress);
    const result = await server.getContractData(
      contract.address(),
      'get_proposal',
      [proposalId]
    );
    return result;
  };
  
  const getUpgradeHistory = async (contractAddress: string) => {
    const contract = new Contract(upgradeSystemAddress);
    const result = await server.getContractData(
      contract.address(),
      'get_upgrade_history',
      [contractAddress]
    );
    return result;
  };
  
  const getEmergencyState = async (contractAddress: string) => {
    const contract = new Contract(upgradeSystemAddress);
    const result = await server.getContractData(
      contract.address(),
      'get_emergency_state',
      [contractAddress]
    );
    return result;
  };
  
  return {
    getProposal,
    getUpgradeHistory,
    getEmergencyState,
  };
}
```

#### Upgrade Dashboard Component

```typescript
import React, { useEffect, useState } from 'react';
import { useUpgradeSystem } from '@/hooks/useUpgradeSystem';

export function UpgradeDashboard() {
  const { getUpgradeHistory } = useUpgradeSystem();
  const [history, setHistory] = useState([]);
  
  useEffect(() => {
    loadHistory();
  }, []);
  
  const loadHistory = async () => {
    const contractAddr = process.env.NEXT_PUBLIC_MATCH_CONTRACT_ADDRESS;
    const data = await getUpgradeHistory(contractAddr);
    setHistory(data);
  };
  
  return (
    <div className="upgrade-dashboard">
      <h2>Upgrade History</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Status</th>
            <th>Executed By</th>
          </tr>
        </thead>
        <tbody>
          {history.map((entry) => (
            <tr key={entry.upgrade_id}>
              <td>{new Date(entry.executed_at * 1000).toLocaleString()}</td>
              <td>{getUpgradeTypeName(entry.upgrade_type)}</td>
              <td>{entry.success ? 'Success' : 'Failed'}</td>
              <td>{entry.executed_by}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

#### Emergency Banner Component

```typescript
import React, { useEffect, useState } from 'react';
import { useUpgradeSystem } from '@/hooks/useUpgradeSystem';

export function EmergencyBanner() {
  const { getEmergencyState } = useUpgradeSystem();
  const [isPaused, setIsPaused] = useState(false);
  const [reason, setReason] = useState('');
  
  useEffect(() => {
    checkEmergencyState();
    const interval = setInterval(checkEmergencyState, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);
  
  const checkEmergencyState = async () => {
    const contractAddr = process.env.NEXT_PUBLIC_MATCH_CONTRACT_ADDRESS;
    const state = await getEmergencyState(contractAddr);
    setIsPaused(state.is_paused);
    setReason(state.reason || '');
  };
  
  if (!isPaused) return null;
  
  return (
    <div className="emergency-banner">
      <strong>⚠️ System Maintenance</strong>
      <p>{reason}</p>
    </div>
  );
}
```

## Deployment

### Deployment Script

```bash
#!/bin/bash

# Build the contract
cd ArenaX/contracts/upgrade-system
cargo build --target wasm32-unknown-unknown --release

# Optimize WASM
stellar contract optimize \
  --wasm target/wasm32-unknown-unknown/release/upgrade_system.wasm \
  --wasm-out upgrade_system_optimized.wasm

# Deploy to testnet
UPGRADE_SYSTEM_ID=$(stellar contract deploy \
  --wasm upgrade_system_optimized.wasm \
  --source ADMIN_SECRET_KEY \
  --network testnet)

echo "Upgrade System deployed at: $UPGRADE_SYSTEM_ID"

# Initialize
stellar contract invoke \
  --id $UPGRADE_SYSTEM_ID \
  --source ADMIN_SECRET_KEY \
  --network testnet \
  -- initialize \
  --governance_address $GOVERNANCE_ADDRESS \
  --min_timelock_duration 86400 \
  --required_approvals 3 \
  --emergency_threshold 2

echo "Upgrade System initialized"
```

## Monitoring

### Prometheus Metrics

```rust
use prometheus::{Counter, Gauge, Histogram, Registry};

pub struct UpgradeMetrics {
    proposals_total: Counter,
    proposals_executed: Counter,
    proposals_failed: Counter,
    emergency_pauses: Counter,
    rollbacks: Counter,
    approval_time: Histogram,
    execution_time: Histogram,
    active_proposals: Gauge,
}

impl UpgradeMetrics {
    pub fn new(registry: &Registry) -> Self {
        // Initialize metrics
        Self {
            proposals_total: Counter::new("upgrade_proposals_total", "Total proposals").unwrap(),
            proposals_executed: Counter::new("upgrade_proposals_executed", "Executed proposals").unwrap(),
            proposals_failed: Counter::new("upgrade_proposals_failed", "Failed proposals").unwrap(),
            emergency_pauses: Counter::new("upgrade_emergency_pauses", "Emergency pauses").unwrap(),
            rollbacks: Counter::new("upgrade_rollbacks", "Rollbacks").unwrap(),
            approval_time: Histogram::new("upgrade_approval_time_seconds", "Approval time").unwrap(),
            execution_time: Histogram::new("upgrade_execution_time_seconds", "Execution time").unwrap(),
            active_proposals: Gauge::new("upgrade_active_proposals", "Active proposals").unwrap(),
        }
    }
}
```

### Grafana Dashboard

Create a dashboard with panels for:
- Active proposals
- Proposal success rate
- Average approval time
- Emergency pause frequency
- Rollback frequency
- Upgrade type distribution

## Best Practices

1. **Always test upgrades on testnet first**
2. **Use appropriate timelock durations**
3. **Monitor events in real-time**
4. **Have rollback procedures ready**
5. **Communicate upgrades to users**
6. **Keep upgrade history for audit**
7. **Regular security audits**
8. **Document all upgrades**

## Troubleshooting

### Common Issues

**Issue**: Proposal validation fails
- Check compatibility score
- Review breaking changes
- Fix security issues

**Issue**: Timelock not expired
- Wait for timelock duration
- Check current timestamp
- Verify timelock_end value

**Issue**: Insufficient approvals
- Get more approvals
- Check required_approvals config
- Verify approver authorization

**Issue**: Contract paused
- Check emergency state
- Unpause if safe
- Investigate pause reason

## Support

For integration support:
- Documentation: https://docs.arenax.gg/upgrade-system
- GitHub: https://github.com/arenax/arenax
- Discord: https://discord.gg/arenax
