# ArenaX Database Schema Documentation

## Overview

This document describes the PostgreSQL database schema for the ArenaX gaming platform, implemented using Prisma ORM.

## Core Data Models

### User Management

#### User
- **Purpose**: Core user account and authentication
- **Key Fields**: email, username, passwordHash, role, walletAddress
- **Relations**: Achievements, Game Sessions, Tournaments, Leaderboards

### Gaming System

#### GameMode
- **Purpose**: Configuration for different game types
- **Types**: 1v1, 2v2, 3v3, 5v5, Free For All, Tournament
- **Fields**: rules, settings, maxPlayers, minPlayers
- **Indexes**: isActive

#### GameSession
- **Purpose**: Individual match/game session data
- **Status**: WAITING, IN_PROGRESS, COMPLETED, ABANDONED, DISPUTED
- **Fields**: gameModeId, status, duration, gameData
- **Indexes**: status, gameModeId, createdAt, startedAt
- **Relations**: Participants, Match History

#### GameSessionParticipant
- **Purpose**: Player participation in game sessions
- **Fields**: userId, team, score, kills, deaths, assists, position
- **Unique Constraint**: (gameSessionId, userId)
- **Indexes**: gameSessionId, userId

#### MatchHistory
- **Purpose**: Detailed historical record of completed matches
- **Fields**: playerAId, playerBId, winnerId, scoreA, scoreB, duration
- **Indexes**: gameSessionId, playerAId, playerBId, winnerId, createdAt
- **Special**: replayData for match analysis

### Tournament System

#### Tournament
- **Purpose**: Tournament event management
- **Status**: DRAFT, REGISTRATION, IN_PROGRESS, COMPLETED, CANCELLED, POSTPONED
- **Format**: SINGLE_ELIMINATION, DOUBLE_ELIMINATION, ROUND_ROBIN, SWISS, GROUP_STAGE
- **Fields**: gameModeId, entryFee, prizePool, currency, startsAt, endsAt
- **Indexes**: status, gameModeId, startsAt, createdBy
- **Relations**: Participants, Brackets

#### TournamentParticipant
- **Purpose**: User registration in tournaments
- **Fields**: tournamentId, userId, seed, eliminatedAt
- **Unique Constraint**: (tournamentId, userId)
- **Indexes**: tournamentId, userId

#### TournamentBracket
- **Purpose**: Tournament bracket structure and match assignments
- **Fields**: tournamentId, round, matchId, playerAId, playerBId, winnerId
- **Indexes**: tournamentId, round, matchId

### Leaderboard System

#### Leaderboard
- **Purpose**: Ranking system configuration
- **Types**: GLOBAL, GAME_MODE, TOURNAMENT, SEASONAL
- **Fields**: gameModeId, tournamentId, season, startDate, endDate
- **Indexes**: type, isActive, season
- **Relations**: Entries

#### LeaderboardEntry
- **Purpose**: Individual player rankings
- **Fields**: leaderboardId, userId, rank, score, wins, losses, draws, winRate
- **Unique Constraint**: (leaderboardId, userId)
- **Indexes**: leaderboardId, userId, rank

### Achievement System

#### Achievement
- **Purpose**: Unlockable achievements and rewards
- **Categories**: COMBAT, SOCIAL, PROGRESSION, SEASONAL
- **Fields**: key, name, description, targetValue, rewards
- **Indexes**: category
- **Relations**: Player Progress, Shares, Notifications

#### PlayerAchievement
- **Purpose**: User achievement progress tracking
- **Fields**: userId, achievementId, progress, unlockedAt, rewardClaimedAt
- **Unique Constraint**: (userId, achievementId)
- **Indexes**: userId, achievementId

## Database Optimization

### Indexes

All frequently queried fields are indexed for performance:
- Foreign keys (userId, gameModeId, tournamentId, etc.)
- Status fields (status, isActive)
- Date fields (createdAt, startedAt, endsAt)
- Unique constraints for data integrity

### Connection Pooling

Configuration via environment variables:
- `DATABASE_POOL_MIN`: Minimum connections (default: 2)
- `DATABASE_POOL_MAX`: Maximum connections (default: 10)
- `DATABASE_POOL_TIMEOUT`: Connection timeout in seconds (default: 30)
- `DATABASE_IDLE_TIMEOUT`: Idle connection timeout in seconds (default: 600)

### Cascade Rules

- **Cascade**: Child records deleted when parent is deleted
- **SetNull**: Foreign key set to null when parent is deleted
- **Restrict**: Prevents deletion if child records exist

## Audit Trail

All models include:
- `createdAt`: Record creation timestamp
- `updatedAt`: Last update timestamp (auto-updated by Prisma)

## Data Types

### Decimal Precision
- Financial fields use `Decimal(20, 7)` for high precision
- Win rates use `Decimal(5, 2)` for percentage storage

### JSON Fields
Flexible storage for:
- Game rules and settings
- Metadata and configuration
- Replay data
- Analytics data

## Migration Commands

```bash
# Generate Prisma client
npm run prisma:generate

# Create and apply migration (development)
npm run prisma:migrate

# Apply migrations (production)
npm run prisma:migrate:deploy

# Seed database with test data
npm run prisma:seed

# Open Prisma Studio (GUI)
npm run prisma:studio
```

## Best Practices

1. **Always use transactions** for multi-record operations
2. **Use indexes** for frequently queried fields
3. **Validate data** before database operations
4. **Handle cascade deletes** carefully
5. **Monitor connection pool** usage in production
6. **Use JSON fields** sparingly - prefer structured data when possible
7. **Keep soft deletes** for audit trails when needed
8. **Regular backups** of production database

## Performance Considerations

- **Read-heavy workload**: Optimized with appropriate indexes
- **Connection pooling**: Configurable based on load
- **Query optimization**: Use `select` and `include` to limit returned data
- **Batch operations**: Use `createMany`, `updateMany` for bulk operations
- **Caching**: Consider Redis for frequently accessed data
