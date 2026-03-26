## Issue #C1: [PRIZE] Prize Distribution Engine

**Labels:**  `contracts`, `prize`, `priority: high`

**New Contract Location:**  `contracts/prize-distribution/src/lib.rs`

**Description:**
Implements prize pool creation, escrow locking, and distribution for single or multiple winners. Integrates with Match contract and enforces atomic payouts.

**Key Tasks:**
- [ ] Define `PrizePool` with `pool_id`, `asset`, `amount_locked`, `match_id`, `weights`.
- [ ] Implement `create_pool(match_id, asset, amount)` and lock funds.
- [ ] Implement `distribute(pool_id, winners[], weights[])` with weights sum validation.
- [ ] Add dispute-aware hold/release integration with Match contract.
- [ ] Emit events: `pool_created`, `pool_locked`, `payout_executed`, `payout_held`, `payout_released`.

**Acceptance Criteria:**
- Funds are locked before match finalization and released atomically on payout.
- Weighted multi-winner payouts succeed or revert in full.
- Payouts are blocked when a dispute is active and resume after resolution.

---

## Issue #C2: [MATCH] Match Lifecycle Manager

**Labels:**  `contracts`, `match`, `priority: high`

**New Contract Location:**  `contracts/match-lifecycle/src/lib.rs`

**Description:**
Manages creation, participation, result submission, and finalization of matches with strict state transitions and authorization.

**Key Tasks:**
- [ ] Define `Match` with states `Created`, `InProgress`, `PendingResult`, `Finalized`, `Disputed`.
- [ ] Implement `create_match(players[], stake_asset, stake_amount)`.
- [ ] Implement `submit_result(match_id, reporter, score)` with dual-reporting checks.
- [ ] Implement `finalize_match(match_id)` guarded to participants/operators.
- [ ] Emit events: `match_created`, `result_submitted`, `match_finalized`.

**Acceptance Criteria:**
- Only participants or authorized operators can mutate match state.
- Invalid transitions are rejected with clear errors.
- Finalization produces a deterministic winner set consumed by Prize Distribution.

---

## Issue #C3: [DISPUTE] Dispute Resolution Module

**Labels:**  `contracts`, `dispute`, `priority: critical`

**New Contract Location:**  `contracts/dispute-resolution/src/lib.rs`

**Description:**
Handles dispute open/close, evidence references, adjudication by operators, and timeouts integrated with Match lifecycle.

**Key Tasks:**
- [ ] Implement `open_dispute(match_id, reason, evidence_ref)`.
- [ ] Implement adjudication `resolve_dispute(match_id, decision)` with role checks.
- [ ] Enforce resolution deadline and emit audit events.
- [ ] Provide `is_disputed(match_id)` API used by Prize Distribution.

**Acceptance Criteria:**
- Disputes prevent payouts until resolution is recorded.
- Operator-only adjudication is enforced; unauthorized calls fail.
- All decisions are logged with events and timestamps.

---

## Issue #C4: [REPUTATION] Player Reputation Index

**Labels:**  `contracts`, `reputation`, `priority: medium`

**New Contract Location:**  `contracts/reputation-index/src/lib.rs`

**Description:**
Tracks player fairness and skill with decay over time and updates based on finalized match outcomes.

**Key Tasks:**
- [ ] Define `Reputation` with `skill`, `fair_play`, `last_update_ts`.
- [ ] Implement `update_on_match(match_id, players[], outcome)` hook.
- [ ] Implement decay `apply_decay(addr, now_ts)` affecting both components.
- [ ] Emit `reputation_changed` events with deltas.

**Acceptance Criteria:**
- Reputation updates only after match finalization.
- Decay applies consistently and is time-based.
- Events provide enough data for off-chain indexing.

---

## Issue #C5: [ANTICHEAT] Anti-Cheat Oracle Adapter

**Labels:**  `contracts`, `oracle`, `priority: medium`

**New Contract Location:**  `contracts/anti-cheat-oracle/src/lib.rs`

**Description:**
Accepts external anti-cheat confirmations and publishes bounded penalties to the Reputation Index.

**Key Tasks:**
- [ ] Define `EventType::AntiCheatFlag` and confirmation structure.
- [ ] Implement `submit_flag(player, match_id, severity)` with oracle authorization.
- [ ] Expose `get_confirmation(player, match_id)` for consumers.
- [ ] Integrate with Reputation to apply capped penalties.

**Acceptance Criteria:**
- Only authorized oracle addresses can submit flags.
- Reputation penalties are bounded and cannot underflow.
- Confirmations are queryable and auditable via events.

---

## Issue #C6: [TOKEN] ArenaX Token (AX)

**Labels:**  `contracts`, `token`, `priority: high`

**New Contract Location:**  `contracts/ax-token/src/lib.rs`

**Description:**
Implements mint, burn, and transfer with role-based controls and Soroban token semantics.

**Key Tasks:**
- [ ] Implement `mint(to, amount)` and `burn(from, amount)` restricted to Admin.
- [ ] Track balances and `total_supply`.
- [ ] Integrate with staking/payout contracts for transfers.
- [ ] Emit `transfer`, `mint`, `burn` events.

**Acceptance Criteria:**
- Supply accounting is consistent across all operations.
- Unauthorized mint/burn calls revert.
- Token integrates cleanly with staking and prize distribution.

---

## Issue #C7: [STAKING] Tournament Staking Manager

**Labels:**  `contracts`, `staking`, `priority: medium`

**New Contract Location:**  `contracts/staking-manager/src/lib.rs`

**Description:**
Handles staking AX to enter tournaments, lock periods, withdrawals, and slashing linked to dispute outcomes.

**Key Tasks:**
- [ ] Implement `stake(addr, tournament_id, amount)` locking AX.
- [ ] Implement `withdraw(addr, tournament_id)` post-match conditions.
- [ ] Implement `slash(addr, tournament_id, amount)` authorized by dispute resolution.
- [ ] Emit `staked`, `withdrawn`, `slashed` events.

**Acceptance Criteria:**
- Stakes are locked during active participation and unlock after match completion.
- Slashing only occurs upon authorized dispute decisions.
- Balance changes are consistent and evented.

---

## Issue #C8: [REGISTRY] Contract Registry

**Labels:**  `contracts`, `registry`, `priority: medium`

**New Contract Location:**  `contracts/contract-registry/src/lib.rs`

**Description:**
Registers and looks up contracts by name with admin-controlled updates and emits audit events.

**Key Tasks:**
- [ ] Implement `register_contract(name, address)` with unique names.
- [ ] Implement `update_contract(name, new_address)` with admin-only guard.
- [ ] Implement `get_contract(name)` and `list_contracts()`.
- [ ] Emit `register`, `update` events.

**Acceptance Criteria:**
- Registry prevents duplicate names and enforces authorization.
- Consumers can resolve addresses deterministically.
- Updates produce a clear on-chain audit trail.

---

## Issue #C9: [AUTH] Cross-Contract Authorization Gateway

**Labels:**  `contracts`, `auth`, `priority: medium`

**New Contract Location:**  `contracts/auth-gateway/src/lib.rs`

**Description:**
Centralizes role assignment and caller verification used by other contracts to enforce Admin/Operator/Player access.

**Key Tasks:**
- [ ] Define roles and `assign_role(addr, role)` APIs.
- [ ] Implement `has_role(caller, role)` and `require_role(role)` helpers.
- [ ] Integrate with Match/Prize/Dispute via cross-contract checks.
- [ ] Emit role assignment/revocation events.

**Acceptance Criteria:**
- Role checks are reusable and consistent across contracts.
- Unauthorized callers are blocked with deterministic errors.
- Role changes are fully auditable.

---

## Issue #C10: [ESCROW] Prize Escrow Manager

**Labels:**  `contracts`, `escrow`, `priority: medium`

**New Contract Location:**  `contracts/escrow-manager/src/lib.rs`

**Description:**
Manages prize escrow custody independent of distribution logic, enabling holds during disputes and safe transfers.

**Key Tasks:**
- [ ] Implement `deposit(match_id, asset, amount)` and custody tracking.
- [ ] Implement `hold(match_id)` and `release(match_id)` integrations with Dispute module.
- [ ] Implement `transfer(to, asset, amount)` used by Prize Distribution.
- [ ] Emit `deposited`, `held`, `released`, `transferred` events.

**Acceptance Criteria:**
- Escrow custody is isolated and robust during disputes.
- Transfers only occur when holds are cleared.
- Event log provides full traceability of funds.
