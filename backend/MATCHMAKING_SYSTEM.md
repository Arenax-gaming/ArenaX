# ArenaX Matchmaking System

A high-performance Redis-based matchmaking system with ELO rating calculation for the ArenaX gaming platform.

## 🎯 Overview

The matchmaking system provides intelligent player pairing based on skill level (ELO rating) and wait time, ensuring fair and balanced matches while minimizing queue times.

## 🏗️ Architecture

### Core Components

1. **MatchmakerService** - Core matchmaking logic and queue management
2. **EloEngine** - ELO rating calculation with K-Factor 32
3. **Redis Queue System** - High-performance player queue storage
4. **PostgreSQL Persistence** - Match history and ELO records
5. **Background Worker** - Continuous match processing

### Key Features

- **Dynamic ELO Range Expansion** - Widens search radius as wait time increases
- **Redis Sorted Sets** - Efficient queue management by ELO buckets
- **Real-time Processing** - Background worker processes matches every 5 seconds
- **Match Quality Scoring** - Balances ELO compatibility with wait time
- **Comprehensive Statistics** - Queue metrics and performance tracking

## 🚀 Quick Start

### Prerequisites

- Redis server running
- PostgreSQL database
- Rust 1.70+
- ArenaX backend dependencies

### Database Setup

```bash
# Run the matchmaking migration
psql -d arenax -f matchmaking_migration.sql
```

### Configuration

The matchmaking system uses environment variables for configuration:

```bash
# Redis connection
REDIS_URL=redis://localhost:6379

# Database connection  
DATABASE_URL=postgresql://user:pass@localhost/arenax

# Matchmaking settings (optional defaults provided)
MATCHMAKING_ELO_BUCKET_SIZE=100
MATCHMAKING_MAX_ELO_GAP=500
MATCHMAKING_MAX_WAIT_TIME=600
MATCHMAKING_INTERVAL_SECONDS=5
```

### Running the System

```bash
# Start the ArenaX backend (includes matchmaking worker)
cargo run

# Run tests
cargo test matchmaker

# Run matchmaking benchmarks
bash benchmark_matchmaking.sh
```

## 📊 API Endpoints

### Queue Management

#### Join Queue
```http
POST /api/matchmaking/join
Content-Type: application/json
Authorization: Bearer <jwt_token>

{
  "game": "chess",
  "game_mode": "ranked"
}
```

#### Leave Queue
```http
POST /api/matchmaking/leave
Content-Type: application/json
Authorization: Bearer <jwt_token>

{
  "game": "chess", 
  "game_mode": "ranked"
}
```

#### Queue Status
```http
GET /api/matchmaking/status/{game}/{game_mode}
Authorization: Bearer <jwt_token>
```

### Statistics & ELO

#### Matchmaking Stats
```http
GET /api/matchmaking/stats
Authorization: Bearer <jwt_token>
```

#### Player ELO Rating
```http
GET /api/matchmaking/elo/{game}
Authorization: Bearer <jwt_token>
```

#### ELO History
```http
GET /api/matchmaking/elo/{game}/{page}/{limit}
Authorization: Bearer <jwt_token>
```

## 🧮 ELO System

### ELO Calculation

The system uses a standard ELO rating algorithm with K-Factor 32:

```rust
// Expected score calculation
expected_score = 1.0 / (1.0 + 10^((opponent_elo - player_elo) / 400.0))

// New ELO rating
new_elo = old_elo + K_FACTOR * (actual_score - expected_score)
```

### ELO Ranges

- **Beginner**: 800-1200
- **Intermediate**: 1200-1600  
- **Advanced**: 1600-2000
- **Expert**: 2000-2400
- **Master**: 2400+

### Match Results Impact

| Result vs Higher ELO | Result vs Equal ELO | Result vs Lower ELO |
|----------------------|---------------------|---------------------|
| +25 ELO (win)        | +16 ELO (win)       | +8 ELO (win)         |
| -8 ELO (loss)        | -16 ELO (loss)      | -25 ELO (loss)       |
| ±0 ELO (draw)        | ±0 ELO (draw)       | ±0 ELO (draw)        |

## 🔄 Matchmaking Algorithm

### Queue Organization

Players are organized in Redis using these key patterns:

```
queue:{game}:{game_mode}:{elo_bucket}  # Sorted set by join time
queue_entry:{game}:{game_mode}:{user_id}  # Individual player data
```

### Dynamic Expansion Logic

The system expands ELO search range based on wait time:

```rust
wait_time < 30s:  ±100 ELO (initial)
wait_time < 60s:  ±200 ELO (2x expansion)
wait_time < 2m:   ±400 ELO (4x expansion)
wait_time < 5m:   ±500 ELO (max expansion)
```

### Match Quality Scoring

Match quality combines ELO compatibility and wait time:

```rust
match_quality = elo_compatibility + wait_time_bonus

elo_compatibility = 1.0 - (elo_gap / max_elo_gap)
wait_time_bonus = min(avg_wait_time / 600s, 0.5)
```

## 📈 Performance Characteristics

### Throughput

- **Queue Processing**: 5-second intervals
- **Concurrent Players**: 1000+ supported
- **Match Creation**: ~100 matches/second
- **Queue Operations**: <10ms latency

### Memory Usage

- **Redis Memory**: ~1KB per queued player
- **Database Load**: Minimal (async writes)
- **Background Worker**: ~50MB RAM

### Scaling

The system scales horizontally by:
- Redis clustering for queue storage
- Database read replicas for statistics
- Multiple matchmaker worker instances

## 🧪 Testing

### Unit Tests

```bash
# Run all matchmaking tests
cargo test matchmaker

# Run specific test categories
cargo test matchmaker::tests::test_elo_calculation
cargo test matchmaker::tests::test_queue_operations
cargo test matchmaker::tests::test_performance
```

### Integration Tests

```bash
# Run API integration tests
cargo test matchmaker::integration_tests

# Test with Redis and PostgreSQL
TEST_DATABASE_URL=postgresql://test:test@localhost/arenax_test \
TEST_REDIS_URL=redis://localhost \
cargo test matchmaker
```

### Benchmark Testing

```bash
# Run matchmaking benchmarks
bash benchmark_matchmaking.sh

# Custom benchmark scenarios
cargo test --release matchmaker::tests::test_matchmaking_performance
```

## 🔧 Configuration Options

### MatchmakingConfig

```rust
pub struct MatchmakingConfig {
    pub elo_bucket_size: i32,           // Default: 100
    pub max_elo_gap: i32,               // Default: 500  
    pub expansion_intervals: Vec<i64>,  // Default: [30, 60, 120, 300]
    pub max_wait_time: i64,             // Default: 600
    pub min_players_per_match: usize,   // Default: 2
    pub max_players_per_match: usize,   // Default: 2
}
```

### Game-Specific Settings

Different games can have custom configurations:

```rust
let chess_config = MatchmakingConfig {
    elo_bucket_size: 50,   // Tighter ELO ranges for chess
    max_elo_gap: 300,      // Smaller max gap
    ..Default::default()
};

let fps_config = MatchmakingConfig {
    elo_bucket_size: 150,  // Wider ranges for FPS games
    max_elo_gap: 600,      // Larger max gap
    ..Default::default()
};
```

## 📊 Monitoring & Analytics

### Key Metrics

- **Queue Size**: Players waiting per game/mode
- **Average Wait Time**: Time to find matches
- **Match Quality**: Average ELO gaps
- **ELO Distribution**: Player rating spread
- **Throughput**: Matches created per hour

### Health Checks

```bash
# Check matchmaking system health
curl http://localhost:8080/api/health

# Get current queue statistics
curl -H "Authorization: Bearer <token>" \
     http://localhost:8080/api/matchmaking/stats
```

### Logging

The system provides detailed logging:

```bash
# Matchmaker worker logs
INFO matchmaker: Created match 1234 between players 5678 and 9012 (ELO gap: 45, quality: 0.87)

# Queue operation logs  
DEBUG matchmaker: Player 5678 joined queue for chess:ranked (ELO: 1250)
INFO matchmaker: Queue size for chess:ranked is now 15 players
```

## 🛠️ Troubleshooting

### Common Issues

#### High Wait Times
- Check queue size: `GET /api/matchmaking/stats`
- Verify ELO distribution is balanced
- Consider expanding ELO ranges temporarily

#### No Matches Created
- Ensure background worker is running
- Check Redis connection status
- Verify minimum player requirements

#### Redis Performance Issues
- Monitor Redis memory usage
- Check for expired keys
- Consider Redis clustering for scale

### Debug Commands

```bash
# Check Redis queue size
redis-cli KEYS "queue:*" | wc -l

# Monitor matchmaker logs
tail -f /var/log/arenax/matchmaker.log

# Database query performance
EXPLAIN ANALYZE SELECT * FROM matchmaking_queue WHERE status = 'waiting';
```

## 🔮 Future Enhancements

### Planned Features

1. **Team Matchmaking** - Support for 2v2, 3v3, etc.
2. **Skill-Based Decay** - ELO rating adjustment for inactivity
3. **Geographic Matching** - Region-based player pairing
4. **Preference System** - Player preferences and avoid lists
5. **Tournament Integration** - Seamless tournament matchmaking

### Performance Improvements

1. **Machine Learning** - Predictive match quality scoring
2. **Load Balancing** - Dynamic worker scaling
3. **Caching** - Redis cluster with intelligent caching
4. **Batch Processing** - Optimized bulk operations

## 📚 References

- [ELO Rating System](https://en.wikipedia.org/wiki/Elo_rating_system)
- [Redis Data Structures](https://redis.io/topics/data-types)
- [Actix-Web Framework](https://actix.rs/)
- [SQLx Async Database](https://github.com/launchbadge/sqlx)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.
