# Requirements Document

## Introduction

This spec covers four interconnected deliverables for the ArenaX gaming platform's Soroban/Stellar smart contract layer:

1. **Comprehensive Testing Suite** (Issue #316) — Extend the existing `contracts/testing-infrastructure` to cover the new contracts introduced in issues #313–315, enforce ≥95% coverage across all contracts, and integrate the full audit pipeline into CI/CD.
2. **Data Analytics Contract** (Issue #314) — Extend `contracts/analytics` with aggregation, insight calculation, model management, report generation, and access-auditing capabilities while preserving player privacy.
3. **Anti-Cheat Contract** (Issue #313) — The `contracts/anti-cheat` contract is largely implemented; this spec formalises the remaining gaps: governance integration, cross-contract reputation penalties, and property-based test coverage.
4. **Upgrade System Contract** (Issue #315) — The `contracts/upgrade-system` contract is largely implemented; this spec formalises the remaining gaps: upgrade scheduling, compatibility checks, simulation environment, and notification hooks.

All contracts are written in Rust targeting the Soroban SDK (v23.5.2) and compiled to WASM for the Stellar network.

---

## Glossary

- **Analytics_Contract**: The Soroban smart contract at `contracts/analytics/` responsible for recording and aggregating on-chain game metrics.
- **Anti_Cheat_Contract**: The Soroban smart contract at `contracts/anti-cheat/` responsible for detecting suspicious behaviour, applying sanctions, and managing appeals.
- **Upgrade_System**: The Soroban smart contract at `contracts/upgrade-system/` responsible for governance-controlled contract upgrades.
- **Testing_Infrastructure**: The crate at `contracts/testing-infrastructure/` providing shared test utilities, property-based tests, integration tests, benchmarks, and CI/CD configuration.
- **Reporter**: An authorised contract address (e.g. a match contract) permitted to submit data to the Analytics_Contract.
- **Player**: An on-chain `Address` representing a platform participant.
- **Trust_Score**: A u32 value in the range 0–100 maintained by the Anti_Cheat_Contract reflecting a player's behavioural history.
- **Sanction**: A penalty record stored by the Anti_Cheat_Contract (Warning, TemporaryBan, PermanentBan, ReputationPenalty, PrizeForfeiture).
- **Upgrade_Proposal**: A governance-submitted record in the Upgrade_System describing a contract upgrade candidate.
- **Timelock**: A mandatory delay (in seconds) between upgrade approval and execution.
- **Governance_Contract**: The on-chain multisig governance contract that authorises upgrade proposals and anti-cheat parameter changes.
- **CI/CD_Pipeline**: The GitHub Actions workflow defined in `contracts/testing-infrastructure/.github/workflows/test-suite.yml`.
- **Property_Test**: A test that verifies a logical property holds for a large set of generated inputs (using `proptest` or `quickcheck`).
- **Round_Trip**: A property test that verifies `decode(encode(x)) == x` or an equivalent inverse pair.
- **Fuzz_Test**: A test that feeds random or mutated inputs to a function to discover unexpected panics or incorrect behaviour.
- **Gas_Benchmark**: A Criterion benchmark measuring CPU instruction counts for a contract function.
- **Coverage_Report**: An output of `cargo-llvm-cov` or equivalent showing line/branch coverage percentages per contract.

---

## Requirements

### Requirement 1: Analytics Contract — Metric Recording

**User Story:** As a match contract (Reporter), I want to record completed match metrics on-chain, so that the platform can track game health and volume.

#### Acceptance Criteria

1. WHEN a Reporter calls `record_match` with a valid `game_id`, `match_id`, `duration_secs`, `wager_amount`, `reward_amount`, and `player_count`, THE Analytics_Contract SHALL update the `GameMetrics` entry for that `game_id` using a rolling average for `avg_match_duration_secs`.
2. WHEN a Reporter calls `record_match`, THE Analytics_Contract SHALL increment `PlatformMetrics.total_matches_all_time` and add `wager_amount` to `PlatformMetrics.total_volume`.
3. IF a caller that is neither the admin nor an authorised Reporter calls `record_match`, THEN THE Analytics_Contract SHALL panic with an "not an authorised reporter" error.
4. IF the Analytics_Contract is paused, THEN THE Analytics_Contract SHALL panic with a "contract is paused" error on any state-mutating call.
5. WHEN `record_match` succeeds, THE Analytics_Contract SHALL emit a `MATCH_REC` event containing `game_id`, `match_id`, `duration_secs`, `wager_amount`, `reward_amount`, and `player_count` without including any raw player addresses.

---

### Requirement 2: Analytics Contract — Player Behaviour Recording

**User Story:** As a match contract (Reporter), I want to record per-player behaviour snapshots, so that the platform can derive insights while preserving player privacy.

#### Acceptance Criteria

1. WHEN a Reporter calls `record_player_behaviour` with a `player` address, THE Analytics_Contract SHALL hash the player address with the contract salt before storing any data, and SHALL NOT store the raw address in persistent storage.
2. WHEN a Reporter calls `record_player_behaviour`, THE Analytics_Contract SHALL update the `PlayerBehaviourSnapshot` for the hashed player key, incrementing `matches_played`, updating `wins` or `losses`, and recalculating `avg_session_secs` as a rolling average.
3. WHEN `record_player_behaviour` succeeds, THE Analytics_Contract SHALL emit a `PLR_BEH` event containing only the hashed player identifier, never the raw address.
4. WHEN `get_player_behaviour` is called, THE Analytics_Contract SHALL require that the caller is either the admin or the player themselves, and SHALL return the `PlayerBehaviourSnapshot` for that player.
5. IF an unauthorised caller invokes `get_player_behaviour`, THEN THE Analytics_Contract SHALL panic with a "not authorised" error.

---

### Requirement 3: Analytics Contract — Platform Insights and Reporting

**User Story:** As a platform operator, I want to query aggregated platform metrics and generate analytics reports, so that I can monitor platform health.

#### Acceptance Criteria

1. THE Analytics_Contract SHALL expose a `get_platform_metrics` view function that returns the current `PlatformMetrics` without requiring authentication.
2. THE Analytics_Contract SHALL expose a `get_game_metrics` view function that returns `Option<GameMetrics>` for a given `game_id` without requiring authentication.
3. WHEN the admin calls `update_staked` via an authorised Reporter, THE Analytics_Contract SHALL update `PlatformMetrics.total_staked` to the provided value.
4. THE Analytics_Contract SHALL expose an `add_reporter` function callable only by the admin that registers a new authorised Reporter address.
5. THE Analytics_Contract SHALL expose a `remove_reporter` function callable only by the admin that deregisters a Reporter address.
6. THE Analytics_Contract SHALL expose a `set_paused` function callable only by the admin that toggles the paused state.

---

### Requirement 4: Anti-Cheat Contract — Suspicious Activity Reporting

**User Story:** As a platform participant, I want to report suspicious player behaviour with evidence, so that cheaters can be identified and sanctioned.

#### Acceptance Criteria

1. WHEN `report_suspicious_activity` is called with a `severity` outside the range 1–10, THE Anti_Cheat_Contract SHALL panic with an "invalid severity" error.
2. WHEN `report_suspicious_activity` is called before the `report_cooldown` has elapsed for the same (reporter, player, match_id) combination, THE Anti_Cheat_Contract SHALL panic with a "report cooldown not met" error.
3. WHEN a valid `report_suspicious_activity` call is made, THE Anti_Cheat_Contract SHALL calculate a `confidence_score` and `false_positive_risk` for the report and store them in the `SuspiciousActivity` record.
4. WHEN a valid `report_suspicious_activity` call is made with `anonymous = true`, THE Anti_Cheat_Contract SHALL create a `WhistleblowerProtection` record for the reporter with `anonymous = true`.
5. WHEN `report_suspicious_activity` is called in emergency mode with a `confidence_score` above 80, THE Anti_Cheat_Contract SHALL automatically call `verify_activity` to verify the report.

---

### Requirement 5: Anti-Cheat Contract — Sanctions and Appeals

**User Story:** As a platform admin, I want to apply, review, and overturn sanctions, so that fair play is enforced and false positives can be corrected.

#### Acceptance Criteria

1. WHEN `apply_sanction` is called by the admin, THE Anti_Cheat_Contract SHALL create a `Sanction` record with status `Active`, calculate `end_time` from `duration` (or `u64::MAX` for permanent), and set `appeal_deadline` to `current_time + appeal_window`.
2. IF `apply_sanction` is called by a non-admin address, THEN THE Anti_Cheat_Contract SHALL panic with an authentication error.
3. WHEN `appeal_sanction` is called by the sanctioned player within the `appeal_deadline`, THE Anti_Cheat_Contract SHALL create an `Appeal` record and update the `Sanction` status to `Appealed`.
4. IF `appeal_sanction` is called by an address that does not match the sanctioned player, THEN THE Anti_Cheat_Contract SHALL panic with a "not your sanction" error.
5. IF `appeal_sanction` is called after the `appeal_deadline` has passed, THEN THE Anti_Cheat_Contract SHALL panic with an "appeal deadline passed" error.
6. WHEN `review_appeal` is called by the admin with `approved = true`, THE Anti_Cheat_Contract SHALL update the `Sanction` status to `Overturned` and partially restore the player's `Trust_Score` by adding 30 points (capped at 100).
7. WHEN `review_appeal` is called by the admin with `approved = false`, THE Anti_Cheat_Contract SHALL update the `Sanction` status to `Upheld`.
8. IF `review_appeal` is called on an already-reviewed appeal, THEN THE Anti_Cheat_Contract SHALL panic with an "appeal already reviewed" error.

---

### Requirement 6: Anti-Cheat Contract — Trust Score and Governance

**User Story:** As a platform operator, I want trust scores to reflect player behaviour accurately and be governed transparently, so that the anti-cheat system remains fair and adaptable.

#### Acceptance Criteria

1. THE Anti_Cheat_Contract SHALL initialise a new player's `Trust_Score` to 100 when first queried via `get_player_trust_score`.
2. WHEN a suspicious activity report is recorded, THE Anti_Cheat_Contract SHALL reduce the reported player's `Trust_Score` by a penalty proportional to `severity * confidence_score / 100`, capped at 10 points per unverified report.
3. WHEN a confirmed cheat is recorded, THE Anti_Cheat_Contract SHALL reduce the player's `Trust_Score` by a penalty proportional to `severity * 5 * confidence_score / 100`, capped at 50 points.
4. WHEN `update_anticheat_params` is called by the admin, THE Anti_Cheat_Contract SHALL update the stored `AntiCheatParams`.
5. IF `update_anticheat_params` is called by a non-admin address, THEN THE Anti_Cheat_Contract SHALL panic with an "only admin can update parameters" error.
6. WHEN `set_emergency_mode` is called by the admin, THE Anti_Cheat_Contract SHALL update both the `EmergencyMode` storage key and the `emergency_mode` field in `AntiCheatParams`.

---

### Requirement 7: Upgrade System — Proposal Lifecycle

**User Story:** As a governance participant, I want to propose, validate, approve, and execute contract upgrades, so that the protocol can be improved safely.

#### Acceptance Criteria

1. WHEN `propose_upgrade` is called by the governance address with a `timelock_duration` below `min_timelock_duration`, THE Upgrade_System SHALL return `Err(UpgradeError::TimelockTooShort)`.
2. WHEN `propose_upgrade` is called with a `proposal_id` that already exists, THE Upgrade_System SHALL return `Err(UpgradeError::ProposalAlreadyExists)`.
3. WHEN a valid `propose_upgrade` call is made, THE Upgrade_System SHALL store the proposal with status `Pending` and set `timelock_end = current_timestamp + timelock_duration`.
4. WHEN `validate_upgrade` is called with `breaking_changes = true` or non-empty `security_issues` or `compatibility_score < 70`, THE Upgrade_System SHALL return the corresponding validation error.
5. WHEN `validate_upgrade` passes all checks, THE Upgrade_System SHALL update the proposal status to `Validated` and store the `ValidationResult`.
6. WHEN `approve_upgrade` is called and the approval count reaches `required_approvals`, THE Upgrade_System SHALL update the proposal status to `Scheduled`.
7. IF `approve_upgrade` is called by an address that has already approved the same proposal, THE Upgrade_System SHALL return `Err(UpgradeError::AlreadyApproved)`.

---

### Requirement 8: Upgrade System — Execution, Rollback, and Emergency Controls

**User Story:** As a governance executor, I want to execute approved upgrades, roll back failed ones, and pause contracts in emergencies, so that the protocol remains safe and recoverable.

#### Acceptance Criteria

1. WHEN `execute_upgrade` is called before the `timelock_end` timestamp, THE Upgrade_System SHALL return `Err(UpgradeError::TimelockNotExpired)`.
2. WHEN `execute_upgrade` is called on a proposal that has already been executed, THE Upgrade_System SHALL return `Err(UpgradeError::ProposalAlreadyExecuted)`.
3. WHEN `execute_upgrade` is called on a paused contract, THE Upgrade_System SHALL return `Err(UpgradeError::ContractPaused)`.
4. WHEN `execute_upgrade` succeeds, THE Upgrade_System SHALL add an `UpgradeHistoryEntry` to the contract's history with `success = true`.
5. WHEN `rollback_upgrade` is called by the governance address, THE Upgrade_System SHALL restore the contract's stored WASM hash to the previous value recorded in `RollbackInfo`.
6. IF `rollback_upgrade` is called for a contract with no prior upgrade recorded, THE Upgrade_System SHALL return `Err(UpgradeError::NoRollbackAvailable)`.
7. WHEN `emergency_pause` is called by the governance address, THE Upgrade_System SHALL set `EmergencyState.is_paused = true` for the target contract.
8. WHEN `unpause_contract` is called by the governance address, THE Upgrade_System SHALL set `EmergencyState.is_paused = false` for the target contract.

---

### Requirement 9: Testing Infrastructure — Unit Test Coverage

**User Story:** As a developer, I want comprehensive unit tests for all contract functions, so that regressions are caught immediately.

#### Acceptance Criteria

1. THE Testing_Infrastructure SHALL contain unit tests for every public function of the Analytics_Contract, Anti_Cheat_Contract, and Upgrade_System, covering both success paths and all documented error/panic conditions.
2. THE Testing_Infrastructure SHALL achieve a line coverage of at least 95% across all contracts in the workspace when measured by `cargo-llvm-cov`.
3. WHEN a unit test exercises an error condition, THE Testing_Infrastructure SHALL assert the exact panic message or `Err` variant returned by the contract.
4. THE Testing_Infrastructure SHALL include at least one test per contract that verifies the correct event is emitted after a state-changing operation.
5. THE Testing_Infrastructure SHALL include edge-case tests for boundary values: severity = 1, severity = 10, severity = 11; timelock at exactly `min_timelock_duration`; trust score at 0 and 100.

---

### Requirement 10: Testing Infrastructure — Property-Based and Fuzz Tests

**User Story:** As a security engineer, I want property-based and fuzz tests for critical contract invariants, so that unexpected inputs cannot corrupt state.

#### Acceptance Criteria

1. THE Testing_Infrastructure SHALL include a property test verifying that for all valid `wager_amount` and `reward_amount` inputs, `PlatformMetrics.total_volume` after N `record_match` calls equals the sum of all `wager_amount` values (token conservation invariant).
2. THE Testing_Infrastructure SHALL include a property test verifying that a player's `Trust_Score` never exceeds 100 and never goes below 0 regardless of the sequence of reports and sanctions applied.
3. THE Testing_Infrastructure SHALL include a property test verifying that `Upgrade_System` proposal status transitions are monotonic: a proposal never moves from a later status back to an earlier one.
4. THE Testing_Infrastructure SHALL include a round-trip property test verifying that serialising and deserialising `GameMetrics`, `PlayerBehaviourSnapshot`, `Sanction`, and `UpgradeProposal` via the Soroban XDR codec produces an equivalent value.
5. THE Testing_Infrastructure SHALL include a fuzz test that submits random `Bytes` as `evidence` and `action` inputs to `report_suspicious_activity` and `validate_game_action` and verifies neither function panics with an unhandled error.
6. THE Testing_Infrastructure SHALL include a property test verifying that applying the same `AntiCheatParams` update twice produces the same stored state as applying it once (idempotence).

---

### Requirement 11: Testing Infrastructure — Integration Tests

**User Story:** As a developer, I want integration tests covering cross-contract workflows, so that contract interactions are validated end-to-end.

#### Acceptance Criteria

1. THE Testing_Infrastructure SHALL include an integration test that deploys the Analytics_Contract and a mock Reporter contract, records 10 matches, and asserts that `PlatformMetrics.total_matches_all_time` equals 10.
2. THE Testing_Infrastructure SHALL include an integration test that deploys the Anti_Cheat_Contract and the Upgrade_System together, verifies that a paused contract blocks upgrade execution, and verifies that unpausing re-enables execution.
3. THE Testing_Infrastructure SHALL include an integration test covering the full upgrade lifecycle: propose → validate → approve (N times) → wait for timelock → execute → verify history entry.
4. THE Testing_Infrastructure SHALL include an integration test covering the full anti-cheat sanction lifecycle: report → verify → apply sanction → appeal → review (approve) → verify trust score restored.
5. THE Testing_Infrastructure SHALL include an integration test verifying that the Analytics_Contract correctly rejects a `record_match` call from an unregistered Reporter address.

---

### Requirement 12: Testing Infrastructure — Gas Benchmarks and CI/CD

**User Story:** As a platform engineer, I want gas benchmarks and an automated CI/CD pipeline, so that performance regressions and security issues are caught before deployment.

#### Acceptance Criteria

1. THE Testing_Infrastructure SHALL include Criterion benchmarks for `record_match`, `record_player_behaviour`, `report_suspicious_activity`, `apply_sanction`, `propose_upgrade`, `validate_upgrade`, `approve_upgrade`, and `execute_upgrade`.
2. THE CI/CD_Pipeline SHALL run unit tests, integration tests, property tests, coverage checks, and security scans on every pull request targeting `main` or `develop`.
3. THE CI/CD_Pipeline SHALL fail the build if measured line coverage falls below 95% for any contract in the workspace.
4. THE CI/CD_Pipeline SHALL run `cargo audit` and `cargo clippy -- -D warnings` as mandatory quality gates.
5. THE CI/CD_Pipeline SHALL publish a coverage report artifact and a benchmark comparison artifact on every successful run.
6. WHERE the CI/CD environment supports nightly scheduling, THE CI/CD_Pipeline SHALL run a full security scan including `cargo-geiger` for unsafe code detection at 02:00 UTC daily.
