# Event Schema Versioning Guide

## Convention

All ArenaX Soroban contract events use a 2-topic versioned format:

```
Topics: ["Namespace_v{N}", "EVENT_TYPE"]
Data: { ...event-specific fields }
```

The namespace and version are combined in the first topic using `_v` as separator. Legacy unversioned events (v0) use the original namespace without version suffix.

### Namespaces

| Topic Prefix | Namespace | Contract |
|---|---|---|
| ArenaXMatch_v1 | ArenaXMatch | match_contract |
| ArenaXMLf_v1 | ArenaXMLf | match-lifecycle |
| ArenaXEscrow_v1 | ArenaXEscrow | match_escrow_vault |
| ArenaXReputation_v1 | ArenaXReputation | reputation_aggregation |
| ArenaXRepIdx_v1 | ArenaXRepIdx | reputation-index |
| ArenaXAC_v1 | ArenaXAC | anti-cheat-oracle |
| ArenaXSlash_v1 | ArenaXSlash | slashing_contract |
| ArenaXGov_v1 | ArenaXGov | governance_multisig |
| ArenaXStake_v1 | ArenaXStake | staking-manager |
| ArenaXTourn_v1 | ArenaXTourn | tournament_finalizer |
| ArenaXDisp_v1 | ArenaXDisp | dispute-resolution |
| ArenaXReg_v1 | ArenaXReg | registry |
| ArenaXCReg_v1 | ArenaXCReg | contract-registry |
| ArenaXAuth_v1 | ArenaXAuth | auth-gateway |
| ArenaXId_v1 | ArenaXId | user_identity_contract |
| ArenaXToken_v1 | ArenaXToken | ax-token |

### Version Rules

- **Adding a field** → bump version (e.g., v1 → v2)
- **Removing/renaming a field** → bump version
- **Reordering fields** → bump version (XDR is order-dependent)
- **Adding a new event type** → same version (new event, not schema change)

## How to Add a New Event

1. Define the event struct in `contracts/arenax-events/src/{domain}.rs` with `#[contractevent(topics = ["Namespace_v1", "EVENT_TYPE"])]`
2. Add an `emit_*` helper function
3. Register v0 + v1 server-side parsers in `server/src/services/event-schemas/{domain}.ts`
4. Add test coverage

## How to Evolve an Event Schema

1. Bump version in topic: `Namespace_v1` → `Namespace_v2`
2. Create new struct in `arenax-events`
3. Register new server parser for v2
4. Keep old v1 parser — events already on-chain don't change

## Migration Example: ReputationUpdated v0 → v1

**v0** (legacy): Topics `["ArenaXReputation", "REPUTATION_UPDATED"]`, data has 5 fields.

**v1** (versioned): Topics `["ArenaXReputation_v1", "REPUTATION_UPDATED"]`, data adds `source: u32` field.

Server parser: v0 returns `source: null`, v1 returns `source` as-is. Consumer checks `event.version` to know which shape to expect.
