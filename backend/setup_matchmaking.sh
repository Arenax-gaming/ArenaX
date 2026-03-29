#!/bin/bash

# ArenaX Matchmaking System Setup Script
# Sets up Redis, PostgreSQL, and the matchmaking system

set -e

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REDIS_VERSION="7.0"
POSTGRES_VERSION="15"
REDIS_PORT="6379"
POSTGRES_PORT="5432"
DB_NAME="arenax"
DB_USER="arenax"
DB_PASSWORD="arenax123"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🎮 ArenaX Matchmaking System Setup${NC}"
echo "======================================"
echo "Project Root: $PROJECT_ROOT"
echo "Redis Version: $REDIS_VERSION"
echo "PostgreSQL Version: $POSTGRES_VERSION"
echo ""

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if service is running
is_service_running() {
    if [ "$1" = "redis" ]; then
        redis-cli ping >/dev/null 2>&1
    elif [ "$1" = "postgres" ]; then
        pg_isready -h localhost -p $POSTGRES_PORT >/dev/null 2>&1
    fi
}

# Function to install Redis
install_redis() {
    echo -e "${YELLOW}📦 Installing Redis...${NC}"
    
    if command_exists redis-server; then
        echo -e "${GREEN}✅ Redis is already installed${NC}"
        return 0
    fi
    
    # Detect OS
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        if command_exists apt-get; then
            # Ubuntu/Debian
            sudo apt-get update
            sudo apt-get install -y redis-server
        elif command_exists yum; then
            # CentOS/RHEL
            sudo yum install -y epel-release
            sudo yum install -y redis
        else
            echo -e "${RED}❌ Unsupported Linux distribution${NC}"
            exit 1
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command_exists brew; then
            brew install redis
        else
            echo -e "${RED}❌ Homebrew is required for macOS installation${NC}"
            exit 1
        fi
    else
        echo -e "${RED}❌ Unsupported operating system${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Redis installed successfully${NC}"
}

# Function to install PostgreSQL
install_postgresql() {
    echo -e "${YELLOW}📦 Installing PostgreSQL...${NC}"
    
    if command_exists psql; then
        echo -e "${GREEN}✅ PostgreSQL is already installed${NC}"
        return 0
    fi
    
    # Detect OS
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        if command_exists apt-get; then
            # Ubuntu/Debian
            sudo apt-get update
            sudo apt-get install -y postgresql postgresql-contrib
        elif command_exists yum; then
            # CentOS/RHEL
            sudo yum install -y postgresql-server postgresql-contrib
            sudo postgresql-setup initdb
        else
            echo -e "${RED}❌ Unsupported Linux distribution${NC}"
            exit 1
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command_exists brew; then
            brew install postgresql
        else
            echo -e "${RED}❌ Homebrew is required for macOS installation${NC}"
            exit 1
        fi
    else
        echo -e "${RED}❌ Unsupported operating system${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ PostgreSQL installed successfully${NC}"
}

# Function to start Redis
start_redis() {
    echo -e "${YELLOW}🚀 Starting Redis...${NC}"
    
    if is_service_running redis; then
        echo -e "${GREEN}✅ Redis is already running${NC}"
        return 0
    fi
    
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo systemctl start redis-server
        sudo systemctl enable redis-server
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        brew services start redis
    else
        redis-server --daemonize yes --port $REDIS_PORT
    fi
    
    # Wait for Redis to start
    local max_attempts=10
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if is_service_running redis; then
            echo -e "${GREEN}✅ Redis started successfully${NC}"
            return 0
        fi
        
        echo -e "${YELLOW}⏳ Waiting for Redis to start... (attempt $attempt/$max_attempts)${NC}"
        sleep 2
        ((attempt++))
    done
    
    echo -e "${RED}❌ Failed to start Redis${NC}"
    exit 1
}

# Function to start PostgreSQL
start_postgresql() {
    echo -e "${YELLOW}🚀 Starting PostgreSQL...${NC}"
    
    if is_service_running postgres; then
        echo -e "${GREEN}✅ PostgreSQL is already running${NC}"
        return 0
    fi
    
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo systemctl start postgresql
        sudo systemctl enable postgresql
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        brew services start postgresql
    else
        pg_ctl -D /usr/local/var/postgres start
    fi
    
    # Wait for PostgreSQL to start
    local max_attempts=10
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if is_service_running postgres; then
            echo -e "${GREEN}✅ PostgreSQL started successfully${NC}"
            return 0
        fi
        
        echo -e "${YELLOW}⏳ Waiting for PostgreSQL to start... (attempt $attempt/$max_attempts)${NC}"
        sleep 2
        ((attempt++))
    done
    
    echo -e "${RED}❌ Failed to start PostgreSQL${NC}"
    exit 1
}

# Function to setup database
setup_database() {
    echo -e "${YELLOW}🗄️ Setting up database...${NC}"
    
    # Create database and user
    sudo -u postgres psql -c "DROP DATABASE IF EXISTS $DB_NAME;" || true
    sudo -u postgres psql -c "CREATE DATABASE $DB_NAME;"
    sudo -u postgres psql -c "DROP USER IF EXISTS $DB_USER;" || true
    sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';"
    sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
    sudo -u postgres psql -c "ALTER USER $DB_USER CREATEDB;"
    
    echo -e "${GREEN}✅ Database created successfully${NC}"
}

# Function to run database migrations
run_migrations() {
    echo -e "${YELLOW}🔄 Running database migrations...${NC}"
    
    # Run matchmaking migration
    if [ -f "$PROJECT_ROOT/matchmaking_migration.sql" ]; then
        PGPASSWORD=$DB_PASSWORD psql -h localhost -p $POSTGRES_PORT -U $DB_USER -d $DB_NAME -f "$PROJECT_ROOT/matchmaking_migration.sql"
        echo -e "${GREEN}✅ Matchmaking migration completed${NC}"
    else
        echo -e "${YELLOW}⚠️ Matchmaking migration file not found${NC}"
    fi
}

# Function to install Rust dependencies
install_rust_deps() {
    echo -e "${YELLOW}🦀 Installing Rust dependencies...${NC}"
    
    if ! command_exists cargo; then
        echo -e "${RED}❌ Rust/Cargo is not installed${NC}"
        echo "Please install Rust from https://rustup.rs/"
        exit 1
    fi
    
    cd "$PROJECT_ROOT"
    
    # Install dependencies
    cargo build --release
    
    echo -e "${GREEN}✅ Rust dependencies installed${NC}"
}

# Function to setup environment
setup_environment() {
    echo -e "${YELLOW}⚙️ Setting up environment...${NC}"
    
    # Create .env file if it doesn't exist
    if [ ! -f "$PROJECT_ROOT/.env" ]; then
        cat > "$PROJECT_ROOT/.env" << EOF
# Database Configuration
DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@localhost:$POSTGRES_PORT/$DB_NAME

# Redis Configuration
REDIS_URL=redis://localhost:$REDIS_PORT

# Server Configuration
SERVER_HOST=127.0.0.1
SERVER_PORT=8080

# Matchmaking Configuration
MATCHMAKING_ELO_BUCKET_SIZE=100
MATCHMAKING_MAX_ELO_GAP=500
MATCHMAKING_MAX_WAIT_TIME=600
MATCHMAKING_INTERVAL_SECONDS=5

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Logging
RUST_LOG=info
EOF
        echo -e "${GREEN}✅ Environment file created${NC}"
    else
        echo -e "${YELLOW}⚠️ Environment file already exists${NC}"
    fi
}

# Function to verify setup
verify_setup() {
    echo -e "${YELLOW}🔍 Verifying setup...${NC}"
    
    # Check Redis
    if is_service_running redis; then
        echo -e "${GREEN}✅ Redis is running${NC}"
    else
        echo -e "${RED}❌ Redis is not running${NC}"
        return 1
    fi
    
    # Check PostgreSQL
    if is_service_running postgres; then
        echo -e "${GREEN}✅ PostgreSQL is running${NC}"
    else
        echo -e "${RED}❌ PostgreSQL is not running${NC}"
        return 1
    fi
    
    # Check database connection
    if PGPASSWORD=$DB_PASSWORD psql -h localhost -p $POSTGRES_PORT -U $DB_USER -d $DB_NAME -c "SELECT 1;" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Database connection successful${NC}"
    else
        echo -e "${RED}❌ Database connection failed${NC}"
        return 1
    fi
    
    # Check matchmaking tables
    if PGPASSWORD=$DB_PASSWORD psql -h localhost -p $POSTGRES_PORT -U $DB_USER -d $DB_NAME -c "SELECT COUNT(*) FROM matchmaking_queue;" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Matchmaking tables exist${NC}"
    else
        echo -e "${RED}❌ Matchmaking tables not found${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✅ Setup verification completed${NC}"
}

# Function to show next steps
show_next_steps() {
    echo ""
    echo -e "${BLUE}🎉 Setup completed successfully!${NC}"
    echo ""
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "1. Start the ArenaX backend:"
    echo "   cd $PROJECT_ROOT"
    echo "   cargo run"
    echo ""
    echo "2. Run the matchmaking benchmark:"
    echo "   bash benchmark_matchmaking.sh"
    echo ""
    echo "3. Test the API endpoints:"
    echo "   curl http://localhost:8080/api/health"
    echo ""
    echo "4. View the documentation:"
    echo "   cat $PROJECT_ROOT/MATCHMAKING_SYSTEM.md"
    echo ""
    echo -e "${GREEN}🚀 Your matchmaking system is ready!${NC}"
}

# Function to show help
show_help() {
    echo "ArenaX Matchmaking System Setup"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help     Show this help message"
    echo "  --redis-only   Install and start Redis only"
    echo "  --postgres-only Install and start PostgreSQL only"
    echo "  --no-services  Skip service installation (assume they're already installed)"
    echo "  --dev          Development setup (skip production optimizations)"
    echo ""
    echo "Examples:"
    echo "  $0                    # Full setup"
    echo "  $0 --dev              # Development setup"
    echo "  $0 --redis-only       # Redis only"
    echo ""
}

# Parse command line arguments
REDIS_ONLY=false
POSTGRES_ONLY=false
NO_SERVICES=false
DEV_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        --redis-only)
            REDIS_ONLY=true
            shift
            ;;
        --postgres-only)
            POSTGRES_ONLY=true
            shift
            ;;
        --no-services)
            NO_SERVICES=true
            shift
            ;;
        --dev)
            DEV_MODE=true
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
    echo "Starting ArenaX Matchmaking System setup..."
    echo ""
    
    # Install services
    if [ "$NO_SERVICES" = false ]; then
        if [ "$POSTGRES_ONLY" = false ]; then
            install_redis
        fi
        
        if [ "$REDIS_ONLY" = false ]; then
            install_postgresql
        fi
    fi
    
    # Start services
    if [ "$POSTGRES_ONLY" = false ]; then
        start_redis
    fi
    
    if [ "$REDIS_ONLY" = false ]; then
        start_postgresql
        setup_database
        run_migrations
    fi
    
    # Install application dependencies
    if [ "$REDIS_ONLY" = false ] && [ "$POSTGRES_ONLY" = false ]; then
        install_rust_deps
        setup_environment
        verify_setup
        show_next_steps
    fi
}

# Handle script interruption
trap 'echo -e "\n${YELLOW}⚠️ Setup interrupted${NC}"; exit 1' INT TERM

# Run main function
main "$@"
