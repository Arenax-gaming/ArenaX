#!/bin/bash

# Test script for staking tokens in a tournament

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== Test Staking Manager - Stake Tokens ===${NC}"

# Configuration
NETWORK="${NETWORK:-testnet}"
IDENTITY="${IDENTITY:-default}"

# Check if contract ID file exists
if [ ! -f .staking-manager-id ]; then
    echo "Error: Contract ID file not found. Deploy the contract first."
    exit 1
fi

CONTRACT_ID=$(cat .staking-manager-id)
echo -e "${YELLOW}Contract ID: $CONTRACT_ID${NC}"

# Get parameters
read -p "Enter user address: " USER_ADDRESS
read -p "Enter tournament ID (32-byte hex): " TOURNAMENT_ID
read -p "Enter stake amount (in stroops, 1 AX = 10000000): " AMOUNT

echo -e "${GREEN}Staking tokens...${NC}"
stellar contract invoke \
    --id $CONTRACT_ID \
    --source $IDENTITY \
    --network $NETWORK \
    -- \
    stake \
    --user $USER_ADDRESS \
    --tournament_id $TOURNAMENT_ID \
    --amount $AMOUNT

echo -e "${GREEN}Stake successful!${NC}"

# Query stake info
echo -e "${GREEN}Querying stake info...${NC}"
stellar contract invoke \
    --id $CONTRACT_ID \
    --source $IDENTITY \
    --network $NETWORK \
    -- \
    get_stake \
    --user $USER_ADDRESS \
    --tournament_id $TOURNAMENT_ID
