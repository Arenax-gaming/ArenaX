# 🎮 ArenaX Documentation

## 1. 🏗️ Project Overview


ArenaX is a competitive gaming tournament platform tailored for **amateur gamers**, enabling them to join tournaments, compete, report scores with proof, and receive instant payouts via local payment methods (Stripe, Opay, PalmPay, Bank transfers) and **Stellar blockchain-based payouts**. The platform leverages Stellar’s low-cost, fast, and transparent blockchain to manage tournament prize pools, payouts, and reputation systems, ensuring trust and fairness. Advanced features like real-time matchmaking, AI-driven anti-cheat, and community-driven tournaments enhance scalability and engagement.

**Core Goals**:
- Make **esports accessible** to everyday mobile and console gamers in Nigeria.
- Provide a **secure, fair environment** with advanced anti-cheat, score verification, and Stellar-based transparency.
- Enable **fast, transparent payouts** using local payment systems and Stellar blockchain for verifiable, low-cost transactions.
- Scale to support large-scale tournaments with real-time updates, distributed systems, and Stellar-backed prize pools.

**Stellar Blockchain Focus**:
- Use Stellar for transparent management of tournament prize pools and payouts.
- Issue custom assets on Stellar for in-platform rewards (e.g., ArenaX Tokens).
- Leverage Stellar’s decentralized exchange (SDEX) for converting rewards to local currency (NGN).
- Implement Stellar smart contracts (Soroban) for automated prize distribution and reputation tracking.

---

## 2. 📐 System Architecture

The architecture leverages Rust’s performance and safety, integrated with the **Stellar blockchain** for transparent and secure financial operations, alongside real-time interactions and AI analysis for fairness.

**Components**:
- **Frontend (Next.js PWA)**: Mobile-first progressive web app for seamless user interaction, including Stellar wallet integration for payouts.
- **Backend (Rust + Actix/Axum + Tokio)**: API handling authentication, tournaments, matches, wallets, and real-time updates, with Stellar SDK integration for blockchain operations.
- **PostgreSQL**: Persistent storage for users, tournaments, matches, wallets, and transaction logs.
- **Redis**: Caching, OTP storage, leaderboards, and Pub/Sub for real-time match and tournament updates.
- **S3/MinIO**: Storage for screenshots, game logs, and telemetry data for anti-cheat analysis.
- **Payment Gateways**: Paystack and Flutterwave for fiat deposits/withdrawals, integrated with Stellar for blockchain-based payouts.
- **AI Service**: Lightweight machine learning models for anti-cheat detection, analyzing screenshots and gameplay telemetry.
- **Stellar Blockchain**: Stellar network for managing tournament prize pools, payouts, and custom assets (e.g., ArenaX Tokens), with Soroban smart contracts for automation.
- **Event Streaming (Optional)**: Kafka or Redis Streams for event-driven match updates and leaderboard synchronization.

**Architecture Design**:
- **Microservices**: Backend split into modular services (auth, tournaments, matches, anti-cheat, Stellar integration) communicating via Redis Pub/Sub or gRPC for scalability.
- **Event-Driven**: Real-time updates for match scores, tournament states, and leaderboards using event streams, with Stellar transaction updates for payouts.
- **Distributed Systems**: Tournament state managed across multiple backend instances with Redis for coordination.
- **Stellar Integration**: Backend services interact with Stellar via the Rust Stellar SDK for account management, asset issuance, and Soroban smart contract execution.

**Stellar-Specific Implementation Needs**:
- Integrate **Stellar Rust SDK** for creating and managing Stellar accounts for users and tournaments.
- Deploy **Soroban smart contracts** for automated prize distribution and reputation point tracking.
- Set up **Stellar anchors** to bridge fiat (NGN) deposits/withdrawals with Stellar-based assets.
- Implement **Stellar SDEX integration** for converting ArenaX Tokens to XLM or NGN.
- Ensure **Stellar account security** with multi-signature accounts for tournament prize pools.

---

## 3. ⚙️ Tech Stack

- **Frontend**: Next.js (PWA), TailwindCSS, shadcn/ui
- **Backend**: Rust (Actix for actor-based concurrency, Axum for HTTP, Tokio for async tasks, SQLx for database interactions, Stellar Rust SDK for blockchain operations)
- **Database**: PostgreSQL (with sharding for scalability)
- **Cache & Messaging**: Redis (caching, Pub/Sub, leaderboards)
- **Storage**: S3/MinIO
- **Payments**: Paystack, Flutterwave (fiat), Stellar blockchain (crypto payouts)
- **AI**: Lightweight ML models (e.g., TensorFlow Lite via Rust’s `tract` crate) for anti-cheat
- **Blockchain**: Stellar network with Soroban smart contracts for prize pools, payouts, and reputation tracking
- **Monitoring**: Prometheus and Grafana for performance metrics
- **Rate Limiting**: Configurable API rate limiting for security

---

## 4. 🚀 Setup Guide

### Prerequisites
- Rust toolchain (`cargo`, `rustup`)
- Node.js (v18+)
- PostgreSQL (with sharding support)
- Redis (with Pub/Sub enabled)
- MinIO (or AWS S3)
- Docker (for local containers)
- **Stellar CLI and SDK**: For blockchain integration and testing on Stellar testnet/mainnet
- Optional: Kafka for event streaming

### Backend Setup
1. Clone the backend repository.
2. Install Rust dependencies, including Stellar Rust SDK.
3. Run database migrations for PostgreSQL.
4. Configure Redis, MinIO, Paystack/Flutterwave, and Stellar network credentials (testnet/mainnet).
5. Deploy Soroban smart contracts for prize distribution and reputation tracking.
6. Start the backend server with microservices for auth, tournaments, matches, anti-cheat, and Stellar integration.

### Backend Setup (Code)
```bash
# Clone repo
git clone https://github.com/arenax.git
cd backend

# Install dependencies
cargo build

# Run migrations
sqlx migrate run

# Start server
cargo run
```

### Frontend Setup
1. Clone the frontend repository.
2. Install Node.js dependencies.
3. Configure frontend to display Stellar wallet addresses and transaction statuses.
4. Start the development server for the Next.js PWA.

### Frontend Setup (Code)
```bash
# Clone repo
git clone https://github.com/arenax/arenax.git
cd frontend

# Install dependencies
npm install

# Run dev server
npm run dev
```

### Environment Variables
Create `.env` files with additional variables for Stellar integration:
- Database connection URL
- Redis connection URL
- S3/MinIO endpoint, access key, and secret key
- Paystack/Flutterwave API secrets
- JWT secret for authentication
- **Stellar network URL** (testnet/mainnet)
- **Stellar secret key** for admin account
- **Soroban contract IDs** for prize distribution and reputation
- AI model path for anti-cheat analysis

### Environment Variables (Code)
```env
DATABASE_URL=postgres://user:pass@localhost:5432/arenax
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minio
S3_SECRET_KEY=secret
PAYSTACK_SECRET=sk_test_xxx
JWT_SECRET=supersecretkey
STELLAR_NETWORK_URL=https://horizon-testnet.stellar.org
STELLAR_ADMIN_SECRET=SBXXX...
SOROBAN_CONTRACT_PRIZE=CAXXX...
SOROBAN_CONTRACT_REPUTATION=CBXXX...
```

---

## 5. 🎮 Feature Documentation

### Authentication
- Phone-based OTP login/signup with rate limiting.
- JWT-based sessions with device fingerprinting to prevent multi-account abuse.
- **Stellar Wallet Integration**: Each user account linked to a Stellar account for blockchain-based payouts and rewards.
- Optional WebAssembly (WASM) client-side verification for lightweight pre-authentication checks.

**Stellar Implementation Needs**:
- Create a Stellar account for each user upon signup, storing the public key in PostgreSQL.
- Securely manage user secret keys (encrypted in the backend).
- Implement multi-signature accounts for admin-managed tournament prize pools.

### Wallet & Payments
- Deposits and withdrawals via Paystack/Flutterwave for fiat (NGN).
- **Stellar-Based Payouts**: Payouts issued as XLM or custom ArenaX Tokens, with Soroban smart contracts automating distribution.
- Transaction history stored in PostgreSQL, with Stellar transaction IDs logged for transparency.
- One payout account per user to prevent fraud, linked to a Stellar wallet.

**Stellar Implementation Needs**:
- Issue a custom **ArenaX Token** on Stellar for in-platform rewards.
- Integrate with Stellar anchors to convert XLM/ArenaX Tokens to NGN for withdrawals.
- Use Stellar SDEX to enable token-to-XLM or token-to-NGN conversions.
- Implement Soroban smart contracts to escrow prize pools and automate payouts upon match completion.

### Tournaments
- Admin-created tournaments with entry fees paid in NGN or ArenaX Tokens.
- Auto status transitions (upcoming → ongoing → completed) managed by distributed backend instances.
- Scalable bracket generation for large tournaments.
- Real-time updates via Redis Pub/Sub, with Stellar transaction updates for prize pool contributions.

**Stellar Implementation Needs**:
- Create a Stellar multi-signature account per tournament to hold prize pools.
- Use Soroban smart contracts to lock entry fees and release prizes based on tournament outcomes.
- Record all prize pool transactions on Stellar for transparency.

### Matches
- Elo-based matchmaking to pair players of similar skill levels, with ratings stored in Redis.
- Score reporting with screenshot and telemetry upload to S3/MinIO.
- Dispute system for score mismatches, with admin review.
- AI-powered anti-cheat analysis of screenshots and telemetry to detect manipulation or abnormal gameplay patterns.

**Stellar Implementation Needs**:
- Log match outcomes on Stellar via Soroban smart contracts for immutable records.
- Automate prize distribution to winners’ Stellar accounts upon match verification.

### Leaderboard & Reputation
- Weekly/monthly leaderboards with real-time updates using Redis.
- **Reputation System on Stellar**: Reputation points issued as a Stellar custom asset, tracked via Soroban smart contracts.
- Penalties for disputes or confirmed cheating, reflected in reputation token balances.

**Stellar Implementation Needs**:
- Issue a **Reputation Token** on Stellar for tracking player fairness.
- Use Soroban smart contracts to increment/decrement reputation based on match outcomes and disputes.
- Display reputation balances in the frontend, linked to Stellar public keys.

### Anti-Cheat System
- AI-driven analysis of screenshots and game telemetry to detect cheating (e.g., manipulated images, abnormal scores).
- Lightweight ML models run on the server, with optional WASM-based pre-verification on the client.
- Automated flagging of suspicious activity with admin review.

**Stellar Implementation Needs**:
- Log anti-cheat analysis results on Stellar for transparency and auditability.
- Penalize confirmed cheaters by reducing Reputation Tokens via Soroban smart contracts.

### Matchmaking
- Real-time matchmaking based on Elo ratings for fair competition.
- Queue system with status updates via WebSocket or Redis Pub/Sub.

---

## 6. 📑 API Reference (Core Endpoints)

### Auth
- `POST /auth/signup`: Register with phone number and create Stellar account.
- `POST /auth/verify`: Verify OTP and finalize account creation.
- `GET /auth/me`: Retrieve user profile, including Stellar public key.

### Wallet
- `GET /wallet`: View fiat balance, ArenaX Token balance, and Stellar transaction history.
- `POST /wallet/deposit`: Deposit funds via Paystack/Flutterwave.
- `POST /wallet/withdraw`: Withdraw funds to Opay/Bank or Stellar wallet.
- `POST /wallet/payout/stellar`: Initiate Stellar-based payout (XLM or ArenaX Tokens).
- `GET /wallet/payout/status/:tx_id`: Check Stellar transaction status.

### Tournaments
- `GET /tournaments`: List available tournaments with Stellar prize pool details.
- `POST /tournaments/:id/join`: Join a tournament with fiat or ArenaX Token entry fee.
- `GET /tournaments/:id`: View tournament details, including Stellar prize pool balance.

### Matches
- `POST /matches/:id/report`: Submit score with screenshot/telemetry.
- `POST /matches/:id/dispute`: Dispute a match result.
- `GET /matches/:id`: View match details and Stellar transaction records.
- `POST /matches/:id/analyze`: Submit telemetry for anti-cheat analysis.
- `GET /matches/:id/analysis`: Retrieve anti-cheat analysis results.

### Matchmaking
- `POST /matchmaking/join`: Join a skill-based match queue.
- `GET /matchmaking/status`: Check matchmaking status.

### Leaderboard
- `GET /leaderboard?period=weekly`: View top players with Stellar Reputation Token balances.

---

## 7. 🛠️ Developer Guidelines

- **Coding Standards**:
  - Rust: Enforce `cargo fmt` and `clippy` for consistency and safety.
  - JavaScript/TypeScript: Use ESLint and Prettier for frontend code.
- **Git Workflow**: Feature branches merged into `dev`, then `main`.
- **Testing**:
  - Rust: Unit and integration tests for microservices, actor-based systems, and Stellar SDK interactions.
  - Next.js: Jest and React Testing Library for frontend components.
  - Stress testing with tools like `k6` for scalability, including Stellar transaction throughput.
- **Error Handling**: Standardized JSON error responses with error codes.
```json
{
  "error": "Invalid OTP",
  "code": 401
}
```
- **Performance**:
  - Database sharding by tournament ID for scalability.
  - Connection pooling for PostgreSQL and Redis.
  - Custom memory allocators (e.g., `mimalloc`) for optimized memory usage.
  - Optimize Stellar transaction batching for high-volume payouts.
- **Monitoring**: Prometheus and Grafana for performance metrics, including Stellar transaction latency.

**Stellar Implementation Needs**:
- Test Stellar integration on the Stellar testnet before mainnet deployment.
- Monitor Soroban smart contract performance and gas usage.
- Ensure Stellar account creation scales for large user bases.

---

## 8. 🔒 Security & Compliance

- **Rate Limiting**: Fine-grained API rate limiting to prevent abuse.
- **Data Encryption**: Encrypt sensitive data (e.g., phone numbers, Stellar secret keys) in PostgreSQL.
- **Anti-Fraud**: Device fingerprinting, one payout account per user, and AI-based anti-cheat analysis.
- **Stellar Security**: Use multi-signature accounts for tournament prize pools and admin-controlled operations.
- **Logging**: Audit logs for suspicious activity and Stellar transactions, stored securely.
- **Compliance**: Adhere to local data protection regulations for Nigerian users and Stellar’s compliance protocols for financial transactions.

**Stellar Implementation Needs**:
- Implement multi-signature Stellar accounts for secure prize pool management.
- Encrypt Stellar secret keys in the backend using secure key management practices.
- Comply with Stellar’s KYC/AML requirements for fiat-to-crypto conversions via anchors.

---

## 9. 📅 Roadmap

- **Phase 1**: Core features (Auth with Stellar account creation, Wallet with Stellar integration, Tournaments, Matches, Elo Matchmaking).
- **Phase 2**: Leaderboards, Stellar-based Reputation System, AI Anti-Cheat, Admin Panel with Stellar transaction monitoring.
- **Phase 3**: Soroban smart contracts for automated payouts, distributed tournament systems, community-driven tournaments, and sponsorship integrations.
- **Phase 4**: Advanced AI for real-time gameplay analysis, global expansion beyond Nigeria, and integration with additional gaming platforms and Stellar anchors.

**Stellar Implementation Needs**:
- Phase 1: Deploy Stellar testnet integration for user accounts and ArenaX Token issuance.
- Phase 2: Launch Reputation Token and Soroban contracts for reputation tracking.
- Phase 3: Deploy Soroban contracts for prize pool automation and integrate Stellar SDEX for token conversions.
- Phase 4: Expand Stellar anchor integrations for seamless NGN-to-XLM conversions.

---

## 10. 📈 Scalability & Performance

- **Sharding**: PostgreSQL sharded by tournament ID to handle large-scale tournaments.
- **Distributed Systems**: Backend microservices coordinated via Redis Pub/Sub or gRPC.
- **Event Streaming**: Kafka or Redis Streams for event-driven updates, including Stellar transaction notifications.
- **Caching**: Redis for caching tournament details, leaderboards, matchmaking data, and Stellar account balances with TTL.
- **Load Balancing**: Use a load balancer to distribute traffic across backend instances.
- **Stellar Scalability**: Batch Stellar transactions for payouts to reduce network fees and improve throughput.
- **Monitoring**: Prometheus for metrics collection (including Stellar transaction latency) and Grafana for visualization.

**Stellar Implementation Needs**:
- Optimize Stellar transaction batching for large tournaments.
- Monitor Stellar network performance to ensure low-latency payouts.
- Scale Stellar account creation and management for thousands of users.

---

## 11. 🌐 Community & Sponsorships

- **Community Tournaments**: Allow users to create tournaments with Stellar-based prize pools, approved by admins.
- **Sponsorships**: Integrate sponsored tournaments with ArenaX Token rewards, managed via Stellar smart contracts.
- **Social Features**: Add in-app chat and community leaderboards displaying Stellar Reputation Token balances.

**Stellar Implementation Needs**:
- Use Soroban smart contracts to manage community tournament prize pools.
- Issue sponsored ArenaX Tokens on Stellar for branded rewards.
- Display Stellar-based reputation and reward balances in community leaderboards.

---
