#!/bin/bash

# ArenaX Token Deployment Script for Stellar Testnet
# This script deploys the AX Token contract to Stellar testnet

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}ArenaX Token Deployment Script${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if soroban CLI is installed
if ! command -v soroban &> /dev/null; then
    echo -e "${RED}Error: soroban CLI is not installed${NC}"
    echo "Install it with: cargo install --locked soroban-cli"
    exit 1
fi

# Configuration
NETWORK="${NETWORK:-testnet}"
IDENTITY="${IDENTITY:-default}"

echo -e "\n${YELLOW}Configuration:${NC}"
echo "Network: $NETWORK"
echo "Identity: $IDENTITY"

# Build the contract
echo -e "\n${YELLOW}Step 1: Building contract...${NC}"
cd "$(dirname "$0")"
cargo build --target wasm32-unknown-unknown --release

if [ $? -ne 0 ]; then
    echo -e "${RED}Build failed!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Build successful${NC}"

# Optimize the WASM (optional but recommended)
echo -e "\n${YELLOW}Step 2: Optimizing WASM...${NC}"
WASM_PATH="../../target/wasm32-unknown-unknown/release/ax_token.wasm"

if [ ! -f "$WASM_PATH" ]; then
    echo -e "${RED}Error: WASM file not found at $WASM_PATH${NC}"
    exit 1
fi

# Deploy the contract
echo -e "\n${YELLOW}Step 3: Deploying contract to $NETWORK...${NC}"
CONTRACT_ID=$(soroban contract deploy \
    --wasm "$WASM_PATH" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}Deployment failed!${NC}"
    echo "$CONTRACT_ID"
    exit 1
fi

echo -e "${GREEN}✓ Contract deployed successfully${NC}"
echo -e "${GREEN}Contract ID: $CONTRACT_ID${NC}"

# Save contract ID to file
echo "$CONTRACT_ID" > .contract-id-$NETWORK
echo -e "${GREEN}✓ Contract ID saved to .contract-id-$NETWORK${NC}"

# Get admin address
echo -e "\n${YELLOW}Step 4: Getting admin address...${NC}"
ADMIN_ADDRESS=$(soroban keys address "$IDENTITY")
echo -e "${GREEN}Admin Address: $ADMIN_ADDRESS${NC}"

# Initialize the contract
echo -e "\n${YELLOW}Step 5: Initializing contract...${NC}"

# Token parameters
MAX_SUPPLY="${MAX_SUPPLY:-1000000000000000}" # 1 billion tokens (with 7 decimals)
TREASURY_ADDRESS="${TREASURY_ADDRESS:-$ADMIN_ADDRESS}" # Default to admin if not set

echo "Max Supply: $MAX_SUPPLY (1 billion AX tokens)"
echo "Treasury Address: $TREASURY_ADDRESS"

# Initialize contract
soroban contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- \
    initialize \
    --admin "$ADMIN_ADDRESS" \
    --max_supply "$MAX_SUPPLY" \
    --treasury "$TREASURY_ADDRESS"

if [ $? -ne 0 ]; then
    echo -e "${RED}Initialization failed!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Contract initialized successfully${NC}"

# Verify deployment
echo -e "\n${YELLOW}Step 6: Verifying deployment...${NC}"

# Get token info
TOKEN_INFO=$(soroban contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- \
    token_info)

echo -e "${GREEN}Token Info:${NC}"
echo "$TOKEN_INFO"

# Get total supply
TOTAL_SUPPLY=$(soroban contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- \
    total_supply)

echo -e "${GREEN}Total Supply: $TOTAL_SUPPLY${NC}"

# Get max supply
MAX_SUPPLY_CHECK=$(soroban contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- \
    max_supply)

echo -e "${GREEN}Max Supply: $MAX_SUPPLY_CHECK${NC}"

# Summary
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Summary${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "Network:        ${YELLOW}$NETWORK${NC}"
echo -e "Contract ID:    ${YELLOW}$CONTRACT_ID${NC}"
echo -e "Admin:          ${YELLOW}$ADMIN_ADDRESS${NC}"
echo -e "Treasury:       ${YELLOW}$TREASURY_ADDRESS${NC}"
echo -e "Max Supply:     ${YELLOW}$MAX_SUPPLY_CHECK${NC}"
echo -e "Total Supply:   ${YELLOW}$TOTAL_SUPPLY${NC}"
echo -e "${GREEN}========================================${NC}"

# Save deployment info
DEPLOYMENT_FILE="deployment-$NETWORK.json"
cat > "$DEPLOYMENT_FILE" <<EOF
{
  "network": "$NETWORK",
  "contract_id": "$CONTRACT_ID",
  "admin": "$ADMIN_ADDRESS",
  "treasury": "$TREASURY_ADDRESS",
  "max_supply": "$MAX_SUPPLY_CHECK",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo -e "\n${GREEN}✓ Deployment info saved to $DEPLOYMENT_FILE${NC}"

echo -e "\n${YELLOW}Next steps:${NC}"
echo "1. Test minting: ./test-mint.sh"
echo "2. Test transfers: ./test-transfer.sh"
echo "3. Update backend .env with CONTRACT_ID: $CONTRACT_ID"
echo "4. Deploy StakingManager contract and link to this token"

echo -e "\n${GREEN}Deployment complete! 🚀${NC}"
