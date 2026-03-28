#!/bin/bash

# Test script for minting AX tokens

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

NETWORK="${NETWORK:-testnet}"
IDENTITY="${IDENTITY:-default}"

# Read contract ID
if [ ! -f ".contract-id-$NETWORK" ]; then
    echo "Error: Contract not deployed. Run ./deploy.sh first"
    exit 1
fi

CONTRACT_ID=$(cat .contract-id-$NETWORK)
ADMIN_ADDRESS=$(soroban keys address "$IDENTITY")

echo -e "${GREEN}Testing AX Token Minting${NC}"
echo "Contract ID: $CONTRACT_ID"
echo "Admin: $ADMIN_ADDRESS"

# Generate a test user address
TEST_USER="${TEST_USER:-$ADMIN_ADDRESS}"
MINT_AMOUNT="${MINT_AMOUNT:-100000000}" # 10 AX tokens (with 7 decimals)

echo -e "\n${YELLOW}Minting $MINT_AMOUNT stroops to $TEST_USER${NC}"

# Mint tokens
soroban contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- \
    mint \
    --to "$TEST_USER" \
    --amount "$MINT_AMOUNT"

echo -e "${GREEN}✓ Minting successful${NC}"

# Check balance
echo -e "\n${YELLOW}Checking balance...${NC}"
BALANCE=$(soroban contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- \
    balance \
    --addr "$TEST_USER")

echo -e "${GREEN}Balance: $BALANCE stroops${NC}"

# Check total supply
TOTAL_SUPPLY=$(soroban contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- \
    total_supply)

echo -e "${GREEN}Total Supply: $TOTAL_SUPPLY stroops${NC}"

echo -e "\n${GREEN}Mint test complete! ✓${NC}"
