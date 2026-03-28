#!/bin/bash

# Test script for transferring AX tokens

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
FROM_ADDRESS=$(soroban keys address "$IDENTITY")

echo -e "${GREEN}Testing AX Token Transfer${NC}"
echo "Contract ID: $CONTRACT_ID"
echo "From: $FROM_ADDRESS"

# Generate or use provided recipient address
if [ -z "$TO_ADDRESS" ]; then
    echo "Error: Set TO_ADDRESS environment variable"
    echo "Example: TO_ADDRESS=GXXXXXX... ./test-transfer.sh"
    exit 1
fi

TRANSFER_AMOUNT="${TRANSFER_AMOUNT:-50000000}" # 5 AX tokens

echo -e "\n${YELLOW}Transferring $TRANSFER_AMOUNT stroops to $TO_ADDRESS${NC}"

# Check sender balance before
BALANCE_BEFORE=$(soroban contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- \
    balance \
    --addr "$FROM_ADDRESS")

echo "Sender balance before: $BALANCE_BEFORE stroops"

# Transfer tokens
soroban contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- \
    transfer \
    --from "$FROM_ADDRESS" \
    --to "$TO_ADDRESS" \
    --amount "$TRANSFER_AMOUNT"

echo -e "${GREEN}✓ Transfer successful${NC}"

# Check balances after
BALANCE_AFTER=$(soroban contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- \
    balance \
    --addr "$FROM_ADDRESS")

RECIPIENT_BALANCE=$(soroban contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- \
    balance \
    --addr "$TO_ADDRESS")

echo -e "\n${GREEN}Balances after transfer:${NC}"
echo "Sender: $BALANCE_AFTER stroops"
echo "Recipient: $RECIPIENT_BALANCE stroops"

echo -e "\n${GREEN}Transfer test complete! ✓${NC}"
