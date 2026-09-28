# Upgrade Manager

Governed contract-upgrade lifecycle for ArenaX Soroban contracts, closing
[#969](https://github.com/Arenax-gaming/ArenaX/issues/969).

## Why this shape

Soroban has no EVM-style `delegatecall` proxy. Instead a contract's
*address* is permanent while its wasm implementation can be swapped in
place via `Env::deployer().update_current_contract_wasm(hash)` — callers,
other contracts, and off-chain indexers never need to learn a new address.
That address stability is the proxy-equivalent guarantee this contract is
built around.

`UpgradeManager` is the governance layer in front of that primitive:

1. **Propose** — anyone can call `propose_upgrade(contract_name, new_wasm_hash, description, timelock_seconds)`.
2. **Validate** — a governor records an implementation-validation verdict
   (`validate_upgrade`) before a vote can pass execution.
3. **Vote** — governors cast one yes/no vote each (`vote_upgrade`); a
   proposal needs `approval_threshold` yes-votes to be executable.
4. **Execute** — once validated, past threshold, and past the timelock,
   `execute_upgrade` runs. For the manager's own implementation
   (`SELF_CONTRACT`) it calls `update_current_contract_wasm` directly.
   For any other tracked contract it records the governance-approved
   wasm hash; that contract's own admin-gated `upgrade()` entrypoint
   reads it via `get_approved_wasm_hash` and applies it to itself — one
   contract cannot rewrite another's wasm directly on Soroban, so this
   indirection is what makes third-party contracts governable from a
   single place.
5. **Rollback** — `rollback_upgrade` restores the previously-approved
   wasm hash for a contract (or immediately re-applies it for `SELF`),
   with a reason recorded.
6. **History** — every execution and rollback appends an `UpgradeRecord`
   to `get_upgrade_history(contract_name)`, and every step also emits a
   versioned event (`arenax-events::upgrade_manager`) for off-chain
   indexers.

## Integrating a target contract

```rust
pub fn upgrade(env: Env, caller: Address) {
    caller.require_auth();
    let manager: Address = /* stored upgrade-manager contract id */;
    let hash = UpgradeManagerClient::new(&env, &manager)
        .get_approved_wasm_hash(&symbol_short!("MyContract"))
        .expect("no approved upgrade");
    env.deployer().update_current_contract_wasm(hash);
}
```

## Acceptance criteria mapping

- Proxy pattern implementation → stable contract address + wasm swap via `update_current_contract_wasm`.
- Upgrade governance vote → `vote_upgrade` + `approval_threshold`.
- Implementation validation → `validate_upgrade`, required before execution.
- Rollback capability → `rollback_upgrade`.
- Upgrade history logged → `get_upgrade_history` + `arenax-events::upgrade_manager` events.
