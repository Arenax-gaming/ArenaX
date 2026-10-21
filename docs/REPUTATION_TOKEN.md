# ArenaX Reputation Token (ARXREP)

Stellar custom asset used to track player fairness (Issue #1227). On-chain
score changes are recorded by the `reputation-tracker` Soroban contract
(Issue #1228); the backend applies them on match outcomes (Issue #1229).

## Metadata

| Field          | Value                                                  |
| -------------- | ------------------------------------------------------ |
| Asset code     | `ARXREP`                                               |
| Asset type     | `credit_alphanum12`                                    |
| Issuer         | `REPUTATION_TOKEN_ISSUER` (set after issuance)         |
| Home domain    | `arenax.gg` (`/.well-known/stellar.toml`)              |
| Decimals       | 7 (Stellar default)                                    |
| Initial supply | 1,000,000,000 ARXREP held by the distributor account   |
| Signup grant   | 100 reputation (`INITIAL_REPUTATION`)                  |
| Transferable   | No — reputation is earned, not traded                  |

`stellar.toml` entry:

```toml
[[CURRENCIES]]
code = "ARXREP"
issuer = "<REPUTATION_TOKEN_ISSUER>"
display_decimals = 0
name = "ArenaX Reputation"
desc = "Non-transferable fairness score for ArenaX players."
is_asset_anchored = false
```

## Issuance

```bash
ISSUER_IDENTITY=arxrep-issuer DISTRIBUTOR_IDENTITY=arxrep-dist \
  ./scripts/stellar/issue-reputation-token.sh
```

## Trustlines

Each user account opens a trustline to `ARXREP:<issuer>` when its Stellar
account is created. `ReputationService::reputation_trustline_args` returns the
change-trust parameters.

## Initial allocation

`reputation_service::allocate_initial_reputation` runs on signup
(`AuthService::register`), setting the player's score to 100 and recording a
`signup` event in `reputation_events`.

## Reputation rules

| Event                                        | Change |
| -------------------------------------------- | ------ |
| Fair match completion                        | +2     |
| Confirmed cheating                           | -25    |
| More than 5 disputes opened in 30 days       | -10    |

Every change is mirrored to the `reputation-tracker` contract
(`SOROBAN_CONTRACT_REPUTATION`, deployed with
`scripts/stellar/deploy-reputation-contract.sh`) and the player is notified.
