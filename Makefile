# ArenaX Development Makefile

<<<<<<< HEAD
.PHONY: help install build test clean lint format check-all

# Default target
help:
	@echo "ArenaX Development Commands:"
	@echo ""
	@echo "Installation:"
	@echo "  install          Install all dependencies"
	@echo "  install-frontend Install frontend dependencies"
	@echo "  install-backend  Install backend dependencies"
	@echo "  install-contracts Install contracts dependencies"
	@echo ""
	@echo "Development:"
	@echo "  dev              Start all services in development mode"
	@echo "  dev-frontend     Start frontend development server"
	@echo "  dev-backend      Start backend development server"
	@echo ""
	@echo "Building:"
	@echo "  build            Build all projects"
	@echo "  build-frontend   Build frontend for production"
	@echo "  build-backend    Build backend"
	@echo "  build-contracts  Build contracts for deployment"
	@echo ""
	@echo "Testing:"
	@echo "  test             Run all tests"
	@echo "  test-frontend    Run frontend tests"
	@echo "  test-backend     Run backend tests"
	@echo "  test-contracts   Run contracts tests"
	@echo ""
	@echo "Code Quality:"
	@echo "  lint             Lint all code"
	@echo "  format           Format all code"
	@echo "  check-all        Run all checks (lint, format, test)"
	@echo ""
	@echo "Utilities:"
	@echo "  clean            Clean all build artifacts"
	@echo "  setup            Initial project setup"

# Installation
install: install-frontend install-backend install-contracts

install-frontend:
	@echo "Installing frontend dependencies..."
	@if command -v yarn >/dev/null 2>&1; then cd frontend && yarn install; else echo "Yarn not found, skipping frontend installation"; fi

install-backend:
	@echo "Installing backend dependencies..."
	@if [ -f "backend/Cargo.toml" ]; then cd backend && cargo build; else echo "Backend Cargo.toml not found, skipping backend installation"; fi

install-contracts:
	@echo "Installing contracts dependencies..."
	cd contracts && cargo build

# Development
dev:
	@echo "Starting all services..."
	@echo "Run 'make dev-frontend' and 'make dev-backend' in separate terminals"

dev-frontend:
	@echo "Starting frontend development server..."
	@if command -v yarn >/dev/null 2>&1; then cd frontend && yarn dev; else echo "Yarn not found, cannot start frontend"; fi

dev-backend:
	@echo "Starting backend development server..."
	cd backend && cargo run

# Building
build: build-frontend build-backend build-contracts

build-frontend:
	@echo "Building frontend..."
	cd frontend && yarn build

build-backend:
	@echo "Building backend..."
	cd backend && cargo build --release

build-contracts:
	@echo "Installing WASM target..."
	rustup target add wasm32-unknown-unknown
	@echo "Building contracts..."
	cd contracts && cargo build --target wasm32-unknown-unknown --release

# Testing
test: test-frontend test-backend test-contracts

test-frontend:
	@echo "Running frontend tests..."
	cd frontend && yarn test

test-backend:
	@echo "Running backend tests..."
	cd backend && cargo test

test-contracts:
	@echo "Running contracts tests..."
	cd contracts && cargo test

# Code Quality
lint:
	@echo "Linting frontend..."
	cd frontend && yarn lint
	@echo "Linting backend..."
	cd backend && cargo clippy
	@echo "Linting contracts..."
	cd contracts && cargo clippy

format:
	@echo "Formatting frontend..."
	cd frontend && yarn format
	@echo "Formatting backend..."
	cd backend && cargo fmt
	@echo "Formatting contracts..."
	cd contracts && cargo fmt

check-all: lint format test
	@echo "All checks completed!"

# Utilities
clean:
	@echo "Cleaning build artifacts..."
	@if [ -d "frontend" ]; then cd frontend && rm -rf .next node_modules; fi
	@if [ -f "backend/Cargo.toml" ]; then cd backend && cargo clean; fi
	@if [ -f "contracts/Cargo.toml" ]; then cd contracts && cargo clean; fi
	@rm -rf target

setup: install
	@echo "Setting up environment files..."
	@if [ -f "frontend/env.example" ] && [ ! -f "frontend/.env.local" ]; then cp frontend/env.example frontend/.env.local; fi
	@if [ -f "backend/env.example" ] && [ ! -f "backend/.env" ]; then cp backend/env.example backend/.env; fi
	@if [ -f "contracts/env.example" ] && [ ! -f "contracts/.env" ]; then cp contracts/env.example contracts/.env; fi
	@echo "Setup complete! Edit the .env files with your configuration."
=======
.PHONY: help setup dev build test clean docker-build docker-up docker-down

# Default target
help:
	@echo "Available commands:"
	@echo "  setup       - Initial project setup"
	@echo "  dev         - Start development environment"
	@echo "  build       - Build all services"
	@echo "  test        - Run all tests"
	@echo "  clean       - Clean build artifacts"
	@echo "  docker-build - Build Docker images"
	@echo "  docker-up    - Start services with Docker Compose"
	@echo "  docker-down  - Stop Docker services"

setup:
	@echo "Setting up development environment..."
	# Backend setup
	@cd backend && cargo check
	# Frontend setup
	@cd frontend && npm install
	# Contracts setup
	@cd contracts && cargo check

dev:
	@echo "Starting development environment..."
	# Start services in development mode

build:
	@echo "Building all services..."
	# Backend build
	@cd backend && cargo build --release
	# Frontend build
	@cd frontend && npm run build
	# Contracts build
	@cd contracts && cargo build --release

test:
	@echo "Running tests..."
	# Backend tests
	@cd backend && cargo test
	# Frontend tests
	@cd frontend && npm test
	# Contract tests
	@cd contracts && cargo test

clean:
	@echo "Cleaning build artifacts..."
	@cd backend && cargo clean
	@cd contracts && cargo clean
	@cd frontend && rm -rf .next

docker-build:
	@echo "Building Docker images..."
	@docker-compose build

docker-up:
	@echo "Starting services with Docker Compose..."
	@docker-compose up -d

docker-down:
	@echo "Stopping Docker services..."
	@docker-compose down
>>>>>>> upstream/main
