# Upgrade System Quick Start Guide

Get up and running with the ArenaX Upgrade System in 5 minutes.

## Prerequisites

- Rust toolchain installed
- Stellar CLI installed
- Soroban SDK 23.5.2+
- Admin account with secret key
- Governance contract deployed

## Step 1: Build (1 minute)

```bash
cd ArenaX/contracts/upgrade-system
cargo build --target wasm32-unknown-unknown --release
```

## Step 2: Deploy (2 minutes)

```bash
# Set environment variables
export ADMIN_SECRET="SBXXX..."
export GOVERNANCE_ADDRESS="GAXXX..."
export NETWORK="testnet"

# Run deployment script
./deploy.sh
```

The script will:
- ✅ Build and optimize the contract
- ✅ Deploy to Stellar testnet
- ✅ Initialize with default settings
- ✅ Save deployment info

## Step 3: Verify (30 seconds)

```bash
# Check configuration
stellar contract invoke \
  --id $UPGRADE_SYSTEM_ADDRESS \
  --source $ADMIN_SECRET \
  --network testnet \
  -- get_config
```

Expected output:
```json
{
  "governance_address": "GAXXX...",
  "min_timelock_duration": 86400,
  "required_approvals": 3,
  "emergency_threshold": 2
}
```

## Step 4: Test Upgrade (1 minute)

```bash
# Propose a test upgrade
stellar contract invoke \
  --id $UPGRADE_SYSTEM_ADDRESS \
  --source $ADMIN_SECRET \
  --network testnet \
  -- propose_upgrade \
  --proposer $GOVERNANCE_ADDRESS \
  --proposal_id "0x0000000000000000000000000000000000000000000000000000000000000001" \
  --contract_address "CAXXX..." \
  --new_wasm_hash "0x1111111111111111111111111111111111111111111111111111111111111111" \
  --upgrade_type 1 \
  --timelock_duration 86400 \
  --description "Test upgrade"
```

## Step 5: Query Status (30 seconds)

```bash
# Get proposal details
stellar contract invoke \
  --id $UPGRADE_SYSTEM_ADDRESS \
  --source $ADMIN_SECRET \
  --network testnet \
  -- get_proposal \
  --proposal_id "0x0000000000000000000000000000000000000000000000000000000000000001"
```

## Common Operations

### Validate Upgrade

```bash
stellar contract invoke \
  --id $UPGRADE_SYSTEM_ADDRESS \
  --source $ADMIN_SECRET \
  --network testnet \
  -- validate_upgrade \
  --validator $GOVERNANCE_ADDRESS \
  --proposal_id "0x..." \
  --compatibility_score 85 \
  --breaking_changes false \
  --security_issues "[]"
```

### Approve Upgrade

```bash
stellar contract invoke \
  --id $UPGRADE_SYSTEM_ADDRESS \
  --source $ADMIN_SECRET \
  --network testnet \
  -- approve_upgrade \
  --approver $GOVERNANCE_ADDRESS \
  --proposal_id "0x..." \
  --signature_hash "0x..."
```

### Execute Upgrade

```bash
# Wait for timelock to expire, then:
stellar contract invoke \
  --id $UPGRADE_SYSTEM_ADDRESS \
  --source $ADMIN_SECRET \
  --network testnet \
  -- execute_upgrade \
  --executor $GOVERNANCE_ADDRESS \
  --proposal_id "0x..."
```

### Emergency Pause

```bash
stellar contract invoke \
  --id $UPGRADE_SYSTEM_ADDRESS \
  --source $ADMIN_SECRET \
  --network testnet \
  -- emergency_pause \
  --caller $GOVERNANCE_ADDRESS \
  --contract_address "CAXXX..." \
  --reason "Critical bug detected"
```

### Get Upgrade History

```bash
stellar contract invoke \
  --id $UPGRADE_SYSTEM_ADDRESS \
  --source $ADMIN_SECRET \
  --network testnet \
  -- get_upgrade_history \
  --contract_address "CAXXX..."
```

## Integration Examples

### Backend (Rust)

```rust
use soroban_sdk::{Address, BytesN, Env, String};

// Initialize client
let upgrade_client = UpgradeSystemClient::new(&env, &upgrade_system_addr);

// Propose upgrade
upgrade_client.propose_upgrade(
    &proposer_addr,
    &proposal_id,
    &contract_addr,
    &wasm_hash,
    &1u32,  // Feature upgrade
    &(48 * 60 * 60),  // 48 hours
    &String::from_str(&env, "Add new feature"),
);

// Get status
let proposal = upgrade_client.get_proposal(&proposal_id);
```

### Frontend (TypeScript)

```typescript
import { Contract } from 'stellar-sdk';

const contract = new Contract(upgradeSystemAddress);

// Get proposal
const proposal = await contract.call('get_proposal', proposalId);

// Get history
const history = await contract.call('get_upgrade_history', contractAddress);
```

## Configuration

### Default Settings

- **Min Timelock**: 24 hours (86400 seconds)
- **Max Timelock**: 30 days (2592000 seconds)
- **Required Approvals**: 3
- **Emergency Threshold**: 2
- **Simulation Required**: true

### Customize Settings

Edit `deploy.sh` before deployment:

```bash
stellar contract invoke \
  --id $UPGRADE_SYSTEM_ID \
  --source $ADMIN_SECRET \
  --network $NETWORK \
  -- initialize \
  --governance_address $GOVERNANCE_ADDRESS \
  --min_timelock_duration 172800 \  # 48 hours
  --required_approvals 5 \           # 5 approvals
  --emergency_threshold 3            # 3 for emergency
```

## Upgrade Types

- **0** = BugFix - Minor bug fixes
- **1** = Feature - New features
- **2** = Security - Security patches
- **3** = Performance - Optimizations
- **4** = Breaking - Breaking changes

## Upgrade Status

- **0** = Pending - Just created
- **1** = Validated - Passed validation
- **2** = Scheduled - Approved, waiting for timelock
- **3** = Executed - Successfully executed
- **4** = RolledBack - Rolled back
- **5** = Cancelled - Cancelled by proposer
- **6** = Failed - Execution failed

## Troubleshooting

### Build Fails

```bash
# Update dependencies
cargo update

# Clean and rebuild
cargo clean
cargo build --target wasm32-unknown-unknown --release
```

### Deployment Fails

```bash
# Check Stellar CLI version
stellar version

# Check network connectivity
stellar network status --network testnet

# Verify admin secret
stellar keys show $ADMIN_SECRET
```

### Proposal Creation Fails

Common issues:
- ❌ Not authorized by governance → Use governance address
- ❌ Proposal already exists → Use unique proposal ID
- ❌ Timelock too short → Use at least 24 hours
- ❌ Invalid WASM hash → Verify hash format

### Execution Fails

Common issues:
- ❌ Timelock not expired → Wait for timelock duration
- ❌ Not enough approvals → Get more approvals
- ❌ Contract paused → Check emergency state
- ❌ Already executed → Check proposal status

## Monitoring

### Watch Events

```bash
# Stream events (requires stellar-cli with event support)
stellar events stream \
  --contract $UPGRADE_SYSTEM_ADDRESS \
  --network testnet
```

### Check Health

```bash
# Check if contract is paused
stellar contract invoke \
  --id $UPGRADE_SYSTEM_ADDRESS \
  --network testnet \
  -- get_emergency_state \
  --contract_address "CAXXX..."
```

## Next Steps

1. **Read Full Documentation**: See [README.md](./README.md)
2. **Integration Guide**: See [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md)
3. **Examples**: See [EXAMPLES.md](./EXAMPLES.md)
4. **Deploy to Mainnet**: Change `NETWORK=mainnet`
5. **Set Up Monitoring**: Implement event monitoring
6. **Configure Alerts**: Set up emergency alerts

## Best Practices

✅ **Always test on testnet first**
✅ **Use appropriate timelock durations**
✅ **Validate thoroughly before approval**
✅ **Monitor after execution**
✅ **Have rollback plan ready**
✅ **Document all upgrades**
✅ **Communicate with users**

## Support

- 📖 Documentation: [README.md](./README.md)
- 💬 Discord: https://discord.gg/arenax
- 🐛 Issues: https://github.com/arenax/arenax/issues
- 📧 Email: dev@arenax.gg

## Quick Reference

| Command | Purpose |
|---------|---------|
| `propose_upgrade` | Create upgrade proposal |
| `validate_upgrade` | Validate proposal |
| `approve_upgrade` | Approve proposal |
| `execute_upgrade` | Execute upgrade |
| `rollback_upgrade` | Rollback upgrade |
| `emergency_pause` | Pause contract |
| `unpause_contract` | Unpause contract |
| `get_proposal` | Get proposal details |
| `get_upgrade_history` | Get upgrade history |
| `get_emergency_state` | Check pause status |

---

**Ready to upgrade!** 🚀

For detailed information, see the full documentation in [README.md](./README.md).
