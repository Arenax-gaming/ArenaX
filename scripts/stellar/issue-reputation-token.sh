#!/usr/bin/env bash
# Issue the ArenaX Reputation Token (ARXREP) as a Stellar custom asset (#1227).
#
# 1. Fund issuer and distributor accounts (testnet friendbot).
# 2. Set the issuer's home domain so wallets can resolve stellar.toml metadata.
# 3. Distributor opens a trustline to ARXREP and receives the initial supply.
#
# Per-user trustlines and the signup allocation are handled by the backend
# (ReputationService::allocate_initial_reputation). See docs/REPUTATION_TOKEN.md.
#
# Usage:
#   ISSUER_IDENTITY=arxrep-issuer DISTRIBUTOR_IDENTITY=arxrep-dist \
#     ./scripts/stellar/issue-reputation-token.sh
#
# Env:
#   ISSUER_IDENTITY, DISTRIBUTOR_IDENTITY  (required) `stellar keys` identities
#   NETWORK        (default testnet)
#   HOME_DOMAIN    (default arenax.gg)
#   INITIAL_SUPPLY (default 1000000000, in whole tokens)
set -euo pipefail

: "${ISSUER_IDENTITY:?ISSUER_IDENTITY must be set}"
: "${DISTRIBUTOR_IDENTITY:?DISTRIBUTOR_IDENTITY must be set}"
network="${NETWORK:-testnet}"
home_domain="${HOME_DOMAIN:-arenax.gg}"
supply="${INITIAL_SUPPLY:-1000000000}"
code="ARXREP"

for identity in "$ISSUER_IDENTITY" "$DISTRIBUTOR_IDENTITY"; do
  stellar keys address "$identity" >/dev/null 2>&1 || stellar keys generate "$identity" --network "$network"
  stellar keys fund "$identity" --network "$network" || true
done

issuer="$(stellar keys address "$ISSUER_IDENTITY")"
asset="${code}:${issuer}"

stellar tx new set-options --source "$ISSUER_IDENTITY" --network "$network" --home-domain "$home_domain"
stellar tx new change-trust --source "$DISTRIBUTOR_IDENTITY" --network "$network" --line "$asset"
stellar tx new payment --source "$ISSUER_IDENTITY" --network "$network" \
  --destination "$(stellar keys address "$DISTRIBUTOR_IDENTITY")" \
  --asset "$asset" --amount "$((supply * 10000000))"

echo "Issued ${asset}"
echo "Set REPUTATION_TOKEN_ISSUER=${issuer} in backend/.env"
