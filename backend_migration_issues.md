# ArenaX Backend Migration: Atomic Technical Roadmap

This document provides a exhaustive, step-by-step roadmap for rebuilding the ArenaX backend in the `/server` directory. It deconstructs the system into **40+ atomic GitHub issues** to ensure maximum clarity and parallel development.

---

## Phase 1: Infrastructure & Observability

### [CORE-01] Structured Logging & Request Tracing
- **Work Directory**: `/server`
- **Description**: Implement a robust logging system using `winston` or `pino`.
- **Tasks**:
    - [ ] Setup Winston logger with different levels (info, warn, error).
    - [ ] Implement a request-id middleware to trace logs across a single request.
    - [ ] Configure stream rotation for log files.

### [CORE-02] Global Error Handling & Telemetry
- **Work Directory**: `/server`
- **Description**: Standardize API error responses.
- **Tasks**:
    - [ ] Create a `BaseError` class and specialized subclasses (e.g., `NotFoundError`, `ValidationError`).
    - [ ] Implement a global error handler middleware that masks internal details in production.
    - [ ] Add Sentry or OpenTelemetry hooks for error monitoring.

### [CORE-03] Security Hardening & Rate Limiting
- **Work Directory**: `/server`
- **Description**: Basic security layers for the public API.
- **Tasks**:
    - [ ] Configure `helmet.js` with strict CSP and HSTS.
    - [ ] Implement `express-rate-limit` on sensitive routes (Login, Register).
    - [ ] Configure CORS for specific ArenaX domains.

---

## Phase 2: Authentication & Identity

### [AUTH-01] Passport/Auth Strategy Setup
- **Work Directory**: `/server`
- **Description**: Base configuration for authentication strategies.
- **Tasks**:
    - [ ] Setup Passport.js (or custom logic) with JWT strategy.
    - [ ] Implementation of Secret/Public key management for token signing.

### [AUTH-02] User Registration & Email Normalization
- **Work Directory**: `/server`
- **Description**: Create the registration endpoint with strict data normalization.
- **Tasks**:
    - [ ] lowerCase email normalization during storage.
    - [ ] Password hashing with `bcrypt` (12 rounds).
    - [ ] Auto-generation of a unique `username` if not provided.

### [AUTH-03] Login API & Refresh Token Rotation
- **Work Directory**: `/server`
- **Description**: Implement secure login with short-lived access tokens and long-lived refresh tokens.
- **Tasks**:
    - [ ] Creation of `accessToken` (15m) and `refreshToken` (7d).
    - [ ] Implement `refreshToken` rotation (detect reuse and invalidate family).
    - [ ] `POST /auth/login` and `POST /auth/logout` handlers.

### [AUTH-04] Authorization Middleware (RBAC)
- **Work Directory**: `/server`
- **Description**: Role-based access control for ArenaX features.
- **Tasks**:
    - [ ] Create `restrictTo(roles: string[])` middleware.
    - [ ] Protect `/admin` and `/governance` routes.

### [AUTH-05] User Profile & Social Metadata
- **Work Directory**: `/server`
- **Description**: Manage user-level metadata.
- **Tasks**:
    - [ ] Implementation of `GET /profiles/:username`.
    - [ ] `PATCH /profiles/me` with Zod validation for social links and bio.

---

## Phase 3: Financial Ledger & Wallets

### [WALT-01] Multi-Currency Schema & Decimal Ledger
- **Work Directory**: `/server`
- **Description**: Configure the DB for high-precision financial data.
- **Tasks**:
    - [ ] Configure Prisma with `Decimal` for XLM, USDC, and NGN balances.
    - [ ] Define `WalletTransaction` history model with `status` (PENDING, SUCCESS, FAILED).

### [WALT-02] Internal Transfer & Ledger CRUD
- **Work Directory**: `/server`
- **Description**: Basic ledger movements within the platform.
- **Tasks**:
    - [ ] Implement `addBalance` and `deductBalance` methods with ACID transactions.
    - [ ] Create a `getOrCreateWallet(userId)` factory.

### [WALT-03] Atomic Escrow Implementation
- **Work Directory**: `/server`
- **Description**: Lock funds for matches and tournaments.
- **Tasks**:
    - [ ] Implement `lockFundsToEscrow(userId, amount, matchId)` logic.
    - [ ] Implement `releaseEscrow(matchId)` and `slashEscrow(matchId)` methods.

### [WALT-04] Fiat Gateway: Paystack Integration
- **Work Directory**: `/server`
- **Description**: Connect Nigerian Naira (NGN) rails.
- **Tasks**:
    - [ ] Implementation of `PaystackService.verifyTransaction(ref)`.
    - [ ] Secure Webhook handler for `charge.success`.

### [WALT-05] Redis Real-Time Balance Stream
- **Work Directory**: `/server`
- **Description**: Push balance updates to the frontend instantly.
- **Tasks**:
    - [ ] Setup Redis Pub/Sub for `wallet:{userId}:update`.
    - [ ] Implement balance change observer in the `WalletService`.

---

## Phase 4: Stellar & Soroban Orchestration

### [BLOCK-01] Ed25519 Account Generation
- **Work Directory**: `/server`
- **Description**: Programmable account creation on Stellar.
- **Tasks**:
    - [ ] Implement utility for `Keypair.random()`.
    - [ ] Create `StellarService.registerUserWallet(userId)`.

### [BLOCK-02] AES-256-GCM Encryption Utility
- **Work Directory**: `/server`
- **Description**: Secure storage of Stellar secret keys.
- **Tasks**:
    - [ ] Implement `EncryptionService` using `crypto`.
    - [ ] `encryptSecret(plain)` and `decryptSecret(cipher)`.

### [BLOCK-03] Transaction Submission & Hash Tracking
- **Work Directory**: `/server`
- **Description**: Base layer for sending Stellar transactions.
- **Tasks**:
    - [ ] Build a generic `submitTransaction(tx)` wrapper.
    - [ ] Log every `tx_hash` to the `BlockchainTransaction` table immediately.

### [SORO-01] Soroban RPC Client & Health
- **Work Directory**: `/server`
- **Description**: Interactive layer with the Soroban network.
- **Tasks**:
    - [ ] Setup `SorobanRpc.Server` with failover endpoints.
    - [ ] Implement a health check utility to verify RPC connectivity.

### [SORO-02] Smart Contract XDR Builder
- **Work Directory**: `/server`
- **Description**: Utility for building Soroban contract calls.
- **Tasks**:
    - [ ] Implement `buildInvokeXDR(contractId, function, args)`.
    - [ ] Data-type mapping for `SCVal` (Address, Symbol, Vec).

### [SORO-03] Simulation & Fee Estimation
- **Work Directory**: `/server`
- **Description**: Predict resource consumption before submission.
- **Tasks**:
    - [ ] Implementation of `simulateTransaction(tx)`.
    - [ ] Logic for increasing `resourceFees` based on simulation results.

### [SORO-04] Exponential Backoff Monitor
- **Work Directory**: `/server`
- **Description**: Reliable monitoring for transaction finality.
- **Tasks**:
    - [ ] Implement a monitoring worker that polls `getTransaction`.
    - [ ] Use exponential backoff (1s, 2s, 4s...) logic.

### [SORO-05] Fee Payer Account Abstraction
- **Work Directory**: `/server`
- **Description**: Implement Sponsored Transactions for gasless UX.
- **Tasks**:
    - [ ] Logic for backend signature as Source/FeePayer.
    - [ ] Dual signature reassembly for Soroban transactions.

---

## Phase 5: Gaming Engine

### [MATCH-01] Redis Matchmaking Architecture
- **Work Directory**: `/server`
- **Description**: High-performance matchmaking storage.
- **Tasks**:
    - [ ] Design Redis Sets structure for `queue:elo:{group}`.
    - [ ] Implement logic to add/remove players from the queue.

### [MATCH-02] Pairing Worker & Logic
- **Work Directory**: `/server`
- **Description**: The core logic that matches two players.
- **Tasks**:
    - [ ] Create a background worker that scans Redis sets for pairs.
    - [ ] Handle "Stale Player" cleanup from the queue.

### [MATCH-03] Elo Search Radius Expansion
- **Work Directory**: `/server`
- **Description**: Dynamic matchmaking that expands search as wait time grows.
- **Tasks**:
    - [ ] Implement `wait_time` based elo delta adjustment.
    - [ ] Log matchmaking metrics for performance tuning.

### [GAME-01] Elo Engine (K-Factor 32)
- **Work Directory**: `/server`
- **Description**: Core rating logic.
- **Tasks**:
    - [ ] Implement `calculateRating(ratingA, ratingB, outcome)`.
    - [ ] Create `EloHistory` records for auditability.

### [GAME-02] Match State Machine
- **Work Directory**: `/server`
- **Description**: Lifecycle of a single game match.
- **Tasks**:
    - [ ] Enforce state transitions: `PENDING` -> `ACTIVE` -> `SETTLED`.
    - [ ] Prevent actions in invalid states (e.g., reporting a finished match).

### [GAME-03] Result Reporting & Conflict Detection
- **Work Directory**: `/server`
- **Description**: Multi-player result verification.
- **Tasks**:
    - [ ] Implement `POST /matches/:id/report`.
    - [ ] Logic to detect when Player A and Player B results conflict.

### [GAME-04] Match Timeout & Auto-Forfeit
- **Work Directory**: `/server`
- **Description**: Handle inactive players in active matches.
- **Tasks**:
    - [ ] Create a "Reaper" service that marks matches as `FORFEIT` after 24h of no reports.

---

## Phase 6: Tournament Management

### [TOURN-01] Tournament Seed & Generation
- **Work Directory**: `/server`
- **Description**: Setup brackets for new tournaments.
- **Tasks**:
    - [ ] Implement `seedTournament(participants)` logic.
    - [ ] Create initial `Match` records for Round 1.

### [TOURN-02] Round Advancement Orchestrator
- **Work Directory**: `/server`
- **Description**: Move winners forward in the bracket.
- **Tasks**:
    - [ ] Implement checking logic: "Have all matches in Round X finished?".
    - [ ] Generate Round X+1 matches dynamically.

### [TOURN-03] Idempotent Payout Processor
- **Work Directory**: `/server`
- **Description**: Ensure rewards are only paid once.
- **Tasks**:
    - [ ] Use `match_id` as an idempotency key in the `Payouts` table.
    - [ ] Implement "Check-Before-Pay" logic.

### [TOURN-04] Prize Pool Distribution Calc
- **Work Directory**: `/server`
- **Description**: Split the prize pool among top N players.
- **Tasks**:
    - [ ] Implement ratio-based distribution (e.g., 50% to 1st, 30% to 2nd).
    - [ ] Handle fractional remainders with a platform fee "dust" collector.

---

## Phase 7: Real-Time & Sync

### [WS-01] Socket.io Server Setup
- **Work Directory**: `/server`
- **Description**: Enable real-time duplex communication.
- **Tasks**:
    - [ ] Setup Socket.io with JWT authentication midddleware.
    - [ ] Handle connection/disconnection heartbeats.

### [WS-02] Redis-to-Socket Bridge
- **Work Directory**: `/server`
- **Description**: Broadcast backend events to users.
- **Tasks**:
    - [ ] Subscribe to Redis balance/match events.
    - [ ] Dispatch `emit` events to specific User-Id rooms.

### [SYNC-01] Soroban Event Polling Logic
- **Work Directory**: `/server`
- **Description**: Background syncing from the chain.
- **Tasks**:
    - [ ] Implement `fetchEvents(pagingToken)` loop.
    - [ ] Persistent storage of the `lastPagingToken` in the database.

### [SYNC-02] XDR Event Decoder Utility
- **Work Directory**: `/server`
- **Description**: Turn SCVal events into human-readable data.
- **Tasks**:
    - [ ] Implement parser for `TournamentStarted`, `MatchSettled`, etc.
    - [ ] Map decoded data to Prisma model updates.

---

## Phase 8: Governance & Moderation

### [GOV-01] Proposal State Machine
- **Work Directory**: `/server`
- **Description**: Manage multisig governance flow.
- **Tasks**:
    - [ ] Define proposal statuses: `DRAFT`, `VOTING`, `APPROVED`, `EXECUTED`.
    - [ ] Secure `approve` endpoint restricted to Governance roles.

### [GOV-02] Reputation Score Ledger
- **Work Directory**: `/server`
- **Description**: Track user conduct.
- **Tasks**:
    - [ ] Implement increment/decrement triggers for good/bad behavior.
    - [ ] Logic for reputation-based cooldowns on matchmaking.

### [GOV-03] Dispute Resolution Dashboard
- **Work Directory**: `/server`
- **Description**: Admin tools for fixing match conflicts.
- **Tasks**:
    - [ ] Implement `AdminOverrideMatch(matchId, winnerId)` with full audit trail.
