# 🎮 ArenaX Backend

## Overview

The ArenaX backend is a high-performance **Rust-based microservices architecture** that powers the competitive gaming tournament platform. It integrates with the **Stellar blockchain** for transparent prize pool management, payouts, and reputation tracking, while providing real-time matchmaking and AI-driven anti-cheat capabilities.

## Tech Stack

- **Language**: Rust
- **Web Framework**: Actix-web + Axum
- **Async Runtime**: Tokio
- **Database**: PostgreSQL (with sharding)
- **Cache & Messaging**: Redis (Pub/Sub, leaderboards)
- **Storage**: S3/MinIO
- **Blockchain**: Stellar Rust SDK + Soroban smart contracts
- **Payments**: Paystack, Flutterwave
- **AI**: TensorFlow Lite (via `tract` crate)

## Architecture

### Microservices Design
- **Auth Service**: User authentication and Stellar account management
- **Tournament Service**: Tournament lifecycle and prize pool management
- **Match Service**: Matchmaking, scoring, and dispute handling
- **Wallet Service**: Payment processing and Stellar integration
- **Anti-Cheat Service**: AI-powered cheating detection
- **Leaderboard Service**: Real-time rankings and reputation tracking

### Stellar Integration
- **Account Management**: Create and manage user Stellar accounts
- **Asset Issuance**: ArenaX Tokens and Reputation Tokens
- **Smart Contracts**: Soroban contracts for automated operations
- **Transaction Processing**: Prize pool management and payouts

## Project Structure

```
backend/
├── src/
│   ├── api_error.rs       # Centralized error handling and API error types
│   ├── config.rs          # Configuration management and environment variables
│   ├── db.rs              # Database connection and connection pooling
│   ├── lib.rs             # Library root and public API exports
│   ├── main.rs            # Application entry point and server startup
│   ├── middleware.rs      # Custom middleware implementations
│   ├── telemetry.rs       # Logging, tracing, and observability setup
│   ├── auth/              # Authentication and authorization modules
│   │   ├── mod.rs         # Auth module exports
│   │   ├── jwt.rs         # JWT token handling
│   │   ├── stellar.rs     # Stellar account management
│   │   └── otp.rs         # OTP verification system
│   ├── http/              # HTTP handlers and route definitions
│   │   ├── mod.rs         # HTTP module exports
│   │   ├── auth.rs        # Authentication endpoints
│   │   ├── tournaments.rs # Tournament management endpoints
│   │   ├── matches.rs     # Match and matchmaking endpoints
│   │   ├── wallet.rs      # Payment and Stellar integration endpoints
│   │   ├── leaderboard.rs # Rankings and reputation endpoints
│   │   └── health.rs      # Health check and monitoring endpoints
│   ├── service/           # Business logic and service layer
│   │   ├── mod.rs         # Service module exports
│   │   ├── auth_service.rs    # Authentication business logic
│   │   ├── tournament_service.rs # Tournament management logic
│   │   ├── match_service.rs     # Match and matchmaking logic
│   │   ├── wallet_service.rs    # Payment processing logic
│   │   ├── anti_cheat_service.rs # AI-powered cheating detection
│   │   ├── leaderboard_service.rs # Rankings and reputation logic
│   │   └── stellar_service.rs   # Stellar blockchain integration
│   └── utils/             # Shared utilities and helper functions
│       ├── mod.rs         # Utils module exports
│       ├── crypto.rs      # Cryptographic utilities
│       ├── validation.rs  # Input validation helpers
│       ├── stellar_utils.rs # Stellar-specific utilities
│       └── constants.rs   # Application constants
├── migrations/            # Database migrations (SQLx)
├── scripts/              # Deployment and utility scripts
│   ├── deploy.sh         # Production deployment script
│   ├── migrate.sh        # Database migration script
│   └── test_stellar.sh   # Stellar integration testing
├── tests/                # Integration and unit tests
│   ├── common/           # Shared test utilities
│   ├── integration/      # End-to-end integration tests
│   └── unit/             # Unit tests for individual modules
├── target/               # Rust build artifacts
├── Cargo.toml           # Rust dependencies and workspace configuration
├── Cargo.lock           # Locked dependency versions
├── Dockerfile           # Container configuration
├── test_ci_locally.sh   # Local CI testing script
└── README.md            # This documentation
```

## Setup & Development

### Prerequisites
- Rust toolchain (`cargo`, `rustup`) - latest stable version
- PostgreSQL (v13+) with sharding support
- Redis (v6+) with Pub/Sub enabled
- MinIO (or AWS S3) for file storage
- Docker and Docker Compose for local development
- Stellar CLI and SDK for blockchain integration
- Node.js (v18+) for testing scripts

### Installation

```bash
# Clone the repository
git clone https://github.com/arenax/arenax.git
cd backend

# Install Rust dependencies
cargo build

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
./scripts/migrate.sh

# Start the backend server
cargo run

# Or run with Docker Compose
docker-compose up -d
```

### Development Commands

```bash
# Run tests
cargo test

# Run tests with coverage
cargo test --coverage

# Run integration tests
cargo test --test integration

# Run specific test module
cargo test auth::tests

# Check code formatting
cargo fmt

# Run linter
cargo clippy

# Run local CI tests
./test_ci_locally.sh

# Database operations
sqlx migrate add -r <migration_name>
./scripts/verify-migrations.sh
./scripts/migrate.sh
./scripts/migration-status.sh
./scripts/backup-database.sh
./scripts/rollback-last-migration.sh

# Stellar integration testing
./scripts/test_stellar.sh
```

### Environment Variables

```env
# Database
DATABASE_URL=postgres://user:pass@localhost:5432/arenax
BACKEND_MIGRATION_MODE=run
REDIS_URL=redis://localhost:6379

# Storage
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minio
S3_SECRET_KEY=secret

# Payments
PAYSTACK_SECRET=sk_test_xxx
FLUTTERWAVE_SECRET=FLWSECK_TEST-xxx

# Authentication
JWT_SECRET=supersecretkey

# Stellar Configuration
STELLAR_NETWORK_URL=https://horizon-testnet.stellar.org
STELLAR_ADMIN_SECRET=SBXXX...
SOROBAN_CONTRACT_PRIZE=CAXXX...
SOROBAN_CONTRACT_REPUTATION=CBXXX...

# AI
AI_MODEL_PATH=./models/anti_cheat.tflite
```

`BACKEND_MIGRATION_MODE` defaults to `run`, which applies and validates SQLx migrations during backend startup. Use `disabled` only when migrations are applied by a separate deployment step. See [MIGRATIONS.md](MIGRATIONS.md) for the full migration workflow, rollback process, and CI expectations.

## Code Organization & Architecture

### Module Structure
The backend follows a clean architecture pattern with clear separation of concerns:

- **`api_error.rs`**: Centralized error handling with custom error types and HTTP status mapping
- **`config.rs`**: Environment configuration management with validation and defaults
- **`db.rs`**: Database connection pooling, transaction management, and connection health checks
- **`lib.rs`**: Public API exports and library initialization
- **`main.rs`**: Application entry point, server startup, and graceful shutdown
- **`middleware.rs`**: Custom middleware for authentication, logging, CORS, and rate limiting
- **`telemetry.rs`**: Structured logging, tracing, metrics collection, and observability setup

### Service Layer Pattern
Each service follows a consistent pattern:
- **HTTP Handlers** (`http/`): Request/response handling, input validation, and error mapping
- **Service Layer** (`service/`): Business logic, data transformation, and external service integration
- **Database Models**: Data access layer with SQLx for type-safe database operations

### Error Handling Strategy
- **Custom Error Types**: Domain-specific error types with proper HTTP status codes
- **Error Propagation**: Proper error chaining and context preservation
- **Logging Integration**: Structured error logging with correlation IDs
- **Client Responses**: Consistent JSON error responses with appropriate status codes

### Configuration Management
- **Environment-based**: Different configurations for development, staging, and production
- **Validation**: Runtime validation of required configuration values
- **Secrets Management**: Secure handling of sensitive configuration data
- **Hot Reloading**: Configuration updates without service restart (where applicable)

## Core Services

### 🔐 Auth Service
- **Phone-based OTP**: Secure user registration and login
- **JWT Sessions**: Token-based authentication
- **Stellar Account Creation**: Automatic wallet setup for new users
- **Device Fingerprinting**: Prevent multi-account abuse

**Key Endpoints**:
- `POST /auth/signup` - Register with phone number
- `POST /auth/verify` - Verify OTP and create Stellar account
- `GET /auth/me` - Get user profile and Stellar public key

### 🏆 Tournament Service
- **Tournament Management**: Create, update, and manage tournaments
- **Prize Pool Management**: Stellar-based prize pool handling
- **Entry Fee Processing**: Accept fiat and ArenaX Token payments
- **Real-time Updates**: Live tournament status updates

**Key Endpoints**:
- `GET /tournaments` - List tournaments with Stellar prize pools
- `POST /tournaments/:id/join` - Join tournament with payment
- `GET /tournaments/:id` - Get tournament details

### 🎮 Match Service
- **Elo Matchmaking**: Skill-based player pairing
- **Score Reporting**: Handle score submissions with proof
- **Dispute System**: Manage match disputes and admin review
- **Real-time Updates**: Live match status and results

**Key Endpoints**:
- `POST /matches/:id/report` - Submit match score
- `POST /matches/:id/dispute` - Dispute match result
- `GET /matches/:id` - Get match details and Stellar records

### 💰 Wallet Service
- **Payment Processing**: Handle Paystack/Flutterwave payments
- **Stellar Integration**: Manage XLM and custom asset balances
- **Payout Processing**: Automated prize distribution
- **Transaction History**: Complete payment and Stellar transaction logs

**Key Endpoints**:
- `GET /wallet` - View balances and transaction history
- `POST /wallet/deposit` - Process fiat deposits
- `POST /wallet/payout/stellar` - Initiate Stellar payouts
- `GET /wallet/payout/status/:tx_id` - Check payout status

### 🤖 Anti-Cheat Service
- **AI Analysis**: ML-powered cheating detection
- **Screenshot Analysis**: Detect manipulated images
- **Telemetry Analysis**: Identify abnormal gameplay patterns
- **Automated Flagging**: Flag suspicious activity for review

**Key Endpoints**:
- `POST /matches/:id/analyze` - Submit telemetry for analysis
- `GET /matches/:id/analysis` - Get anti-cheat results

### 🏅 Leaderboard Service
- **Real-time Rankings**: Live player leaderboards
- **Reputation Tracking**: Stellar-based reputation system
- **Periodic Updates**: Weekly/monthly leaderboard calculations
- **Redis Caching**: High-performance leaderboard queries

**Key Endpoints**:
- `GET /leaderboard?period=weekly` - Get leaderboard with reputation

## Stellar Blockchain Integration

### Account Management
- **User Accounts**: Automatic Stellar account creation
- **Multi-signature**: Secure tournament prize pool accounts
- **Key Management**: Encrypted secret key storage

### Custom Assets
- **ArenaX Tokens**: In-platform rewards and tournament fees
- **Reputation Tokens**: Player fairness and skill tracking
- **Asset Issuance**: Automated token creation and distribution

### Smart Contracts (Soroban)
- **Prize Distribution**: Automated tournament payouts
- **Reputation Management**: Track and update player reputation
- **Escrow Management**: Secure prize pool handling

### Transaction Processing
- **Batch Operations**: Efficient bulk transaction processing
- **Fee Optimization**: Minimize Stellar network fees
- **Status Tracking**: Real-time transaction monitoring

## Database Schema

### Core Tables
- `users` - User profiles and Stellar account info
- `tournaments` - Tournament data and prize pools
- `matches` - Match records and results
- `wallets` - Payment and Stellar balance info
- `transactions` - Payment and Stellar transaction logs
- `leaderboards` - Player rankings and reputation

### Stellar Integration Tables
- `stellar_accounts` - User Stellar account details
- `stellar_transactions` - Stellar transaction records
- `custom_assets` - ArenaX and Reputation token info
- `prize_pools` - Tournament prize pool management

## API Documentation

### Authentication
All endpoints require proper authentication unless specified otherwise.

### Error Handling
Standardized JSON error responses:
```json
{
  "error": "Error message",
  "code": 400,
  "details": "Additional error details"
}
```

### Rate Limiting
- API endpoints have configurable rate limits
- Stellar operations have separate rate limiting
- Anti-cheat analysis has usage limits

## Testing

### Unit Tests
```bash
cargo test
```

### Integration Tests
```bash
cargo test --test integration
```

### Stellar Testnet Testing
```bash
# Test Stellar integration on testnet
STELLAR_NETWORK_URL=https://horizon-testnet.stellar.org cargo test
```

## Performance & Scalability

### Database Optimization
- **Sharding**: PostgreSQL sharded by tournament ID
- **Connection Pooling**: Optimized database connections
- **Indexing**: Strategic database indexes for performance

### Caching Strategy
- **Redis Caching**: Tournament data, leaderboards, user sessions
- **TTL Management**: Appropriate cache expiration times
- **Cache Invalidation**: Smart cache updates on data changes

### Stellar Optimization
- **Transaction Batching**: Group multiple operations
- **Fee Management**: Optimize Stellar network fees
- **Account Pooling**: Reuse Stellar accounts where possible

## Monitoring & Observability

### Metrics
- **Prometheus**: Performance and business metrics
- **Grafana**: Visualization and alerting
- **Stellar Metrics**: Blockchain operation monitoring

### Logging
- **Structured Logging**: JSON-formatted logs
- **Stellar Transactions**: Complete audit trail
- **Error Tracking**: Comprehensive error monitoring

## Security

### Data Protection
- **Encryption**: Sensitive data encryption at rest
- **Stellar Keys**: Secure key management and storage
- **API Security**: Rate limiting and input validation

### Compliance
- **Data Privacy**: Nigerian data protection compliance
- **Stellar Compliance**: KYC/AML requirements
- **Audit Logging**: Complete transaction audit trail

## Deployment

### Docker Deployment
```bash
# Build and run with Docker Compose
docker-compose up -d
```

### Production Considerations
- **Load Balancing**: Multiple backend instances
- **Database Scaling**: Read replicas and sharding
- **Stellar Network**: Mainnet vs testnet configuration
- **Monitoring**: Production monitoring setup

## Contributing

1. Follow Rust coding standards (`cargo fmt`, `clippy`)
2. Write comprehensive tests
3. Update documentation
4. Test Stellar integration thoroughly
5. Ensure security best practices

## Support

For backend development questions:
- Check the main ArenaX documentation
- Review Stellar Rust SDK documentation
- Contact the development team

---

**Note**: This backend is designed to work with the ArenaX frontend and Stellar smart contracts. Ensure all components are properly configured for full functionality.
