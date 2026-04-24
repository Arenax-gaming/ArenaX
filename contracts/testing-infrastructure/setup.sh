#!/bin/bash

# Setup script for ArenaX testing infrastructure

set -e

echo "🚀 Setting up ArenaX Testing Infrastructure..."
echo ""

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "${YELLOW}Rust is not installed. Please install Rust first:${NC}"
    echo "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

echo "${BLUE}✓ Rust is installed${NC}"
echo ""

# Install required Rust components
echo "${YELLOW}Installing Rust components...${NC}"
rustup component add rustfmt clippy
rustup target add wasm32-unknown-unknown
echo "${GREEN}✓ Rust components installed${NC}"
echo ""

# Install testing tools
echo "${YELLOW}Installing testing tools...${NC}"

echo "  Installing cargo-tarpaulin (coverage)..."
cargo install cargo-tarpaulin --locked || echo "  (already installed)"

echo "  Installing cargo-audit (security)..."
cargo install cargo-audit --locked || echo "  (already installed)"

echo "  Installing cargo-geiger (unsafe code detection)..."
cargo install cargo-geiger --locked || echo "  (already installed)"

echo "  Installing cargo-watch (development)..."
cargo install cargo-watch --locked || echo "  (already installed)"

echo "${GREEN}✓ Testing tools installed${NC}"
echo ""

# Create necessary directories
echo "${YELLOW}Creating directory structure...${NC}"
mkdir -p coverage/reports
mkdir -p security/reports
mkdir -p formal-verification/results
mkdir -p reports
echo "${GREEN}✓ Directories created${NC}"
echo ""

# Make scripts executable
echo "${YELLOW}Making scripts executable...${NC}"
chmod +x security/scan.sh
chmod +x scripts/run_verification.sh
chmod +x scripts/generate_audit_report.sh
echo "${GREEN}✓ Scripts are executable${NC}"
echo ""

# Run initial build
echo "${YELLOW}Running initial build...${NC}"
cd ../..
cargo build --workspace
echo "${GREEN}✓ Build successful${NC}"
echo ""

# Run quick test
echo "${YELLOW}Running quick test...${NC}"
cargo test --workspace --lib -- --test-threads=1 || echo "${YELLOW}Some tests may need contract implementations${NC}"
echo ""

# Generate initial reports
echo "${YELLOW}Generating initial reports...${NC}"
cd testing-infrastructure

# Try to generate coverage (may fail if no tests yet)
echo "  Generating coverage report..."
cargo tarpaulin --workspace --out Html --output-dir coverage/reports 2>/dev/null || echo "  (will be available after implementing tests)"

echo "${GREEN}✓ Initial reports generated${NC}"
echo ""

# Print summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ${GREEN}Setup Complete!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📚 Next Steps:"
echo ""
echo "1. Run all tests:"
echo "   ${BLUE}make test-all${NC}"
echo ""
echo "2. Generate coverage report:"
echo "   ${BLUE}make coverage${NC}"
echo ""
echo "3. Run security scan:"
echo "   ${BLUE}make security-scan${NC}"
echo ""
echo "4. Run benchmarks:"
echo "   ${BLUE}make benchmark${NC}"
echo ""
echo "5. Run full audit:"
echo "   ${BLUE}make audit${NC}"
echo ""
echo "📖 Documentation:"
echo "   - README.md - Overview and quick start"
echo "   - TESTING_SUMMARY.md - Complete implementation details"
echo "   - docs/ - Detailed testing guides"
echo ""
echo "🔧 Development:"
echo "   - Use 'make watch' for continuous testing during development"
echo "   - Use 'make quick' for fast feedback"
echo ""
echo "✨ Happy Testing!"
echo ""
