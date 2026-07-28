#!/bin/bash

# k6 Performance Testing Script for ArenaX API
# This script runs load, stress, and benchmark tests using k6

set -e

# Configuration
API_BASE_URL="${API_BASE_URL:-http://localhost:3001/api}"
API_TOKEN="${API_TOKEN:-}"
OUTPUT_DIR="./test/performance/reports"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== ArenaX API Performance Testing with k6 ===${NC}"
echo "Target: $API_BASE_URL"
echo "Output Directory: $OUTPUT_DIR"
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Check if k6 is installed
if ! command -v k6 &> /dev/null; then
    echo -e "${YELLOW}k6 not found. Installing...${NC}"
    
    # Detect OS and install accordingly
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "Installing k6 on macOS..."
        brew install k6
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "Installing k6 on Linux..."
        sudo gpg -k
        sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
        echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
        sudo apt-get update
        sudo apt-get install k6
    else
        echo -e "${RED}Unsupported OS. Please install k6 manually from https://k6.io/docs/getting-started/installation/${NC}"
        exit 1
    fi
fi

# Function to run a test
run_test() {
    local test_name=$1
    local test_file=$2
    local output_file="${OUTPUT_DIR}/${test_name}-${TIMESTAMP}.json"
    
    echo -e "${BLUE}Running ${test_name}...${NC}"
    
    K6_API_BASE_URL="$API_BASE_URL" K6_API_TOKEN="$API_TOKEN" k6 run \
        --out json="$output_file" \
        "$test_file"
    
    echo -e "${GREEN}✓ ${test_name} complete${NC}"
    echo "  Report: $output_file"
    echo ""
}

# Run tests based on arguments
if [ "$1" == "load" ]; then
    run_test "load-test" "./test/performance/load-test.js"
elif [ "$1" == "stress" ]; then
    run_test "stress-test" "./test/performance/stress-test.js"
elif [ "$1" == "benchmark" ]; then
    run_test "benchmark-test" "./test/performance/benchmark-test.js"
elif [ "$1" == "all" ]; then
    echo -e "${BLUE}Running all performance tests...${NC}"
    echo ""
    
    run_test "load-test" "./test/performance/load-test.js"
    run_test "benchmark-test" "./test/performance/benchmark-test.js"
    
    echo -e "${YELLOW}Note: Stress test is excluded from 'all' to avoid system overload.${NC}"
    echo "Run stress test separately: ./test/performance/run-k6-tests.sh stress"
else
    echo -e "${YELLOW}Usage:${NC}"
    echo "  ./test/performance/run-k6-tests.sh load       - Run load test"
    echo "  ./test/performance/run-k6-tests.sh stress     - Run stress test"
    echo "  ./test/performance/run-k6-tests.sh benchmark  - Run benchmark test"
    echo "  ./test/performance/run-k6-tests.sh all        - Run load and benchmark tests"
    echo ""
    echo -e "${YELLOW}Environment Variables:${NC}"
    echo "  API_BASE_URL - API base URL (default: http://localhost:3001/api)"
    echo "  API_TOKEN    - JWT token for authenticated requests"
    echo ""
    echo -e "${YELLOW}Example:${NC}"
    echo "  export API_BASE_URL=http://localhost:3001/api"
    echo "  export API_TOKEN=your-jwt-token"
    echo "  ./test/performance/run-k6-tests.sh load"
    exit 0
fi

echo -e "${GREEN}=== Performance Testing Complete ===${NC}"
echo "Review the JSON reports in $OUTPUT_DIR for detailed metrics"
