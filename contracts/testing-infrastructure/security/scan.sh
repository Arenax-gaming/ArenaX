#!/bin/bash

# Security scanning script for ArenaX smart contracts

set -e

echo "🔒 Starting security scans for ArenaX contracts..."
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print section headers
print_section() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  $1"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

# 1. Cargo Audit - Check for known vulnerabilities
print_section "1. Running Cargo Audit"
if ! command -v cargo-audit &> /dev/null; then
    echo "${YELLOW}Installing cargo-audit...${NC}"
    cargo install cargo-audit
fi

cd ../..
cargo audit --json > testing-infrastructure/security/reports/audit.json
cargo audit

if [ $? -eq 0 ]; then
    echo "${GREEN}✓ No known vulnerabilities found${NC}"
else
    echo "${RED}✗ Vulnerabilities detected! Check audit.json for details${NC}"
fi

# 2. Cargo Geiger - Detect unsafe code
print_section "2. Running Cargo Geiger (Unsafe Code Detection)"
if ! command -v cargo-geiger &> /dev/null; then
    echo "${YELLOW}Installing cargo-geiger...${NC}"
    cargo install cargo-geiger
fi

cargo geiger --output-format json > testing-infrastructure/security/reports/geiger.json
cargo geiger

# 3. Clippy - Linting and common mistakes
print_section "3. Running Clippy (Linting)"
cargo clippy --all-targets --all-features -- -D warnings

if [ $? -eq 0 ]; then
    echo "${GREEN}✓ No clippy warnings${NC}"
else
    echo "${RED}✗ Clippy warnings found${NC}"
fi

# 4. Custom security checks
print_section "4. Running Custom Security Checks"

echo "Checking for common vulnerabilities..."

# Check for panic! usage
echo "  - Checking for panic! usage..."
PANIC_COUNT=$(grep -r "panic!" --include="*.rs" . | wc -l)
if [ $PANIC_COUNT -gt 0 ]; then
    echo "${YELLOW}    Warning: Found $PANIC_COUNT panic! statements${NC}"
    grep -r "panic!" --include="*.rs" . | head -5
else
    echo "${GREEN}    ✓ No panic! statements found${NC}"
fi

# Check for unwrap() usage
echo "  - Checking for unwrap() usage..."
UNWRAP_COUNT=$(grep -r "\.unwrap()" --include="*.rs" . | wc -l)
if [ $UNWRAP_COUNT -gt 0 ]; then
    echo "${YELLOW}    Warning: Found $UNWRAP_COUNT unwrap() calls${NC}"
    grep -r "\.unwrap()" --include="*.rs" . | head -5
else
    echo "${GREEN}    ✓ No unwrap() calls found${NC}"
fi

# Check for expect() usage
echo "  - Checking for expect() usage..."
EXPECT_COUNT=$(grep -r "\.expect(" --include="*.rs" . | wc -l)
if [ $EXPECT_COUNT -gt 0 ]; then
    echo "${YELLOW}    Warning: Found $EXPECT_COUNT expect() calls${NC}"
else
    echo "${GREEN}    ✓ No expect() calls found${NC}"
fi

# Check for TODO/FIXME comments
echo "  - Checking for TODO/FIXME comments..."
TODO_COUNT=$(grep -r "TODO\|FIXME" --include="*.rs" . | wc -l)
if [ $TODO_COUNT -gt 0 ]; then
    echo "${YELLOW}    Warning: Found $TODO_COUNT TODO/FIXME comments${NC}"
else
    echo "${GREEN}    ✓ No TODO/FIXME comments found${NC}"
fi

# Check for unsafe blocks
echo "  - Checking for unsafe blocks..."
UNSAFE_COUNT=$(grep -r "unsafe" --include="*.rs" . | wc -l)
if [ $UNSAFE_COUNT -gt 0 ]; then
    echo "${RED}    Warning: Found $UNSAFE_COUNT unsafe blocks${NC}"
    grep -r "unsafe" --include="*.rs" . | head -5
else
    echo "${GREEN}    ✓ No unsafe blocks found${NC}"
fi

# 5. Check for common smart contract vulnerabilities
print_section "5. Smart Contract Specific Checks"

echo "  - Checking for reentrancy patterns..."
REENTRANCY_PATTERNS=$(grep -r "transfer.*call\|call.*transfer" --include="*.rs" . | wc -l)
if [ $REENTRANCY_PATTERNS -gt 0 ]; then
    echo "${YELLOW}    Warning: Potential reentrancy patterns found${NC}"
else
    echo "${GREEN}    ✓ No obvious reentrancy patterns${NC}"
fi

echo "  - Checking for integer overflow patterns..."
OVERFLOW_PATTERNS=$(grep -r "checked_add\|checked_sub\|checked_mul\|checked_div" --include="*.rs" . | wc -l)
if [ $OVERFLOW_PATTERNS -gt 0 ]; then
    echo "${GREEN}    ✓ Using checked arithmetic (found $OVERFLOW_PATTERNS instances)${NC}"
else
    echo "${YELLOW}    Warning: No checked arithmetic found - verify overflow protection${NC}"
fi

echo "  - Checking for authorization checks..."
AUTH_PATTERNS=$(grep -r "require_auth\|check_auth" --include="*.rs" . | wc -l)
if [ $AUTH_PATTERNS -gt 0 ]; then
    echo "${GREEN}    ✓ Authorization checks present (found $AUTH_PATTERNS instances)${NC}"
else
    echo "${RED}    Warning: No authorization checks found${NC}"
fi

# 6. Generate security report
print_section "6. Generating Security Report"

REPORT_FILE="testing-infrastructure/security/reports/security_report_$(date +%Y%m%d_%H%M%S).md"

cat > "$REPORT_FILE" << EOF
# Security Scan Report
Generated: $(date)

## Summary

- **Panic Statements**: $PANIC_COUNT
- **Unwrap Calls**: $UNWRAP_COUNT
- **Expect Calls**: $EXPECT_COUNT
- **TODO/FIXME**: $TODO_COUNT
- **Unsafe Blocks**: $UNSAFE_COUNT
- **Reentrancy Patterns**: $REENTRANCY_PATTERNS
- **Checked Arithmetic**: $OVERFLOW_PATTERNS
- **Authorization Checks**: $AUTH_PATTERNS

## Recommendations

EOF

if [ $PANIC_COUNT -gt 0 ]; then
    echo "- Replace panic! with proper error handling" >> "$REPORT_FILE"
fi

if [ $UNWRAP_COUNT -gt 0 ]; then
    echo "- Replace unwrap() with proper error handling" >> "$REPORT_FILE"
fi

if [ $UNSAFE_COUNT -gt 0 ]; then
    echo "- Review and document all unsafe blocks" >> "$REPORT_FILE"
fi

if [ $OVERFLOW_PATTERNS -eq 0 ]; then
    echo "- Add checked arithmetic for all numeric operations" >> "$REPORT_FILE"
fi

if [ $AUTH_PATTERNS -eq 0 ]; then
    echo "- Add authorization checks to privileged functions" >> "$REPORT_FILE"
fi

echo "" >> "$REPORT_FILE"
echo "## Detailed Findings" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "See individual scan reports in the reports/ directory." >> "$REPORT_FILE"

echo "${GREEN}✓ Security report generated: $REPORT_FILE${NC}"

# 7. Summary
print_section "Security Scan Complete"

CRITICAL_ISSUES=0
if [ $UNSAFE_COUNT -gt 0 ]; then
    CRITICAL_ISSUES=$((CRITICAL_ISSUES + 1))
fi

if [ $CRITICAL_ISSUES -eq 0 ]; then
    echo "${GREEN}✓ No critical security issues found${NC}"
    echo ""
    echo "Review the detailed report for recommendations: $REPORT_FILE"
    exit 0
else
    echo "${RED}✗ Found $CRITICAL_ISSUES critical security issues${NC}"
    echo ""
    echo "Review the detailed report: $REPORT_FILE"
    exit 1
fi
