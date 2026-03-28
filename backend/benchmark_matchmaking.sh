#!/bin/bash

# ArenaX Matchmaking System Benchmark Script
# Tests performance under various load conditions

set -e

# Configuration
API_BASE_URL="http://localhost:8080"
TEST_GAME="benchmark-game"
TEST_MODE="ranked"
CONCURRENT_USERS=1000
TEST_DURATION=60  # seconds
WARMUP_TIME=10    # seconds

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging
LOG_FILE="matchmaking_benchmark_$(date +%Y%m%d_%H%M%S).log"
RESULTS_FILE="benchmark_results_$(date +%Y%m%d_%H%M%S).json"

echo -e "${BLUE}🚀 ArenaX Matchmaking Benchmark${NC}"
echo "=========================================="
echo "API Base URL: $API_BASE_URL"
echo "Test Game: $TEST_GAME"
echo "Test Mode: $TEST_MODE"
echo "Concurrent Users: $CONCURRENT_USERS"
echo "Test Duration: ${TEST_DURATION}s"
echo "Log File: $LOG_FILE"
echo "Results File: $RESULTS_FILE"
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

# Function to get auth token
get_auth_token() {
    echo -e "${YELLOW}🔐 Getting authentication token...${NC}"
    
    # This would need to be implemented based on your auth system
    # For now, using a mock token
    echo "mock_jwt_token_for_benchmark"
}

# Function to join queue
join_queue() {
    local user_id=$1
    local token=$2
    
    curl -s -X POST "$API_BASE_URL/api/matchmaking/join" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $token" \
        -d "{\"game\":\"$TEST_GAME\",\"game_mode\":\"$TEST_MODE\"}" \
        -w "%{http_code}" \
        -o /dev/null
}

# Function to leave queue
leave_queue() {
    local user_id=$1
    local token=$2
    
    curl -s -X POST "$API_BASE_URL/api/matchmaking/leave" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $token" \
        -d "{\"game\":\"$TEST_GAME\",\"game_mode\":\"$TEST_MODE\"}" \
        -w "%{http_code}" \
        -o /dev/null
}

# Function to get queue status
get_queue_status() {
    local user_id=$1
    local token=$2
    
    curl -s -X GET "$API_BASE_URL/api/matchmaking/status/$TEST_GAME/$TEST_MODE" \
        -H "Authorization: Bearer $token"
}

# Function to get matchmaking stats
get_matchmaking_stats() {
    local token=$1
    
    curl -s -X GET "$API_BASE_URL/api/matchmaking/stats" \
        -H "Authorization: Bearer $token"
}

# Function to benchmark queue operations
benchmark_queue_operations() {
    echo -e "${BLUE}📊 Benchmarking Queue Operations${NC}"
    
    local token=$(get_auth_token)
    local successful_joins=0
    local failed_joins=0
    local start_time=$(date +%s)
    
    echo "Testing join operations..."
    
    # Test concurrent joins
    for i in $(seq 1 $CONCURRENT_USERS); do
        local user_id="benchmark_user_$i"
        
        if [ "$(join_queue $user_id $token)" = "200" ]; then
            ((successful_joins++))
        else
            ((failed_joins++))
        fi
        
        # Progress indicator
        if [ $((i % 100)) -eq 0 ]; then
            echo -n "."
        fi
    done
    
    echo ""
    echo "Join Operations: $successful_joins successful, $failed_joins failed"
    
    # Wait for warmup
    echo -e "${YELLOW}⏳ Warming up for ${WARMUP_TIME}s...${NC}"
    sleep $WARMUP_TIME
    
    # Get initial stats
    local initial_stats=$(get_matchmaking_stats $token)
    echo "Initial queue size: $(echo $initial_stats | jq -r '.total_players_in_queue // 0')"
    
    # Monitor queue during test duration
    echo -e "${BLUE}📈 Monitoring queue for ${TEST_DURATION}s...${NC}"
    
    local end_time=$((start_time + TEST_DURATION))
    local sample_count=0
    
    while [ $(date +%s) -lt $end_time ]; do
        local current_stats=$(get_matchmaking_stats $token)
        local queue_size=$(echo $current_stats | jq -r '.total_players_in_queue // 0')
        local timestamp=$(date +%s)
        
        echo "$timestamp,$queue_size" >> "$LOG_FILE"
        ((sample_count++))
        
        sleep 5
    done
    
    echo "Collected $sample_count samples"
    
    # Test leave operations
    echo -e "${BLUE}📤 Testing Leave Operations${NC}"
    
    local successful_leaves=0
    local failed_leaves=0
    
    for i in $(seq 1 $CONCURRENT_USERS); do
        local user_id="benchmark_user_$i"
        
        if [ "$(leave_queue $user_id $token)" = "200" ]; then
            ((successful_leaves++))
        else
            ((failed_leaves++))
        fi
        
        if [ $((i % 100)) -eq 0 ]; then
            echo -n "."
        fi
    done
    
    echo ""
    echo "Leave Operations: $successful_leaves successful, $failed_leaves failed"
    
    # Get final stats
    local final_stats=$(get_matchmaking_stats $token)
    echo "Final queue size: $(echo $final_stats | jq -r '.total_players_in_queue // 0')"
}

# Function to benchmark API latency
benchmark_api_latency() {
    echo -e "${BLUE}⚡ Benchmarking API Latency${NC}"
    
    local token=$(get_auth_token)
    local iterations=100
    local total_time=0
    
    echo "Testing $iterations API calls..."
    
    for i in $(seq 1 $iterations); do
        local start=$(date +%s%N)
        get_matchmaking_stats $token > /dev/null
        local end=$(date +%s%N)
        
        local duration=$((end - start))
        total_time=$((total_time + duration))
        
        if [ $((i % 20)) -eq 0 ]; then
            echo -n "."
        fi
    done
    
    echo ""
    local avg_latency=$((total_time / iterations / 1000000)) # Convert to milliseconds
    echo "Average API Latency: ${avg_latency}ms"
}

# Function to stress test Redis operations
stress_test_redis() {
    echo -e "${BLUE}🔥 Stress Testing Redis Operations${NC}"
    
    local token=$(get_auth_token)
    local operations=10000
    local start_time=$(date +%s)
    
    echo "Performing $operations Redis operations..."
    
    for i in $(seq 1 $operations); do
        # Alternate join/leave operations
        if [ $((i % 2)) -eq 0 ]; then
            join_queue "stress_user_$i" $token > /dev/null
        else
            leave_queue "stress_user_$i" $token > /dev/null
        fi
        
        if [ $((i % 1000)) -eq 0 ]; then
            echo -n "."
        fi
    done
    
    echo ""
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    local ops_per_sec=$((operations / duration))
    
    echo "Redis Operations: $operations in ${duration}s (${ops_per_sec} ops/sec)"
}

# Function to generate performance report
generate_report() {
    echo -e "${BLUE}📋 Generating Performance Report${NC}"
    
    local token=$(get_auth_token)
    local final_stats=$(get_matchmaking_stats $token)
    
    # Create JSON report
    cat > "$RESULTS_FILE" << EOF
{
  "benchmark": {
    "timestamp": "$(date -Iseconds)",
    "configuration": {
      "api_base_url": "$API_BASE_URL",
      "test_game": "$TEST_GAME",
      "test_mode": "$TEST_MODE",
      "concurrent_users": $CONCURRENT_USERS,
      "test_duration": $TEST_DURATION
    },
    "results": {
      "final_stats": $final_stats,
      "log_file": "$LOG_FILE"
    }
  }
}
EOF
    
    echo "Report saved to: $RESULTS_FILE"
    
    # Display summary
    echo ""
    echo -e "${GREEN}📊 Benchmark Summary${NC}"
    echo "===================="
    echo "Total Players Tested: $CONCURRENT_USERS"
    echo "Test Duration: ${TEST_DURATION}s"
    echo "Final Queue Size: $(echo $final_stats | jq -r '.total_players_in_queue // 0')"
    echo "Active Games: $(echo $final_stats | jq -r '.games | length')"
    echo "Matches Created (last hour): $(echo $final_stats | jq -r '.matches_created_last_hour // 0')"
    echo "Average Wait Time: $(echo $final_stats | jq -r '.average_wait_time // 0')s"
}

# Function to cleanup test data
cleanup_test_data() {
    echo -e "${YELLOW}🧹 Cleaning up test data...${NC}"
    
    local token=$(get_auth_token)
    
    # Remove all benchmark users from queue
    for i in $(seq 1 $CONCURRENT_USERS); do
        leave_queue "benchmark_user_$i" $token > /dev/null 2>&1 || true
        leave_queue "stress_user_$i" $token > /dev/null 2>&1 || true
    done
    
    echo "Test data cleaned up"
}

# Main execution
main() {
    echo "Starting ArenaX Matchmaking Benchmark..."
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
    
    # Run benchmarks
    echo -e "${BLUE}🏁 Starting Benchmark Suite${NC}"
    echo ""
    
    benchmark_queue_operations
    echo ""
    
    benchmark_api_latency
    echo ""
    
    stress_test_redis
    echo ""
    
    generate_report
    echo ""
    
    cleanup_test_data
    
    echo -e "${GREEN}✅ Benchmark completed successfully!${NC}"
    echo "Results saved to: $RESULTS_FILE"
    echo "Logs saved to: $LOG_FILE"
}

# Handle script interruption
trap cleanup_test_data EXIT

# Run main function
main "$@"
