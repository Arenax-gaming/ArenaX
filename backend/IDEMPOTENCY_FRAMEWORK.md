# ArenaX Idempotency Framework

A comprehensive idempotency framework for ArenaX write APIs that prevents duplicate operations and ensures safe request retries.

## 🎯 Overview

The idempotency framework provides a standardized way to handle duplicate requests safely, preventing financial operations from being executed multiple times due to network retries, client bugs, or gateway issues.

## 🏗️ Architecture

### Core Components

1. **IdempotencyMiddleware** - Actix-web middleware that intercepts requests and handles idempotency logic
2. **IdempotencyService** - Service layer for idempotency key management and operations
3. **Database Models** - PostgreSQL schema for storing keys and cached responses
4. **Configuration System** - Per-route configuration for TTL, response size limits, etc.

### Key Features

- **SHA256 Request Hashing** - Ensures request integrity by hashing method, path, headers, and body
- **Response Caching** - Stores complete response (status, headers, body) for replay
- **Conflict Detection** - Rejects key reuse with different payloads deterministically
- **TTL Management** - Automatic cleanup of expired keys
- **Route-based Configuration** - Different settings per API endpoint
- **Performance Optimized** - Database indexes and efficient queries

## 🚀 Quick Start

### 1. Database Setup

```bash
# Run the idempotency migration
psql -d arenax -f idempotency_migration.sql
```

### 2. Basic Usage

```bash
# Generate an idempotency key
curl -X POST http://localhost:8080/api/idempotency/generate-key \
  -H "Content-Type: application/json" \
  -d '{"ttl_seconds": 3600}'

# Use the key in a request
curl -X POST http://localhost:8080/api/test/payment \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: idemp_abc123def456" \
  -d '{"amount": 100, "currency": "USD"}'

# Replay the same request (gets cached response)
curl -X POST http://localhost:8080/api/test/payment \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: idemp_abc123def456" \
  -d '{"amount": 100, "currency": "USD"}'
```

### 3. Conflict Detection

```bash
# Try to reuse the key with different payload (gets 409 Conflict)
curl -X POST http://localhost:8080/api/test/payment \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: idemp_abc123def456" \
  -d '{"amount": 200, "currency": "USD"}'
```

## 📋 API Reference

### Middleware Integration

The middleware automatically processes requests for configured routes:

```rust
// In main.rs
.wrap(IdempotencyMiddleware::default(db_pool.clone()))
```

### Required Headers

- **Idempotency-Key** - Unique key for the request (8-255 chars, alphanumeric + hyphens/underscores)

### Response Headers

- **X-Idempotency-Cached** - "true" if response is from cache
- **X-Idempotency-Timestamp** - When the original response was cached

### Management Endpoints

#### Generate Key
```http
POST /api/idempotency/generate-key?ttl_seconds=3600
```

#### Get Statistics
```http
GET /api/idempotency/stats
Authorization: Bearer <admin_token>
```

#### Get User Keys
```http
GET /api/idempotency/user-keys?limit=50&offset=0
Authorization: Bearer <user_token>
```

#### Invalidate Key
```http
DELETE /api/idempotency/invalidate/{key}
Authorization: Bearer <admin_token>
```

#### Cleanup Expired
```http
POST /api/idempotency/cleanup
Authorization: Bearer <admin_token>
```

## ⚙️ Configuration

### Default Policy

```rust
pub struct IdempotencyPolicy {
    pub enabled_routes: Vec<String>,
    pub default_ttl_seconds: i32,        // 86400 (24 hours)
    pub max_response_size_kb: i32,       // 1024 (1MB)
    pub key_header_name: String,         // "Idempotency-Key"
    pub conflict_status_code: i16,       // 409
}
```

### Per-Route Configuration

```sql
INSERT INTO idempotency_configs (
    route_pattern, enabled, ttl_seconds, max_response_size_kb
) VALUES 
('/api/payments/create', true, 86400, 1024),
('/api/matchmaking/join', true, 3600, 256);
```

### Environment Variables

```bash
# Optional: Override default TTL
IDEMPOTENCY_DEFAULT_TTL_SECONDS=86400

# Optional: Override max response size
IDEMPOTENCY_MAX_RESPONSE_SIZE_KB=1024
```

## 🔧 Implementation Details

### Request Hashing

The framework creates a SHA256 hash of:

1. HTTP Method (GET, POST, etc.)
2. Request Path
3. Query Parameters
4. All headers except Idempotency-Key
5. Request Body

This ensures that any change to the request results in a different hash.

### Conflict Detection

When a key is reused:

1. **Same Hash** → Returns cached response
2. **Different Hash** → Returns 409 Conflict with details

### Response Caching

Complete responses are cached including:

- HTTP Status Code
- Response Headers
- Response Body (JSON, up to size limit)
- Timestamp

### TTL Strategy

- **Financial Operations**: 24 hours
- **Matchmaking**: 1 hour
- **Tournament Operations**: 24 hours
- **Custom**: Per-route configuration

## 📊 Performance

### Benchmarks

- **Key Generation**: ~1000 ops/sec
- **Cache Lookup**: ~5000 ops/sec
- **Conflict Detection**: ~3000 ops/sec
- **Storage**: ~800 ops/sec

### Database Optimization

- Indexed on key, expires_at, created_at
- Composite indexes for common queries
- Partitioned views for analytics
- Automatic cleanup of expired keys

### Memory Usage

- **Cached Response**: ~1KB average
- **Key Metadata**: ~500 bytes
- **Total Overhead**: <2MB per 1000 active keys

## 🧪 Testing

### Unit Tests

```bash
# Run idempotency tests
cargo test idempotency

# Run specific test categories
cargo test idempotency::middleware
cargo test idempotency::service
cargo test idempotency::models
```

### Integration Tests

```bash
# Run API integration tests
cargo test idempotency_integration

# Test with real database
TEST_DATABASE_URL=postgresql://test:test@localhost/arenax_test \
cargo test idempotency_integration
```

### Performance Tests

```bash
# Run performance benchmarks
cargo test --release idempotency_performance

# Load testing
curl -X GET http://localhost:8080/api/test/performance?count=1000
```

## 🔍 Monitoring & Debugging

### Health Checks

```bash
# Check idempotency system health
curl http://localhost:8080/api/test/health
```

### Statistics

```bash
# Get usage statistics
curl http://localhost:8080/api/idempotency/stats
```

### Analytics Views

The database provides several views for monitoring:

- `active_idempotency_keys` - Current active keys
- `idempotency_usage_stats` - Hourly usage metrics
- `idempotency_conflicts` - Conflict detection
- `route_idempotency_stats` - Per-route statistics

### Logging

```rust
// Enable debug logging
RUST_LOG=debug cargo run

// Log levels
INFO: idempotency::middleware - Request processed
WARN: idempotency::middleware - Conflict detected
ERROR: idempotency::service - Database error
```

## 🛡️ Security Considerations

### Key Generation

- Keys are cryptographically random (UUID-based)
- No sequential patterns
- Sufficient entropy to prevent guessing

### Data Privacy

- Request bodies are hashed, not stored in plaintext
- Personal data in cached responses follows existing privacy policies
- Automatic expiration prevents data accumulation

### Rate Limiting

- Consider implementing rate limiting on key generation
- Monitor for abuse patterns
- Implement per-user key limits if needed

## 🔮 Future Enhancements

### Planned Features

1. **Distributed Caching** - Redis support for multi-instance deployments
2. **Machine Learning** - Predictive conflict detection
3. **Advanced Analytics** - Real-time dashboards
4. **Client SDKs** - Helper libraries for common languages
5. **Batch Operations** - Bulk key management

### Performance Improvements

1. **Memory Caching** - L1 cache for frequently accessed keys
2. **Connection Pooling** - Optimized database connections
3. **Async Processing** - Background key cleanup
4. **Compression** - Response body compression

## 📚 Examples

### Payment Processing

```rust
#[post("/payments/create")]
pub async fn create_payment(
    db_pool: web::Data<DbPool>,
    body: web::Json<CreatePaymentRequest>,
) -> Result<HttpResponse> {
    // This endpoint is automatically idempotent
    // due to middleware configuration
    
    let payment = process_payment(body.into_inner()).await?;
    
    Ok(HttpResponse::Created().json(payment))
}
```

### Custom Conflict Handling

```rust
// Override default conflict response
let custom_middleware = IdempotencyMiddleware::new(
    db_pool,
    IdempotencyPolicy {
        conflict_status_code: 422, // Unprocessable Entity
        ..Default::default()
    }
);
```

### Key Validation

```rust
use crate::service::idempotency_service::IdempotencyService;

let service = IdempotencyService::default(db_pool);
match service.validate_key_format("invalid key!") {
    Ok(()) => println!("Valid key"),
    Err(e) => println!("Invalid key: {}", e.message),
}
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.
