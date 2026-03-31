#!/bin/bash

# ArenaX Idempotency Framework Setup Script
# Sets up the idempotency framework for ArenaX

set -e

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_NAME="arenax"
DB_USER="arenax"
DB_PASSWORD="arenax123"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔧 ArenaX Idempotency Framework Setup${NC}"
echo "======================================"
echo "Project Root: $PROJECT_ROOT"
echo "Database: $DB_NAME"
echo ""

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check PostgreSQL connection
check_postgres_connection() {
    echo -e "${YELLOW}🔍 Checking PostgreSQL connection...${NC}"
    
    if PGPASSWORD=$DB_PASSWORD psql -h localhost -U $DB_USER -d $DB_NAME -c "SELECT 1;" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ PostgreSQL connection successful${NC}"
        return 0
    else
        echo -e "${RED}❌ PostgreSQL connection failed${NC}"
        return 1
    fi
}

# Function to run database migration
run_migration() {
    echo -e "${YELLOW}🗄️ Running idempotency migration...${NC}"
    
    local migration_file="$PROJECT_ROOT/idempotency_migration.sql"
    
    if [ ! -f "$migration_file" ]; then
        echo -e "${RED}❌ Migration file not found: $migration_file${NC}"
        return 1
    fi
    
    if PGPASSWORD=$DB_PASSWORD psql -h localhost -U $DB_USER -d $DB_NAME -f "$migration_file"; then
        echo -e "${GREEN}✅ Migration completed successfully${NC}"
        return 0
    else
        echo -e "${RED}❌ Migration failed${NC}"
        return 1
    fi
}

# Function to verify database schema
verify_schema() {
    echo -e "${YELLOW}🔍 Verifying database schema...${NC}"
    
    local tables=("idempotency_keys" "idempotency_configs" "request_logs")
    
    for table in "${tables[@]}"; do
        if PGPASSWORD=$DB_PASSWORD psql -h localhost -U $DB_USER -d $DB_NAME -c "\dt $table" >/dev/null 2>&1; then
            echo -e "${GREEN}✅ Table $table exists${NC}"
        else
            echo -e "${RED}❌ Table $table missing${NC}"
            return 1
        fi
    done
    
    # Check indexes
    local indexes=("idx_idempotency_keys_key" "idx_idempotency_keys_expires_at" "idx_request_logs_created_at")
    
    for index in "${indexes[@]}"; do
        if PGPASSWORD=$DB_PASSWORD psql -h localhost -U $DB_USER -d $DB_NAME -c "\di $index" >/dev/null 2>&1; then
            echo -e "${GREEN}✅ Index $index exists${NC}"
        else
            echo -e "${YELLOW}⚠️ Index $index missing (may be created automatically)${NC}"
        fi
    done
    
    # Check views
    local views=("active_idempotency_keys" "idempotency_usage_stats" "idempotency_conflicts")
    
    for view in "${views[@]}"; do
        if PGPASSWORD=$DB_PASSWORD psql -h localhost -U $DB_USER -d $DB_NAME -c "\dv $view" >/dev/null 2>&1; then
            echo -e "${GREEN}✅ View $view exists${NC}"
        else
            echo -e "${RED}❌ View $view missing${NC}"
            return 1
        fi
    done
    
    return 0
}

# Function to check Rust dependencies
check_rust_dependencies() {
    echo -e "${YELLOW}🦀 Checking Rust dependencies...${NC}"
    
    if ! command_exists cargo; then
        echo -e "${RED}❌ Rust/Cargo is not installed${NC}"
        echo "Please install Rust from https://rustup.rs/"
        return 1
    fi
    
    cd "$PROJECT_ROOT"
    
    # Check if required crates are in Cargo.toml
    local required_crates=("sha2" "uuid" "chrono" "serde_json" "sqlx" "actix-web")
    
    for crate in "${required_crates[@]}"; do
        if grep -q "$crate" Cargo.toml; then
            echo -e "${GREEN}✅ Crate $crate found${NC}"
        else
            echo -e "${RED}❌ Crate $crate not found in Cargo.toml${NC}"
            return 1
        fi
    done
    
    return 0
}

# Function to build the project
build_project() {
    echo -e "${YELLOW}🔨 Building ArenaX backend...${NC}"
    
    cd "$PROJECT_ROOT"
    
    if cargo check; then
        echo -e "${GREEN}✅ Project builds successfully${NC}"
    else
        echo -e "${RED}❌ Build failed${NC}"
        return 1
    fi
    
    return 0
}

# Function to run tests
run_tests() {
    echo -e "${YELLOW}🧪 Running idempotency tests...${NC}"
    
    cd "$PROJECT_ROOT"
    
    # Run unit tests
    if cargo test idempotency --lib; then
        echo -e "${GREEN}✅ Unit tests passed${NC}"
    else
        echo -e "${RED}❌ Unit tests failed${NC}"
        return 1
    fi
    
    return 0
}

# Function to create test data
create_test_data() {
    echo -e "${YELLOW}📊 Creating test data...${NC}"
    
    # Insert test configurations
    PGPASSWORD=$DB_PASSWORD psql -h localhost -U $DB_USER -d $DB_NAME << EOF
-- Insert test configurations
INSERT INTO idempotency_configs (route_pattern, enabled, ttl_seconds, max_response_size_kb) VALUES
('/api/test/payment', true, 3600, 512),
('/api/test/refund', true, 3600, 512),
('/api/test/deposit', true, 1800, 256)
ON CONFLICT (route_pattern) DO NOTHING;

-- Insert sample idempotency keys for testing
INSERT INTO idempotency_keys (key, request_hash, response_status, response_headers, response_body, created_at, expires_at, used_at) VALUES
('test_key_001', 'hash_001', 200, '{"Content-Type": "application/json"}', '{"message": "Test response 1", "timestamp": "2024-01-01T00:00:00Z"}', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', NOW() - INTERVAL '59 minutes'),
('test_key_002', 'hash_002', 201, '{"Content-Type": "application/json"}', '{"message": "Test response 2", "timestamp": "2024-01-01T01:00:00Z"}', NOW() - INTERVAL '30 minutes', NOW() + INTERVAL '30 minutes', NOW() - INTERVAL '29 minutes')
ON CONFLICT (key) DO NOTHING;
EOF
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Test data created successfully${NC}"
    else
        echo -e "${RED}❌ Failed to create test data${NC}"
        return 1
    fi
    
    return 0
}

# Function to setup environment variables
setup_environment() {
    echo -e "${YELLOW}⚙️ Setting up environment variables...${NC}"
    
    local env_file="$PROJECT_ROOT/.env"
    
    if [ ! -f "$env_file" ]; then
        cat > "$env_file" << EOF
# Database Configuration
DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@localhost/$DB_NAME

# Server Configuration
SERVER_HOST=127.0.0.1
SERVER_PORT=8080

# Idempotency Configuration
IDEMPOTENCY_DEFAULT_TTL_SECONDS=86400
IDEMPOTENCY_MAX_RESPONSE_SIZE_KB=1024
IDEMPOTENCY_KEY_HEADER=Idempotency-Key

# Logging
RUST_LOG=info

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
EOF
        echo -e "${GREEN}✅ Environment file created${NC}"
    else
        echo -e "${YELLOW}⚠️ Environment file already exists${NC}"
        
        # Add idempotency variables if not present
        if ! grep -q "IDEMPOTENCY_DEFAULT_TTL_SECONDS" "$env_file"; then
            echo "" >> "$env_file"
            echo "# Idempotency Configuration" >> "$env_file"
            echo "IDEMPOTENCY_DEFAULT_TTL_SECONDS=86400" >> "$env_file"
            echo "IDEMPOTENCY_MAX_RESPONSE_SIZE_KB=1024" >> "$env_file"
            echo "IDEMPOTENCY_KEY_HEADER=Idempotency-Key" >> "$env_file"
            echo -e "${GREEN}✅ Added idempotency environment variables${NC}"
        fi
    fi
    
    return 0
}

# Function to create startup script
create_startup_script() {
    echo -e "${YELLOW}📜 Creating startup script...${NC}"
    
    local startup_script="$PROJECT_ROOT/start_with_idempotency.sh"
    
    cat > "$startup_script" << 'EOF'
#!/bin/bash

# ArenaX Backend Startup Script with Idempotency Framework

set -e

echo "🚀 Starting ArenaX Backend with Idempotency Framework..."

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Check database connection
echo "🔍 Checking database connection..."
if psql "$DATABASE_URL" -c "SELECT 1;" > /dev/null 2>&1; then
    echo "✅ Database connection successful"
else
    echo "❌ Database connection failed"
    exit 1
fi

# Start the backend
echo "🎮 Starting ArenaX backend..."
cargo run

echo "🛑 ArenaX backend stopped"
EOF
    
    chmod +x "$startup_script"
    echo -e "${GREEN}✅ Startup script created: $startup_script${NC}"
    
    return 0
}

# Function to show next steps
show_next_steps() {
    echo ""
    echo -e "${GREEN}🎉 Idempotency Framework Setup Complete!${NC}"
    echo ""
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "1. Start the ArenaX backend:"
    echo "   cd $PROJECT_ROOT"
    echo "   cargo run"
    echo "   # or use the startup script:"
    echo "   ./start_with_idempotency.sh"
    echo ""
    echo "2. Test the framework:"
    echo "   bash test_idempotency.sh"
    echo ""
    echo "3. Check the API documentation:"
    echo "   curl http://localhost:8080/api/idempotency/info"
    echo ""
    echo "4. Monitor the system:"
    echo "   curl http://localhost:8080/api/test/health"
    echo ""
    echo -e "${BLUE}📚 Documentation:${NC}"
    echo "  - Framework Guide: $PROJECT_ROOT/IDEMPOTENCY_FRAMEWORK.md"
    echo "  - API Examples: See test_idempotency.sh"
    echo "  - Database Schema: $PROJECT_ROOT/idempotency_migration.sql"
    echo ""
    echo -e "${GREEN}🚀 Your idempotency framework is ready!${NC}"
}

# Function to show help
show_help() {
    echo "ArenaX Idempotency Framework Setup"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help     Show this help message"
    echo "  --skip-tests   Skip running tests"
    echo "  --dev          Development setup (skip some validations)"
    echo "  --clean        Clean up existing data before setup"
    echo ""
    echo "Examples:"
    echo "  $0                    # Full setup"
    echo "  $0 --dev              # Development setup"
    echo "  $0 --skip-tests       # Skip tests"
    echo "  $0 --clean            # Clean setup"
    echo ""
}

# Parse command line arguments
SKIP_TESTS=false
DEV_MODE=false
CLEAN_SETUP=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --dev)
            DEV_MODE=true
            shift
            ;;
        --clean)
            CLEAN_SETUP=true
            shift
            ;;
        *)
            echo -e "${RED}❌ Unknown option: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

# Main execution
main() {
    echo "Starting ArenaX Idempotency Framework setup..."
    echo ""
    
    # Clean setup if requested
    if [ "$CLEAN_SETUP" = true ]; then
        echo -e "${YELLOW}🧹 Cleaning existing data...${NC}"
        if PGPASSWORD=$DB_PASSWORD psql -h localhost -U $DB_USER -d $DB_NAME -c "
            DROP TABLE IF EXISTS idempotency_keys CASCADE;
            DROP TABLE IF EXISTS idempotency_configs CASCADE;
            DROP TABLE IF EXISTS request_logs CASCADE;
        " 2>/dev/null; then
            echo -e "${GREEN}✅ Cleaned existing data${NC}"
        else
            echo -e "${YELLOW}⚠️ No existing data to clean${NC}"
        fi
        echo ""
    fi
    
    # Check prerequisites
    if [ "$DEV_MODE" = false ]; then
        if ! check_postgres_connection; then
            echo -e "${RED}❌ Please ensure PostgreSQL is running and accessible${NC}"
            exit 1
        fi
    fi
    
    if ! check_rust_dependencies; then
        echo -e "${RED}❌ Please ensure Rust and required dependencies are installed${NC}"
        exit 1
    fi
    
    # Run migration
    if ! run_migration; then
        echo -e "${RED}❌ Database migration failed${NC}"
        exit 1
    fi
    
    # Verify schema
    if ! verify_schema; then
        echo -e "${RED}❌ Database schema verification failed${NC}"
        exit 1
    fi
    
    # Build project
    if ! build_project; then
        echo -e "${RED}❌ Project build failed${NC}"
        exit 1
    fi
    
    # Run tests
    if [ "$SKIP_TESTS" = false ]; then
        if ! run_tests; then
            echo -e "${RED}❌ Tests failed${NC}"
            exit 1
        fi
    else
        echo -e "${YELLOW}⚠️ Skipping tests as requested${NC}"
    fi
    
    # Setup environment
    setup_environment
    
    # Create test data
    if [ "$DEV_MODE" = false ]; then
        create_test_data
    fi
    
    # Create startup script
    create_startup_script
    
    # Show next steps
    show_next_steps
}

# Handle script interruption
trap 'echo -e "\n${YELLOW}⚠️ Setup interrupted${NC}"; exit 1' INT TERM

# Run main function
main "$@"
