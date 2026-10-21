#!/usr/bin/env bash
# Build and deploy the reputation-tracker Soroban contract to testnet (#1228),
# initialise it with the backend admin, and store the contract ID in
# backend/.env as SOROBAN_CONTRACT_REPUTATION.
#
# Usage:
#   ADMIN_IDENTITY=arenax-admin ./scripts/stellar/deploy-reputation-contract.sh
#
# Env:
#   ADMIN_IDENTITY  (required) `stellar keys` identity that signs and becomes admin
#   NETWORK         (default testnet)
#   ENV_FILE        (default backend/.env)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

: "${ADMIN_IDENTITY:?ADMIN_IDENTITY must name a stellar keys identity}"
network="${NETWORK:-testnet}"
env_file="${ENV_FILE:-backend/.env}"
wasm="contracts/target/wasm32v1-none/release/reputation_tracker.wasm"

stellar contract build --manifest-path contracts/reputation-tracker/Cargo.toml

contract_id="$(stellar contract deploy --wasm "$wasm" --source "$ADMIN_IDENTITY" --network "$network")"
admin_address="$(stellar keys address "$ADMIN_IDENTITY")"

stellar contract invoke --id "$contract_id" --source "$ADMIN_IDENTITY" --network "$network" \
  -- initialize --admin "$admin_address"

touch "$env_file"
if grep -q '^SOROBAN_CONTRACT_REPUTATION=' "$env_file"; then
  sed -i "s|^SOROBAN_CONTRACT_REPUTATION=.*|SOROBAN_CONTRACT_REPUTATION=${contract_id}|" "$env_file"
else
  echo "SOROBAN_CONTRACT_REPUTATION=${contract_id}" >> "$env_file"
fi

echo "reputation-tracker deployed: ${contract_id} (saved to ${env_file})"
