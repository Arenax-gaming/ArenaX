# Tournament System Migration Guide

## Overview
This migration adds comprehensive tournament management system supporting multiple formats (bracket, round-robin, swiss), registration management, and automated progression.

## Database Migration

Run the following command to apply the Prisma migration:

```bash
cd server
npx prisma migrate dev --name add_tournament_system
```

## New Models Added

- **Tournament**: Main tournament entity with format, status, and configuration
- **TournamentParticipant**: Players registered in a tournament
- **TournamentMatch**: Individual matches within a tournament
- **TournamentRegistration**: Registration records with waitlist support

## New Enums

- **TournamentFormat**: SINGLE_ELIMINATION, DOUBLE_ELIMINATION, ROUND_ROBIN, SWISS
- **TournamentStatus**: PENDING, REGISTRATION_OPEN, REGISTRATION_CLOSED, IN_PROGRESS, COMPLETED, CANCELLED
- **TournamentRound**: Various round names from QUALIFICATION to GRAND_FINAL
- **MatchResultType**: WIN, LOSS, DRAW, BYE, DISQUALIFIED

## API Endpoints

| Method | Path | Description | Auth Required |
|--------|------|-------------|---------------|
| POST | /api/v1/tournaments | Create new tournament | Yes |
| GET | /api/v1/tournaments | List tournaments | No |
| GET | /api/v1/tournaments/:id | Get tournament details | No |
| POST | /api/v1/tournaments/:id/register | Register for tournament | Yes |
| POST | /api/v1/tournaments/:id/check-in | Tournament check-in | Yes |
| GET | /api/v1/tournaments/:id/bracket | Get tournament bracket | No |
| POST | /api/v1/tournaments/:id/report-result | Report match result | Yes |
| GET | /api/v1/tournaments/:id/standings | Get tournament standings | No |

## Files Modified/Created

### Created:
- `src/controllers/tournament.controller.ts` - REST API handlers
- `src/routes/tournament.routes.ts` - Route definitions
- `src/jobs/tournament.job.ts` - Automated tournament progression

### Modified:
- `src/services/tournament.service.ts` - Complete tournament business logic
- `src/routes/index.ts` - Added tournament routes
- `prisma/schema.prisma` - Added tournament models

## Features Implemented

✅ Multiple tournament formats (single/double elimination, round-robin, swiss)
✅ Registration system with capacity limits and waitlists
✅ Automatic bracket generation algorithms
✅ Player check-in system
✅ Match result reporting and standings calculation
✅ Automated tournament progression
✅ Prize distribution system
✅ Tournament status management

## Next Steps

1. Run database migration
2. Test all endpoints
3. Set up cron job for tournament.job.ts maintenance tasks
4. Add WebSocket events for real-time updates (optional)
