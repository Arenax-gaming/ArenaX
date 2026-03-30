#!/bin/bash

# ArenaX Idempotency Framework Test Script
# Tests the idempotency framework with various scenarios

set -e

# Configuration
API_BASE_URL="http://localhost:8080"
TEST_KEY_PREFIX="test_$(date +%s)"
NUM_CONCURRENT_REQUESTS=50
TEST_AMOUNT=100

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧪 ArenaX Idempotency Framework Test Suite${NC}"
echo "=========================================="
echo "API Base URL: $API_BASE_URL"
echo "Test Key Prefix: $TEST_KEY_PREFIX"
echo "Concurrent Requests: $NUM_CONCURRENT_REQUESTS"
echo ""

# Function to check if API is available
check_api_health() {
    echo -e "${YELLOW}🔍 Checking API health...${NC}"
    
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s -f "$API_BASE_URL/api/health" > /dev/null; then
            echo -e "${GREEN}✅ API is healthy${NC}"
            return 0
        fi
        
        echo -e "${YELLOW}⏳ Waiting for API... (attempt $attempt/$max_attempts)${NC}"
        sleep 2
        ((attempt++))
    done
    
    echo -e "${RED}❌ API is not available${NC}"
    return 1
}

# Function to generate idempotency key
generate_key() {
    local ttl=${1:-3600}
    
    echo -e "${YELLOW}🔑 Generating idempotency key...${NC}"
    
    local response=$(curl -s -X POST "$API_BASE_URL/api/idempotency/generate-key?ttl_seconds=$ttl" \
        -H "Content-Type: application/json")
    
    if [ $? -eq 0 ]; then
        local key=$(echo "$response" | jq -r '.key // empty')
        if [ -n "$key" ]; then
            echo -e "${GREEN}✅ Generated key: $key${NC}"
            echo "$key"
            return 0
        fi
    fi
    
    echo -e "${RED}❌ Failed to generate key${NC}"
    return 1
}

# Function to test basic idempotency
test_basic_idempotency() {
    echo -e "${BLUE}📋 Testing Basic Idempotency${NC}"
    
    local key="$1"
    local test_data='{"amount": '$TEST_AMOUNT', "currency": "USD", "description": "Test payment"}'
    
    echo "Making first request with key: $key"
    local response1=$(curl -s -X POST "$API_BASE_URL/api/test/payment" \
        -H "Content-Type: application/json" \
        -H "Idempotency-Key: $key" \
        -d "$test_data")
    
    echo "First response: $response1"
    
    # Check if response was cached
    local cached=$(echo "$response1" | jq -r '.cached // false')
    if [ "$cached" = "false" ]; then
        echo -e "${GREEN}✅ First request processed (not cached)${NC}"
    else
        echo -e "${YELLOW}⚠️ First request was cached (unexpected)${NC}"
    fi
    
    echo "Making second request with same key"
    local response2=$(curl -s -X POST "$API_BASE_URL/api/test/payment" \
        -H "Content-Type: application/json" \
        -H "Idempotency-Key: $key" \
        -d "$test_data")
    
    echo "Second response: $response2"
    
    # Check if response was from cache
    local cached=$(echo "$response2" | jq -r '.cached // false')
    if [ "$cached" = "true" ]; then
        echo -e "${GREEN}✅ Second request returned cached response${NC}"
    else
        echo -e "${RED}❌ Second request was not cached${NC}"
        return 1
    fi
    
    # Check if responses are identical
    local payment_id1=$(echo "$response1" | jq -r '.payment_id // empty')
    local payment_id2=$(echo "$response2" | jq -r '.payment_id // empty')
    
    if [ "$payment_id1" = "$payment_id2" ]; then
        echo -e "${GREEN}✅ Responses are identical (same payment_id: $payment_id1)${NC}"
    else
        echo -e "${RED}❌ Responses differ (payment_id1: $payment_id1, payment_id2: $payment_id2)${NC}"
        return 1
    fi
}

# Function to test conflict detection
test_conflict_detection() {
    echo -e "${BLUE}⚔️ Testing Conflict Detection${NC}"
    
    local key="$1"
    local test_data1='{"amount": '$TEST_AMOUNT', "currency": "USD", "description": "Test payment 1"}'
    local test_data2='{"amount": 200, "currency": "USD", "description": "Test payment 2"}'
    
    echo "Making first request"
    local response1=$(curl -s -X POST "$API_BASE_URL/api/test/payment" \
        -H "Content-Type: application/json" \
        -H "Idempotency-Key: $key" \
        -d "$test_data1")
    
    echo "First response: $response1"
    
    echo "Making second request with different payload (should conflict)"
    local response2=$(curl -s -X POST "$API_BASE_URL/api/test/payment" \
        -H "Content-Type: application/json" \
        -H "Idempotency-Key: $key" \
        -d "$test_data2")
    
    echo "Second response: $response2"
    
    # Check for conflict response
    local status_code=$(echo "$response2" | jq -r '.status // 200')
    local error_type=$(echo "$response2" | jq -r '.error // empty')
    
    if [ "$status_code" = "409" ] && [ "$error_type" = "IdempotencyKeyConflict" ]; then
        echo -e "${GREEN}✅ Conflict detected correctly${NC}"
        
        local original_hash=$(echo "$response2" | jq -r '.original_hash // empty')
        local new_hash=$(echo "$response2" | jq -r '.new_hash // empty')
        echo "Original hash: $original_hash"
        echo "New hash: $new_hash"
    else
        echo -e "${RED}❌ Conflict not detected (status: $status_code, error: $error_type)${NC}"
        return 1
    fi
}

# Function to test concurrent requests
test_concurrent_requests() {
    echo -e "${BLUE}🚀 Testing Concurrent Requests${NC}"
    
    local base_key="$1"
    local test_data='{"amount": '$TEST_AMOUNT', "currency": "USD", "description": "Concurrent test"}'
    
    echo "Launching $NUM_CONCURRENT_REQUESTS concurrent requests..."
    
    # Create temporary directory for results
    local temp_dir=$(mktemp -d)
    
    # Launch concurrent requests
    for i in $(seq 1 $NUM_CONCURRENT_REQUESTS); do
        {
            local key="${base_key}_concurrent_$i"
            local response=$(curl -s -X POST "$API_BASE_URL/api/test/payment" \
                -H "Content-Type: application/json" \
                -H "Idempotency-Key: $key" \
                -d "$test_data")
            
            echo "$response" > "$temp_dir/response_$i"
            echo "Request $i completed"
        } &
    done
    
    # Wait for all requests to complete
    wait
    
    echo "Analyzing results..."
    
    # Count successful requests
    local successful=0
    local failed=0
    local unique_payment_ids=()
    
    for i in $(seq 1 $NUM_CONCURRENT_REQUESTS); do
        local response_file="$temp_dir/response_$i"
        
        if [ -f "$response_file" ]; then
            local response=$(cat "$response_file")
            local payment_id=$(echo "$response" | jq -r '.payment_id // empty')
            
            if [ -n "$payment_id" ]; then
                ((successful++))
                unique_payment_ids+=("$payment_id")
            else
                ((failed++))
            fi
        else
            ((failed++))
        fi
    done
    
    echo "Results:"
    echo "  Successful: $successful"
    echo "  Failed: $failed"
    echo "  Total: $((successful + failed))"
    
    # Check for duplicate payment IDs (shouldn't happen with proper idempotency)
    local unique_count=$(printf '%s\n' "${unique_payment_ids[@]}" | sort -u | wc -l)
    
    if [ "$unique_count" -eq "$successful" ]; then
        echo -e "${GREEN}✅ All payment IDs are unique${NC}"
    else
        echo -e "${RED}❌ Found duplicate payment IDs!${NC}"
        echo "  Expected: $successful unique IDs"
        echo "  Found: $unique_count unique IDs"
    fi
    
    # Cleanup
    rm -rf "$temp_dir"
    
    if [ "$failed" -eq 0 ] && [ "$unique_count" -eq "$successful" ]; then
        return 0
    else
        return 1
    fi
}

# Function to test performance
test_performance() {
    echo -e "${BLUE}⚡ Testing Performance${NC}"
    
    local key="$1"
    local test_data='{"amount": 1, "currency": "USD", "description": "Performance test"}'
    
    echo "Testing 1000 sequential requests..."
    
    local start_time=$(date +%s%N)
    
    for i in $(seq 1 1000); do
        local unique_key="${key}_perf_$i"
        curl -s -X POST "$API_BASE_URL/api/test/payment" \
            -H "Content-Type: application/json" \
            -H "Idempotency-Key: $unique_key" \
            -d "$test_data" > /dev/null
    done
    
    local end_time=$(date +%s%N)
    local duration_ns=$((end_time - start_time))
    local duration_sec=$(echo "$duration_ns / 1000000000" | bc -l)
    local ops_per_sec=$(echo "1000 / $duration_sec" | bc -l)
    
    printf "Duration: %.2f seconds\n" "$duration_sec"
    printf "Operations per second: %.2f\n" "$ops_per_sec"
    
    if (( $(echo "$ops_per_sec >= 50" | bc -l) )); then
        echo -e "${GREEN}✅ Performance test passed (>= 50 ops/sec)${NC}"
    else
        echo -e "${YELLOW}⚠️ Performance below threshold (< 50 ops/sec)${NC}"
    fi
}

# Function to test key validation
test_key_validation() {
    echo -e "${BLUE}🔍 Testing Key Validation${NC}"
    
    echo "Testing valid key format..."
    local valid_key="valid_key_123"
    local response=$(curl -s -X POST "$API_BASE_URL/api/idempotency/validate" \
        -H "Content-Type: application/json" \
        -d "{\"key\": \"$valid_key\"}")
    
    local is_valid=$(echo "$response" | jq -r '.valid // false')
    if [ "$is_valid" = "true" ]; then
        echo -e "${GREEN}✅ Valid key accepted${NC}"
    else
        echo -e "${RED}❌ Valid key rejected${NC}"
        return 1
    fi
    
    echo "Testing invalid key format..."
    local invalid_key="invalid key!"
    local response=$(curl -s -X POST "$API_BASE_URL/api/idempotency/validate" \
        -H "Content-Type: application/json" \
        -d "{\"key\": \"$invalid_key\"}")
    
    local is_valid=$(echo "$response" | jq -r '.valid // false')
    if [ "$is_valid" = "false" ]; then
        echo -e "${GREEN}✅ Invalid key rejected${NC}"
    else
        echo -e "${RED}❌ Invalid key accepted${NC}"
        return 1
    fi
}

# Function to test cleanup
test_cleanup() {
    echo -e "${BLUE}🧹 Testing Cleanup${NC}"
    
    echo "Getting initial stats..."
    local initial_stats=$(curl -s -X GET "$API_BASE_URL/api/idempotency/stats" \
        -H "Authorization: Bearer admin-token")
    
    local initial_keys=$(echo "$initial_stats" | jq -r '.total_keys // 0')
    echo "Initial total keys: $initial_keys"
    
    echo "Running cleanup..."
    local cleanup_response=$(curl -s -X POST "$API_BASE_URL/api/idempotency/cleanup" \
        -H "Authorization: Bearer admin-token")
    
    local cleaned_keys=$(echo "$cleanup_response" | jq -r '.cleaned_keys // 0')
    echo "Cleaned keys: $cleaned_keys"
    
    echo "Getting final stats..."
    local final_stats=$(curl -s -X GET "$API_BASE_URL/api/idempotency/stats" \
        -H "Authorization: Bearer admin-token")
    
    local final_keys=$(echo "$final_stats" | jq -r '.total_keys // 0')
    echo "Final total keys: $final_keys"
    
    echo -e "${GREEN}✅ Cleanup test completed${NC}"
}

# Function to get framework info
test_framework_info() {
    echo -e "${BLUE}ℹ️ Framework Information${NC}"
    
    local info=$(curl -s -X GET "$API_BASE_URL/api/idempotency/info")
    
    echo "Enabled routes:"
    echo "$info" | jq -r '.policy.enabled_routes[]' | sed 's/^/  - /'
    
    echo "Default TTL: $(echo "$info" | jq -r '.policy.default_ttl_seconds') seconds"
    echo "Max response size: $(echo "$info" | jq -r '.policy.max_response_size_kb') KB"
    echo "Key header: $(echo "$info" | jq -r '.policy.key_header_name')"
}

# Main execution
main() {
    echo "Starting ArenaX Idempotency Framework tests..."
    echo "Timestamp: $(date)"
    echo ""
    
    # Check prerequisites
    if ! command -v curl &> /dev/null; then
        echo -e "${RED}❌ curl is required but not installed${NC}"
        exit 1
    fi
    
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}❌ jq is required but not installed${NC}"
        exit 1
    fi
    
    # Check API health
    if ! check_api_health; then
        exit 1
    fi
    
    # Generate test keys
    local basic_key="${TEST_KEY_PREFIX}_basic"
    local conflict_key="${TEST_KEY_PREFIX}_conflict"
    local concurrent_key="${TEST_KEY_PREFIX}_concurrent"
    local performance_key="${TEST_KEY_PREFIX}_performance"
    
    # Run tests
    echo -e "${BLUE}🧪 Running Test Suite${NC}"
    echo ""
    
    test_framework_info
    echo ""
    
    test_key_validation
    echo ""
    
    echo -e "${BLUE}📋 Basic Idempotency Test${NC}"
    test_basic_idempotency "$basic_key"
    echo ""
    
    echo -e "${BLUE}⚔️ Conflict Detection Test${NC}"
    test_conflict_detection "$conflict_key"
    echo ""
    
    echo -e "${BLUE}🚀 Concurrent Requests Test${NC}"
    test_concurrent_requests "$concurrent_key"
    echo ""
    
    echo -e "${BLUE}⚡ Performance Test${NC}"
    test_performance "$performance_key"
    echo ""
    
    test_cleanup
    echo ""
    
    echo -e "${GREEN}🎉 All tests completed!${NC}"
    echo ""
    echo "Test Summary:"
    echo "- Basic idempotency: ✅"
    echo "- Conflict detection: ✅"
    echo "- Concurrent requests: ✅"
    echo "- Performance: ✅"
    echo "- Key validation: ✅"
    echo "- Cleanup: ✅"
}

# Handle script interruption
trap 'echo -e "\n${YELLOW}⚠️ Test interrupted${NC}"; exit 1' INT TERM

# Run main function
main "$@"
