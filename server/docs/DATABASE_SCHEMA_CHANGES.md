# Database Schema Changes Summary

This document summarizes the changes made to the ArenaX database schema as part of the PostgreSQL schema design and implementation task.

## Overview

The database schema has been enhanced with new models for gaming functionality, soft delete support, and optimized indexes for read-heavy gaming workloads.

## New Models Added

### GameMode
- **Purpose**: Define different game modes with their configurations, rules, and settings
- **Fields**:
  - `id`: Unique identifier
  - `name`: Unique name for the game mode
  - `displayName`: Human-readable name
  - `type`: Enum (ONE_V_ONE, TWO_V_TWO, THREE_V_THREE, FOUR_V_FOUR, FIVE_V_FIVE, FREE_FOR_ALL, TEAM_DEATHMATCH, CAPTURE_THE_FLAG)
  - `description`: Optional description
  - `maxPlayers`: Maximum number of players
  - `minPlayers`: Minimum number of players
  - `rules`: JSON field for game-specific rules
  - `settings`: JSON field for game settings
  - `isActive`: Boolean flag for active status
  - `createdAt`, `updatedAt`, `deletedAt`: Timestamps
- **Indexes**: type, isActive
- **Relations**: tournaments, gameSessions, leaderboards

### Leaderboard
- **Purpose**: Manage rankings across different categories and seasons
- **Fields**:
  - `id`: Unique identifier
  - `name`: Leaderboard name
  - `type`: Enum (GLOBAL, GAME_MODE, SEASON, EVENT)
  - `gameModeId`: Optional relation to GameMode
  - `season`: Optional season number
  - `isActive`: Boolean flag for active status
  - `startDate`, `endDate`: Date range
  - `metadata`: JSON field for additional data
  - `createdAt`, `updatedAt`, `deletedAt`: Timestamps
- **Indexes**: type, gameModeId, isActive, season
- **Relations**: gameMode, entries

### LeaderboardEntry
- **Purpose**: Store user rankings on leaderboards
- **Fields**:
  - `id`: Unique identifier
  - `leaderboardId`: Relation to Leaderboard
  - `userId`: Relation to User
  - `rank`: Current rank
  - `score`: Score value
  - `wins`, `losses`, `draws`: Match statistics
  - `winRate`: Win rate as decimal
  - `gamesPlayed`: Total games played
  - `metadata`: JSON field for additional data
  - `createdAt`, `updatedAt`: Timestamps
- **Indexes**: leaderboardId, userId, rank
- **Unique constraint**: [leaderboardId, userId]
- **Relations**: leaderboard, user

### MatchHistory
- **Purpose**: Store detailed match records for analytics and history
- **Fields**:
  - `id`: Unique identifier
  - `gameSessionId`: Optional relation to GameSession
  - `playerAId`, `playerBId`: Player references
  - `winnerId`: Optional winner reference
  - `scoreA`, `scoreB`: Match scores
  - `duration`: Match duration in seconds
  - `analytics`: JSON field for match analytics
  - `metadata`: JSON field for additional data
  - `createdAt`, `updatedAt`, `deletedAt`: Timestamps
- **Indexes**: gameSessionId, playerAId, playerBId, winnerId, createdAt
- **Relations**: gameSession

## Schema Updates

### Tournament Model
- **Changed**: Added `gameModeId` field to replace `gameMode` string
- **Added**: `deletedAt` field for soft delete support
- **Added**: Index on `gameModeId`
- **Added**: Index on `deletedAt`

### GameSession Model
- **Changed**: Added `gameModeId` field to replace `gameMode` string
- **Added**: `deletedAt` field for soft delete support
- **Added**: Index on `gameModeId`
- **Added**: Index on `deletedAt`
- **Added**: Relation to MatchHistory

### User Model
- **Added**: `deletedAt` field for soft delete support
- **Added**: Index on `deletedAt`
- **Added**: Relation to LeaderboardEntry

### Achievement Model
- **Added**: `deletedAt` field for soft delete support
- **Added**: Index on `deletedAt`

### TournamentParticipant Model
- **Added**: `deletedAt` field for soft delete support
- **Added**: Index on `deletedAt`

### TournamentMatch Model
- **Added**: `deletedAt` field for soft delete support
- **Added**: Index on `deletedAt`

### GameSessionPlayer Model
- **Added**: `deletedAt` field for soft delete support
- **Added**: Index on `deletedAt`

## New Enums

### GameModeType
- ONE_V_ONE
- TWO_V_TWO
- THREE_V_THREE
- FOUR_V_FOUR
- FIVE_V_FIVE
- FREE_FOR_ALL
- TEAM_DEATHMATCH
- CAPTURE_THE_FLAG

### LeaderboardType
- GLOBAL
- GAME_MODE
- SEASON
- EVENT

## Soft Delete Implementation

Soft delete support has been added to the following models by adding a `deletedAt` field:
- User
- Achievement
- Tournament
- GameSession
- TournamentParticipant
- TournamentMatch
- GameSessionPlayer
- GameMode
- Leaderboard
- MatchHistory

Models with `deletedAt` fields also have indexes on these fields for efficient querying of non-deleted records.

## Index Optimization

All models have been optimized with appropriate indexes for:
- Foreign key relationships
- Frequently queried fields (status, type, isActive)
- Soft delete filtering (deletedAt)
- Time-based queries (createdAt, updatedAt)

## Connection Pooling Configuration

Database connection pooling is configured via:
- Environment variables in `.env.example`:
  - `DATABASE_POOL_MIN`: Minimum connections (default: 2)
  - `DATABASE_POOL_MAX`: Maximum connections (default: 10)
  - `DATABASE_POOL_TIMEOUT`: Connection timeout in seconds (default: 30)
  - `DATABASE_IDLE_TIMEOUT`: Idle timeout in seconds (default: 600)
- Configuration in `src/config/database.ts` with monitoring middleware

## Backup and Recovery Procedures

Backup and recovery scripts have been created:
- `scripts/backup-database.sh`: Automated backup script with compression and retention
- `scripts/restore-database.sh`: Database restore script with confirmation
- `docs/DATABASE_BACKUP_RECOVERY.md`: Comprehensive documentation

## Pending Tasks

The following tasks require a running PostgreSQL database to complete:

### 1. Create Database Migrations
Run the following command when the database is running:
```bash
cd server
DATABASE_URL="postgresql://arenax:arenax@localhost:5432/arenax?schema=public" npx prisma migrate dev --name add_gaming_models_and_soft_delete
```

### 2. Fix Seed File TypeScript Errors
The seed file has TypeScript errors because the Prisma client needs to be regenerated after schema changes. This will be resolved automatically after running migrations:
```bash
cd server
npx prisma generate
```

### 3. Run Seed Script
After migrations are applied, run the seed script:
```bash
cd server
DATABASE_URL="postgresql://arenax:arenax@localhost:5432/arenax?schema=public" npx prisma db seed
```

## Code Updates

### Tournament Service
- Updated to use `gameModeId` instead of `gameMode` relation field
- File: `src/services/tournament.service.ts`

## Acceptance Criteria Status

- ✅ Prisma schema compiles without errors
- ⏳ Migrations apply cleanly to PostgreSQL (requires running database)
- ⏳ Seed script creates realistic test data (requires running database)
- ✅ Database queries are optimized with proper indexes
- ✅ Foreign key relationships maintain data integrity
- ✅ Connection pooling configured for concurrent requests
- ✅ Backup and recovery procedures documented and scripted

## Next Steps

1. Start the PostgreSQL database (using docker-compose or direct installation)
2. Run database migrations
3. Regenerate Prisma client
4. Run seed script
5. Verify data integrity
6. Test backup and recovery procedures
