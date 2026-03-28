#!/bin/bash

# Test script for withdrawing staked tokens after tournament completion

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== Test Staking Manager - Withdraw Tokens ===${NC}"

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

# Check if withdrawal is allowed
echo -e "${GREEN}Checking if withdrawal is allowed...${NC}"
CAN_WITHDRAW=$(stellar contract invoke \
    --id $CONTRACT_ID \
    --source $IDENTITY \
    --network $NETWORK \
    -- \
    can_withdraw \
    --user $USER_ADDRESS \
    --tournament_id $TOURNAMENT_ID)

echo -e "${YELLOW}Can withdraw: $CAN_WITHDRAW${NC}"

if [ "$CAN_WITHDRAW" != "true" ]; then
    echo "Warning: Withdrawal may not be allowed. Tournament might not be completed."
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
fi

echo -e "${GREEN}Withdrawing tokens...${NC}"
stellar contract invoke \
    --id $CONTRACT_ID \
    --source $IDENTITY \
    --network $NETWORK \
    -- \
    withdraw \
    --user $USER_ADDRESS \
    --tournament_id $TOURNAMENT_ID

echo -e "${GREEN}Withdrawal successful!${NC}"
