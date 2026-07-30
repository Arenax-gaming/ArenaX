#!/bin/bash

# OWASP ZAP Security Scan Script for ArenaX API
# This script runs automated security testing using OWASP ZAP

set -e

# Configuration
ZAP_PORT=8080
ZAP_API_KEY="zap-api-key-change-in-production"
API_BASE_URL="${API_BASE_URL:-http://localhost:3001/api}"
API_TOKEN="${API_TOKEN:-}"
OUTPUT_DIR="./test/security/reports"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== ArenaX API Security Scan with OWASP ZAP ===${NC}"
echo "Target: $API_BASE_URL"
echo "Output Directory: $OUTPUT_DIR"
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Check if ZAP is installed
if ! command -v zap-cli &> /dev/null; then
    echo -e "${YELLOW}ZAP CLI not found. Installing...${NC}"
    pip install zap-cli
fi

# Check if Docker is available (alternative method)
if command -v docker &> /dev/null; then
    echo -e "${GREEN}Using Docker to run ZAP...${NC}"
    
    # Start ZAP in daemon mode
    echo "Starting ZAP daemon..."
    docker run -d \
        --name zap-scan \
        -p $ZAP_PORT:8080 \
        -w /zap/wrk \
        -i zaproxy/zap-stable:latest \
        zap.sh -daemon -host 0.0.0.0 -port $ZAP_PORT -config api.addrs.addr.name=.* -config api.addrs.addr.regex=true -config api.key=$ZAP_API_KEY
    
    # Wait for ZAP to start
    echo "Waiting for ZAP to start..."
    sleep 10
    
    # Run the scan
    echo "Starting security scan..."
    zap-cli quick-scan \
        --self-contained \
        --start-options '-config api.key='$ZAP_API_KEY \
        --spider \
        --ajax-spider \
        --scanners all \
        --output-file "$OUTPUT_DIR/zap-report-$TIMESTAMP.html" \
        "$API_BASE_URL"
    
    # Stop ZAP container
    echo "Stopping ZAP container..."
    docker stop zap-scan
    docker rm zap-scan
else
    echo -e "${YELLOW}Docker not found. Using local ZAP installation...${NC}"
    
    # Start ZAP in daemon mode
    echo "Starting ZAP daemon..."
    zap-cli start -p $ZAP_PORT -config api.addrs.addr.name=.* -config api.addrs.addr.regex=true -config api.key=$ZAP_API_KEY
    
    # Wait for ZAP to start
    echo "Waiting for ZAP to start..."
    sleep 5
    
    # Run the scan
    echo "Starting security scan..."
    zap-cli quick-scan \
        --self-contained \
        --spider \
        --ajax-spider \
        --scanners all \
        --output-file "$OUTPUT_DIR/zap-report-$TIMESTAMP.html" \
        "$API_BASE_URL"
    
    # Shutdown ZAP
    echo "Shutting down ZAP..."
    zap-cli shutdown
fi

# Generate additional report formats
echo "Generating additional report formats..."
zap-cli report -o "$OUTPUT_DIR/zap-report-$TIMESTAMP.json" -f json
zap-cli report -o "$OUTPUT_DIR/zap-report-$TIMESTAMP.xml" -f xml
zap-cli report -o "$OUTPUT_DIR/zap-report-$TIMESTAMP.md" -f md

# Analyze results
echo -e "${GREEN}=== Scan Complete ===${NC}"
echo "Reports generated:"
echo "  - HTML: $OUTPUT_DIR/zap-report-$TIMESTAMP.html"
echo "  - JSON: $OUTPUT_DIR/zap-report-$TIMESTAMP.json"
echo "  - XML: $OUTPUT_DIR/zap-report-$TIMESTAMP.xml"
echo "  - Markdown: $OUTPUT_DIR/zap-report-$TIMESTAMP.md"

# Check for high/medium severity issues
if [ -f "$OUTPUT_DIR/zap-report-$TIMESTAMP.json" ]; then
    HIGH_COUNT=$(jq '.site[].alerts[] | select(.risk == "High") | length' "$OUTPUT_DIR/zap-report-$TIMESTAMP.json" | wc -l)
    MEDIUM_COUNT=$(jq '.site[].alerts[] | select(.risk == "Medium") | length' "$OUTPUT_DIR/zap-report-$TIMESTAMP.json" | wc -l)
    
    echo ""
    echo -e "${YELLOW}=== Summary ===${NC}"
    echo "High severity issues: $HIGH_COUNT"
    echo "Medium severity issues: $MEDIUM_COUNT"
    
    if [ "$HIGH_COUNT" -gt 0 ]; then
        echo -e "${RED}⚠️  High severity vulnerabilities found! Please review the report.${NC}"
        exit 1
    else
        echo -e "${GREEN}✓ No high severity vulnerabilities found.${NC}"
    fi
fi

echo -e "${GREEN}=== Security Scan Complete ===${NC}"
