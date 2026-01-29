# 🛠️ ArenaX Development Guide

## Quick Start

### Prerequisites
- Node.js 18+ and Yarn
- Rust toolchain
- Docker and Docker Compose
- PostgreSQL 13+
- Redis 6+

### Initial Setup
```bash
# Clone the repository
git clone https://github.com/arenax/arenax.git
cd arenax

# Run initial setup
make setup

# Start all services with Docker Compose
docker-compose up -d

# Or start individual services
make dev-frontend  # Terminal 1
make dev-backend   # Terminal 2
```

## Development Commands

### Using Makefile
```bash
make help           # Show all available commands
make install        # Install all dependencies
make dev            # Start development servers
make test           # Run all tests
make lint           # Lint all code
make format         # Format all code
make check-all      # Run all checks
make clean          # Clean build artifacts
```

### Individual Services

#### Frontend
```bash
cd frontend
yarn install        # Install dependencies
yarn dev           # Start development server
yarn build         # Build for production
yarn test          # Run tests
yarn lint          # Lint code
```

#### Backend
```bash
cd backend
cargo build        # Build project
cargo run          # Start development server
cargo test         # Run tests
cargo clippy       # Lint code
cargo fmt          # Format code
```

#### Contracts
```bash
cd contracts
cargo build        # Build contracts
cargo test         # Run tests
cargo clippy       # Lint code
cargo fmt          # Format code
```

## Environment Setup

### Frontend (.env.local)
Copy `frontend/env.example` to `frontend/.env.local` and configure:
- API endpoints
- Stellar network settings
- Payment gateway keys

### Backend (.env)
Copy `backend/env.example` to `backend/.env` and configure:
- Database connection
- Redis connection
- Stellar configuration
- JWT secrets

### Contracts (.env)
Copy `contracts/env.example` to `contracts/.env` and configure:
- Stellar network settings
- Contract admin keys
- Deployment configuration

## CI/CD

### GitHub Actions
The project uses GitHub Actions for CI/CD with the following workflows:

- **CI Pipeline** (`.github/workflows/ci.yml`):
  - Frontend: Lint, type-check, test, build
  - Backend: Format check, clippy, test with PostgreSQL/Redis
  - Contracts: Format check, clippy, build, test
  - Security: Trivy vulnerability scanning

### Local CI Testing
```bash
# Run all checks locally
make check-all

# Run specific checks
make lint
make format
make test
```

## Docker Development

### Full Stack
```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Individual Services
```bash
# Start only database services
docker-compose up postgres redis minio -d

# Start backend with external services
make dev-backend
```

## Project Structure

```
arenax/
├── .github/workflows/    # CI/CD workflows
├── frontend/             # Next.js PWA frontend
├── backend/              # Rust backend API
├── contracts/            # Stellar smart contracts
├── docker-compose.yml    # Local development stack
├── Makefile             # Development commands
├── .gitignore           # Git ignore rules
└── DEVELOPMENT.md       # This file
```

## Troubleshooting

### Common Issues

1. **Port conflicts**: Check if ports 3000, 8080, 5432, 6379, 9000 are available
2. **Database connection**: Ensure PostgreSQL is running and accessible
3. **Redis connection**: Ensure Redis is running and accessible
4. **Stellar network**: Check network connectivity to Stellar testnet

### Logs
```bash
# Backend logs
docker-compose logs backend

# Frontend logs
docker-compose logs frontend

# Database logs
docker-compose logs postgres
```

### Clean Reset
```bash
# Clean everything and start fresh
make clean
docker-compose down -v
docker-compose up -d
make setup
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `make check-all` to ensure quality
5. Submit a pull request

## Support

For development questions:
- Check the individual README files in each directory
- Review the CI logs for build issues
- Contact the development team
