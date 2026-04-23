#!/bin/bash

# ArenaX Upgrade System Deployment Script
# This script builds, optimizes, and deploys the upgrade system contract

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
NETWORK=${NETWORK:-testnet}
ADMIN_SECRET=${ADMIN_SECRET:-""}
GOVERNANCE_ADDRESS=${GOVERNANCE_ADDRESS:-""}

echo -e "${GREEN}=== ArenaX Upgrade System Deployment ===${NC}\n"

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v cargo &> /dev/null; then
    echo -e "${RED}Error: cargo not found. Please install Rust.${NC}"
    exit 1
fi

if ! command -v stellar &> /dev/null; then
    echo -e "${RED}Error: stellar CLI not found. Please install Stellar CLI.${NC}"
    exit 1
fi

if [ -z "$ADMIN_SECRET" ]; then
    echo -e "${RED}Error: ADMIN_SECRET environment variable not set.${NC}"
    exit 1
fi

if [ -z "$GOVERNANCE_ADDRESS" ]; then
    echo -e "${RED}Error: GOVERNANCE_ADDRESS environment variable not set.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Prerequisites check passed${NC}\n"

# Build the contract
echo -e "${YELLOW}Building contract...${NC}"
cargo build --target wasm32-unknown-unknown --release

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Build failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Build successful${NC}\n"

# Optimize WASM
echo -e "${YELLOW}Optimizing WASM...${NC}"
stellar contract optimize \
  --wasm target/wasm32-unknown-unknown/release/upgrade_system.wasm \
  --wasm-out upgrade_system_optimized.wasm

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Optimization failed${NC}"
    exit 1
fi

WASM_SIZE=$(wc -c < upgrade_system_optimized.wasm)
echo -e "${GREEN}✓ Optimization successful (Size: $WASM_SIZE bytes)${NC}\n"

# Deploy contract
echo -e "${YELLOW}Deploying contract to $NETWORK...${NC}"
UPGRADE_SYSTEM_ID=$(stellar contract deploy \
  --wasm upgrade_system_optimized.wasm \
  --source $ADMIN_SECRET \
  --network $NETWORK 2>&1 | tail -n 1)

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Deployment failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Contract deployed${NC}"
echo -e "Contract ID: ${GREEN}$UPGRADE_SYSTEM_ID${NC}\n"

# Initialize contract
echo -e "${YELLOW}Initializing contract...${NC}"
stellar contract invoke \
  --id $UPGRADE_SYSTEM_ID \
  --source $ADMIN_SECRET \
  --network $NETWORK \
  -- initialize \
  --governance_address $GOVERNANCE_ADDRESS \
  --min_timelock_duration 86400 \
  --required_approvals 3 \
  --emergency_threshold 2

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Initialization failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Contract initialized${NC}\n"

# Save deployment info
DEPLOYMENT_FILE="deployment_${NETWORK}.json"
cat > $DEPLOYMENT_FILE <<EOF
{
  "network": "$NETWORK",
  "contract_id": "$UPGRADE_SYSTEM_ID",
  "governance_address": "$GOVERNANCE_ADDRESS",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "config": {
    "min_timelock_duration": 86400,
    "required_approvals": 3,
    "emergency_threshold": 2
  }
}
EOF

echo -e "${GREEN}✓ Deployment info saved to $DEPLOYMENT_FILE${NC}\n"

# Verify deployment
echo -e "${YELLOW}Verifying deployment...${NC}"
CONFIG=$(stellar contract invoke \
  --id $UPGRADE_SYSTEM_ID \
  --source $ADMIN_SECRET \
  --network $NETWORK \
  -- get_config)

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Verification failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Deployment verified${NC}"
echo -e "Configuration: $CONFIG\n"

# Summary
echo -e "${GREEN}=== Deployment Summary ===${NC}"
echo -e "Network: ${GREEN}$NETWORK${NC}"
echo -e "Contract ID: ${GREEN}$UPGRADE_SYSTEM_ID${NC}"
echo -e "Governance: ${GREEN}$GOVERNANCE_ADDRESS${NC}"
echo -e "Min Timelock: ${GREEN}24 hours${NC}"
echo -e "Required Approvals: ${GREEN}3${NC}"
echo -e "Emergency Threshold: ${GREEN}2${NC}"
echo -e "\n${GREEN}Deployment completed successfully!${NC}\n"

# Export for use in other scripts
export UPGRADE_SYSTEM_ADDRESS=$UPGRADE_SYSTEM_ID
echo "export UPGRADE_SYSTEM_ADDRESS=$UPGRADE_SYSTEM_ID" >> .env.${NETWORK}

echo -e "${YELLOW}Next steps:${NC}"
echo "1. Update your .env file with UPGRADE_SYSTEM_ADDRESS=$UPGRADE_SYSTEM_ID"
echo "2. Grant upgrade system authority in governance contract"
echo "3. Test with a sample upgrade proposal"
echo "4. Monitor events and metrics"
