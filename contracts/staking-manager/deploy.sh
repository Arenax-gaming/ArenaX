#!/bin/bash

# Staking Manager Deployment Script for Stellar Testnet
# This script deploys the Staking Manager contract and initializes it

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Staking Manager Deployment Script ===${NC}"

# Check if stellar CLI is installed
if ! command -v stellar &> /dev/null; then
    echo -e "${RED}Error: stellar CLI not found. Please install it first.${NC}"
    echo "Visit: https://developers.stellar.org/docs/tools/developer-tools"
    exit 1
fi

# Configuration
NETWORK="${NETWORK:-testnet}"
IDENTITY="${IDENTITY:-default}"

echo -e "${YELLOW}Network: $NETWORK${NC}"
echo -e "${YELLOW}Identity: $IDENTITY${NC}"

# Build the contract
echo -e "${GREEN}Building contract...${NC}"
cargo build --target wasm32-unknown-unknown --release

# Deploy the contract
echo -e "${GREEN}Deploying Staking Manager contract...${NC}"
CONTRACT_ID=$(stellar contract deploy \
    --wasm ../../target/wasm32-unknown-unknown/release/staking_manager.wasm \
    --source $IDENTITY \
    --network $NETWORK)

echo -e "${GREEN}Contract deployed!${NC}"
echo -e "${YELLOW}Contract ID: $CONTRACT_ID${NC}"

# Save contract ID to file
echo "$CONTRACT_ID" > .staking-manager-id
echo -e "${GREEN}Contract ID saved to .staking-manager-id${NC}"

# Prompt for initialization
echo ""
echo -e "${YELLOW}=== Contract Initialization ===${NC}"
echo "To initialize the contract, you need:"
echo "  1. Admin address (governance multisig)"
echo "  2. AX Token contract address"
echo ""
read -p "Do you want to initialize now? (y/n) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "Enter admin address: " ADMIN_ADDRESS
    read -p "Enter AX Token contract address: " AX_TOKEN_ADDRESS
    
    echo -e "${GREEN}Initializing contract...${NC}"
    stellar contract invoke \
        --id $CONTRACT_ID \
        --source $IDENTITY \
        --network $NETWORK \
        -- \
        initialize \
        --admin $ADMIN_ADDRESS \
        --ax_token $AX_TOKEN_ADDRESS
    
    echo -e "${GREEN}Contract initialized successfully!${NC}"
    
    # Optional: Set tournament and dispute contracts
    echo ""
    read -p "Do you want to set tournament contract address? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "Enter tournament contract address: " TOURNAMENT_ADDRESS
        stellar contract invoke \
            --id $CONTRACT_ID \
            --source $IDENTITY \
            --network $NETWORK \
            -- \
            set_tournament_contract \
            --tournament_contract $TOURNAMENT_ADDRESS
        echo -e "${GREEN}Tournament contract set!${NC}"
    fi
    
    echo ""
    read -p "Do you want to set dispute contract address? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "Enter dispute contract address: " DISPUTE_ADDRESS
        stellar contract invoke \
            --id $CONTRACT_ID \
            --source $IDENTITY \
            --network $NETWORK \
            -- \
            set_dispute_contract \
            --dispute_contract $DISPUTE_ADDRESS
        echo -e "${GREEN}Dispute contract set!${NC}"
    fi
fi

echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo -e "${YELLOW}Contract ID: $CONTRACT_ID${NC}"
echo ""
echo "Next steps:"
echo "  1. Save the contract ID for your records"
echo "  2. Configure tournament and dispute contracts (if not done)"
echo "  3. Test the contract with test scripts"
echo "  4. Update your backend configuration with the contract ID"
