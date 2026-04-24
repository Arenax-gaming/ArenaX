.PHONY: all test-all test-unit test-integration test-fuzz coverage security-scan benchmark audit clean

# Colors for output
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m # No Color

all: test-all

# Run all tests
test-all: test-unit test-integration
	@echo "$(GREEN)✓ All tests passed$(NC)"

# Run unit tests with coverage
test-unit:
	@echo "$(YELLOW)Running unit tests...$(NC)"
	cd .. && cargo test --workspace --lib
	@echo "$(GREEN)✓ Unit tests passed$(NC)"

# Run integration tests
test-integration:
	@echo "$(YELLOW)Running integration tests...$(NC)"
	cargo test --test integration_tests
	@echo "$(GREEN)✓ Integration tests passed$(NC)"

# Run property-based fuzzing tests
test-fuzz:
	@echo "$(YELLOW)Running fuzz tests...$(NC)"
	cargo test --test fuzz_tests
	@echo "$(GREEN)✓ Fuzz tests passed$(NC)"

# Generate coverage report
coverage:
	@echo "$(YELLOW)Generating coverage report...$(NC)"
	cargo install cargo-tarpaulin || true
	cd .. && cargo tarpaulin --workspace --out Html --output-dir testing-infrastructure/coverage/reports
	@echo "$(GREEN)✓ Coverage report generated at coverage/reports/index.html$(NC)"

# Run security scans
security-scan:
	@echo "$(YELLOW)Running security scans...$(NC)"
	cargo install cargo-audit || true
	cargo audit
	cargo install cargo-geiger || true
	cargo geiger
	@echo "$(GREEN)✓ Security scans completed$(NC)"

# Run benchmarks
benchmark:
	@echo "$(YELLOW)Running benchmarks...$(NC)"
	cargo bench
	@echo "$(GREEN)✓ Benchmarks completed$(NC)"

# Run formal verification
verify:
	@echo "$(YELLOW)Running formal verification...$(NC)"
	./scripts/run_verification.sh
	@echo "$(GREEN)✓ Formal verification completed$(NC)"

# Run economic simulations
simulate:
	@echo "$(YELLOW)Running economic simulations...$(NC)"
	cargo test --test economic_simulation
	@echo "$(GREEN)✓ Economic simulations completed$(NC)"

# Full audit pipeline
audit: test-all security-scan coverage benchmark verify simulate
	@echo "$(GREEN)✓ Full audit completed$(NC)"
	@./scripts/generate_audit_report.sh

# Clean build artifacts
clean:
	cargo clean
	rm -rf coverage/reports/*
	rm -rf target/

# Install dependencies
setup:
	@echo "$(YELLOW)Installing testing dependencies...$(NC)"
	cargo install cargo-tarpaulin
	cargo install cargo-audit
	cargo install cargo-geiger
	cargo install cargo-fuzz
	@echo "$(GREEN)✓ Dependencies installed$(NC)"

# Quick test (fast feedback)
quick:
	cd .. && cargo test --workspace --lib -- --test-threads=1

# Watch mode for development
watch:
	cargo install cargo-watch || true
	cargo watch -x test
