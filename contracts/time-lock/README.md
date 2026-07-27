# Time-Lock Contract — ArenaX

A governance time-lock manager deployed on Stellar Soroban that enforces mandatory
waiting periods before sensitive operations are executed. The enhanced v2 contract
adds flexible scheduling windows, multi-governor quorum acceleration, admin governance
override, per-category analytics, and on-chain monitoring snapshots.

---

## Table of Contents

1. [Overview](#overview)
2. [Key Concepts](#key-concepts)
3. [Storage Layout](#storage-layout)
4. [Public API](#public-api)
5. [Flexible Scheduling](#flexible-scheduling)
6. [Acceleration & Quorum Voting](#acceleration--quorum-voting)
7. [Governance Override](#governance-override)
8. [Governor Management](#governor-management)
9. [Analytics](#analytics)
10. [Monitoring](#monitoring)
11. [Events](#events)
12. [Error Reference](#error-reference)
13. [Security Model](#security-model)
14. [Migration from v1](#migration-from-v1)

---

## Overview

The time-lock contract sits between governance decisions and their on-chain
execution. Every sensitive operation — contract upgrades, treasury movements,
parameter changes — must be *scheduled* first and can only be *executed* after a
configurable delay elapses. This gives stakeholders time to review and, if
necessary, cancel malicious or erroneous operations.

```
  Governor              Time-Lock Contract         Target Contract
     │                        │                         │
     │──schedule_operation()──▶│  (delay starts)         │
     │                        │                         │
     │       ... wait delay ...│                         │
     │                        │                         │
     │──execute_operation()───▶│──(invoke target)───────▶│
     │                        │                         │
```

---

## Key Concepts

| Concept | Description |
|---|---|
| **Governor** | An address authorised to schedule, execute, and cancel operations. |
| **Admin** | The single privileged address that can add/remove governors, change config, and invoke the emergency governance override. |
| **Min Delay** | Minimum seconds between scheduling and earliest execution. |
| **Grace Period** | Window *after* `execute_after` during which execution is still valid. Operations not executed within the window expire. |
| **Accel Quorum** | Number of governor votes required to accelerate an operation past its delay. |
| **Category** | Logical grouping of operations (General, Treasury, Upgrade, Governance, Emergency). Used for analytics. |
| **Priority** | Urgency signal (Low, Medium, High, Critical). Informational — does not change scheduling behaviour. |

---

## Storage Layout

### Instance Storage (configuration — cheap to read)

| Key | Type | Description |
|---|---|---|
| `Admin` | `Address` | The admin address |
| `MinDelay` | `u64` | Minimum delay in seconds |
| `GracePeriod` | `u64` | Default execution window in seconds |
| `AccelQuorum` | `u32` | Votes needed to accelerate an operation |
| `Governors` | `Vec<Address>` | List of active governors (≤ 20) |

### Persistent Storage (per-operation / analytics)

| Key | Type | Description |
|---|---|---|
| `Operation(id)` | `Operation` | Full operation struct |
| `AccelVotes(id)` | `Vec<Address>` | Governors who voted to accelerate |
| `ActiveCount` | `u32` | Number of currently scheduled (pending) operations |
| `AnalyticsTotal` | `AnalyticsTotals` | Global counters |
| `AnalyticsByCategory(cat)` | `CategoryStats` | Per-category counters |
| `LastExecution` | `u64` | Timestamp of most recent execution |

---

## Public API

### Initialization

```rust
pub fn initialize(
    env: Env,
    admin: Address,
    min_delay: u64,
    grace_period: u64,
    accel_quorum: u32,
)
```

Call once on deployment. The `admin` is also automatically added as the first
governor.  Panics with `"already initialized"` on subsequent calls.

**Example (Soroban CLI):**
```bash
stellar contract invoke --id $CONTRACT \
  -- initialize \
  --admin GXXX... \
  --min_delay 86400 \
  --grace_period 604800 \
  --accel_quorum 2
```

---

### Scheduling

```rust
pub fn schedule_operation(
    env: Env,
    caller: Address,          // must be a governor
    operation_id: BytesN<32>, // unique identifier
    target: Address,          // contract to call
    function_name: Symbol,    // function on target
    args: Bytes,              // ABI-encoded args
    delay: u64,               // seconds ≥ min_delay
    description: Symbol,      // short human-readable label
    category: u32,            // see CATEGORY_* constants
    priority: u32,            // see PRIORITY_* constants
    custom_grace_period: u64, // 0 = use contract default
)
```

Registers a new pending operation. The operation can be executed any time in the
window `[now + delay, now + delay + grace_period]`.

**Categories:**

| Constant | Value | Use case |
|---|---|---|
| `CATEGORY_GENERAL` | 0 | Default |
| `CATEGORY_TREASURY` | 1 | Fund movements |
| `CATEGORY_UPGRADE` | 2 | Contract upgrades |
| `CATEGORY_GOVERNANCE` | 3 | Governance changes |
| `CATEGORY_EMERGENCY` | 4 | Time-sensitive actions |

**Priorities:**

| Constant | Value |
|---|---|
| `PRIORITY_LOW` | 0 |
| `PRIORITY_MEDIUM` | 1 |
| `PRIORITY_HIGH` | 2 |
| `PRIORITY_CRITICAL` | 3 |

---

### Execution

```rust
pub fn execute_operation(env: Env, caller: Address, operation_id: BytesN<32>)
```

Executes a scheduled operation. Requires:
- `caller` is a governor.
- `now >= execute_after` (delay elapsed).
- `now <= execute_before` (still within the grace window).

If the grace window has passed, the operation is automatically marked
`STATUS_EXPIRED` and a panic is raised.

---

### Cancellation

```rust
pub fn cancel_operation(env: Env, caller: Address, operation_id: BytesN<32>)
```

Cancels a pending operation. Any governor can cancel any pending operation.

---

### Query

```rust
pub fn get_operation(env: Env, operation_id: BytesN<32>) -> Option<Operation>
pub fn get_admin(env: Env) -> Address
pub fn get_min_delay(env: Env) -> u64
pub fn get_grace_period(env: Env) -> u64
pub fn get_accel_quorum(env: Env) -> u32
pub fn get_governors(env: Env) -> Vec<Address>
pub fn is_governor(env: Env, address: Address) -> bool
pub fn get_accel_votes(env: Env, operation_id: BytesN<32>) -> Vec<Address>
```

---

## Flexible Scheduling

Each operation has an *execution window* defined by two timestamps:

```
  scheduled_at
      │
      │───── delay ──────▶ execute_after ───── grace ──────▶ execute_before
                               │                                    │
                               └──── valid execution window ────────┘
```

- **`delay`**: Must be ≥ `min_delay`. Pass a larger value for lower-priority
  operations that benefit from more review time.
- **`custom_grace_period`**: Override the contract default for this one operation.
  Pass `0` to inherit the contract default. Useful for time-sensitive operations
  that should expire quickly if not executed.

**Expiry**: If execution is attempted after `execute_before`, the operation is
marked `STATUS_EXPIRED` (not `STATUS_CANCELLED`). Expired operations cannot be
re-scheduled using the same `operation_id`.

---

## Acceleration & Quorum Voting

Governors can collectively vote to execute an operation immediately, bypassing the
remaining delay. This is useful for urgent operations (e.g. critical patches) that
were conservatively scheduled with a long delay.

```rust
pub fn vote_accelerate(env: Env, voter: Address, operation_id: BytesN<32>)
```

Rules:
- Only governors may vote.
- Each governor may cast exactly one vote per operation.
- When `total_votes >= accel_quorum`, the operation transitions to
  `STATUS_EXECUTED` immediately.
- Acceleration also increments `total_accelerated` in the analytics totals.

**Example — 2-of-3 quorum:**

```
  gov_a.vote_accelerate(id)  → 1/2 votes, still SCHEDULED
  gov_b.vote_accelerate(id)  → 2/2 votes, EXECUTED immediately
```

---

## Governance Override

The admin can bypass both the delay *and* the quorum mechanism for true emergencies:

```rust
pub fn governance_override(
    env: Env,
    caller: Address,          // must be admin
    operation_id: BytesN<32>,
    execute: bool,            // true = execute, false = cancel
    reason: Symbol,           // audit trail reason
)
```

This is intentionally restricted to the admin only (not all governors) because it
represents a unilateral action that circumvents the quorum safety net. Use sparingly
and ensure the `reason` symbol is descriptive for the on-chain audit trail.

---

## Governor Management

```rust
pub fn add_governor(env: Env, caller: Address, new_governor: Address)
pub fn remove_governor(env: Env, caller: Address, governor: Address)
```

Only the admin can add or remove governors. Constraints:
- Maximum 20 governors (`MAX_GOVERNORS`).
- Cannot add a duplicate governor.
- Cannot remove the last governor (prevents locking out the contract).
- The admin's own address can be removed from the governor list as long as at
  least one other governor remains.

---

## Analytics

All counters are stored on-chain in `Persistent` storage and updated atomically
with every state change.

### Global Totals

```rust
pub fn get_analytics(env: Env) -> AnalyticsTotals
```

```rust
pub struct AnalyticsTotals {
    pub total_scheduled: u64,
    pub total_executed: u64,
    pub total_cancelled: u64,
    pub total_accelerated: u64,
    pub total_expired: u64,
    pub cumulative_delay_secs: u64, // sum of (executed_at - scheduled_at)
}
```

### Average Delay

```rust
pub fn get_average_delay(env: Env) -> u64
```

Returns `cumulative_delay_secs / total_executed`. Returns `0` if no operations
have been executed yet. This measures the *actual* delay from scheduling to
execution (not the configured minimum delay).

### Per-Category Stats

```rust
pub fn get_category_stats(env: Env, category: u32) -> CategoryStats
```

```rust
pub struct CategoryStats {
    pub category: u32,
    pub scheduled: u64,
    pub executed: u64,
    pub cancelled: u64,
}
```

Query for any of the five `CATEGORY_*` values to see how operations in that
category are performing.

---

## Monitoring

```rust
pub fn get_active_count(env: Env) -> u32
pub fn get_last_execution_timestamp(env: Env) -> u64
pub fn emit_snapshot(env: Env)
```

- **`get_active_count`**: Number of operations currently in `STATUS_SCHEDULED`.
  Decremented on execution, cancellation, expiry, or governance override.
- **`get_last_execution_timestamp`**: UNIX timestamp of the most recent successful
  execution. Returns `0` if no execution has occurred.
- **`emit_snapshot`**: Publishes a `MonitoringSnapshot` event with all current
  counters. Call periodically from off-chain monitoring tooling to create a
  queryable on-chain log.

---

## Events

All events are in the `TimeLock` namespace at version `v2`.

| Event | Topic | Trigger |
|---|---|---|
| `OperationScheduled` | `["TimeLock", "SCHEDULED"]` | `schedule_operation` |
| `OperationExecuted` | `["TimeLock", "EXECUTED"]` | `execute_operation` |
| `OperationCancelled` | `["TimeLock", "CANCELLED"]` | `cancel_operation` |
| `OperationExpired` | `["TimeLock", "EXPIRED"]` | Attempted execution after `execute_before` |
| `OperationAccelerated` | `["TimeLock", "ACCELERATED"]` | Quorum reached in `vote_accelerate` |
| `AccelerationVoteCast` | `["TimeLock", "ACCEL_VOTE"]` | Each `vote_accelerate` call |
| `GovernanceOverride` | `["TimeLock", "GOV_OVERRIDE"]` | `governance_override` |
| `GovernorAdded` | `["TimeLock", "GOV_ADDED"]` | `add_governor` |
| `GovernorRemoved` | `["TimeLock", "GOV_REMOVED"]` | `remove_governor` |
| `MinDelayUpdated` | `["TimeLock", "DELAY_UPDATED"]` | `update_min_delay` |
| `GracePeriodUpdated` | `["TimeLock", "WINDOW_UPDATED"]` | `update_grace_period` |
| `QuorumUpdated` | `["TimeLock", "QUORUM_UPDATED"]` | `update_accel_quorum` |
| `MonitoringSnapshot` | `["TimeLock", "SNAPSHOT"]` | `emit_snapshot` |

All events are defined in `contracts/arenax-events/src/time_lock.rs` and
registered in the `events_registry::NAMESPACES` table.

---

## Error Reference

| Panic message | Cause |
|---|---|
| `"already initialized"` | `initialize` called more than once |
| `"delay is less than minimum delay"` | Scheduled `delay < min_delay` |
| `"operation already scheduled"` | Duplicate `operation_id` |
| `"caller is not a governor"` | Non-governor called a governor-gated function |
| `"operation is not in scheduled state"` | Action on non-pending operation |
| `"timelock delay has not expired yet"` | `execute_operation` called too early |
| `"operation execution window has expired"` | `execute_operation` called after `execute_before` |
| `"already voted to accelerate this operation"` | Governor voted twice |
| `"only admin may invoke governance override"` | Non-admin called `governance_override` |
| `"only admin can add governors"` | Non-admin called `add_governor` |
| `"only admin can remove governors"` | Non-admin called `remove_governor` |
| `"address is already a governor"` | Duplicate `add_governor` |
| `"cannot remove the last governor"` | Would lock out all governors |
| `"address is not a governor"` | `remove_governor` for unknown address |
| `"governor limit reached"` | Exceeded `MAX_GOVERNORS` (20) |
| `"only admin can perform this action"` | Non-admin called `update_min_delay` etc. |
| `"grace period must be > 0"` | Zero-second grace period |
| `"quorum must be > 0"` | Zero quorum |
| `"not initialized"` | Any call before `initialize` |
| `"operation not found"` | Unknown `operation_id` |

---

## Security Model

### Defence-in-depth layers

1. **Delay**: All operations wait at least `min_delay` seconds.  Even if a
   governor is compromised, the delay gives other stakeholders time to react and
   cancel.

2. **Grace Window**: Operations that are not executed promptly expire
   automatically, preventing stale proposals from being executed long after their
   context has changed.

3. **Multi-governor scheduling**: Scheduling requires a governor signature, so
   any operation originates from an authorised party with a recorded `proposer`.

4. **Quorum-based acceleration**: Bypassing the delay requires collective
   agreement (`accel_quorum` votes). A single compromised governor cannot
   accelerate without co-operation from peers.

5. **Admin-only override**: The nuclear option (`governance_override`) is
   restricted to the admin and emits a `GovernanceOverride` event for full
   auditability. The admin key should be protected by a multisig.

6. **Governor cap**: The maximum of 20 governors prevents gas-expensive iteration
   and discourages governance bloat.

### Recommended production settings

| Parameter | Recommended value | Rationale |
|---|---|---|
| `min_delay` | `86 400` (1 day) | Allows 24 h of community review |
| `grace_period` | `604 800` (7 days) | Generous window before expiry |
| `accel_quorum` | Majority of governors | Prevents single-governor acceleration |

---

## Migration from v1

The v2 contract is not a drop-in upgrade of v1 — it requires re-deployment and
re-initialization because the storage schema has changed.

### What changed

| Feature | v1 | v2 |
|---|---|---|
| Governors | Single admin | Multi-governor list (≤ 20) |
| Execution window | No expiry | Grace period / expiry |
| Acceleration | Admin-only bypass | Quorum voting |
| Governance override | None | Admin-only `governance_override` |
| Categories | None | 5 categories with analytics |
| Priority | None | 4 priority levels |
| Analytics | None | Global + per-category counters |
| Monitoring | None | Active count, last-execution ts, snapshot events |
| Events | 4 event types | 13 event types |

### Migration steps

1. Deploy the new v2 contract.
2. Call `initialize` with desired `min_delay`, `grace_period`, and `accel_quorum`.
3. Add additional governors with `add_governor`.
4. Pause the v1 contract (if it has a pause mechanism) or coordinate with
   governance to stop new v1 scheduling.
5. For any active v1 operations still pending: either execute them through v1
   before the cutover, or cancel them and re-schedule on v2.
6. Update all off-chain tooling to listen for v2 events (`"TimeLock"` / `"v2"`).
