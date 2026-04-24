import { TournamentStatus } from '@prisma/client';
import { TournamentService } from '../services/tournament.service';
import { logger } from '../services/logger.service';
import { getDatabaseClient } from '../services/database.service';

const tournamentService = new TournamentService();
const prisma = getDatabaseClient();

/**
 * Tournament Job Handler
 * Manages automated tournament progression and status updates
 */
export class TournamentJob {
  /**
   * Check and update tournament statuses based on time
   */
  async updateTournamentStatuses() {
    try {
      const now = new Date();

      // Open registration for tournaments that are ready
      const pendingTournaments = await prisma.tournament.findMany({
        where: {
          status: TournamentStatus.PENDING,
          registrationStart: { lte: now },
        },
      });

      for (const tournament of pendingTournaments) {
        await prisma.tournament.update({
          where: { id: tournament.id },
          data: { status: TournamentStatus.REGISTRATION_OPEN },
        });

        logger.info('Tournament registration opened', {
          tournamentId: tournament.id,
          name: tournament.name,
        });
      }

      // Close registration for tournaments past registration end
      const openTournaments = await prisma.tournament.findMany({
        where: {
          status: TournamentStatus.REGISTRATION_OPEN,
          registrationEnd: { lte: now },
        },
      });

      for (const tournament of openTournaments) {
        await prisma.tournament.update({
          where: { id: tournament.id },
          data: { status: TournamentStatus.REGISTRATION_CLOSED },
        });

        logger.info('Tournament registration closed', {
          tournamentId: tournament.id,
          name: tournament.name,
        });

        // Generate bracket if enough players
        await this.generateBracketIfReady(tournament.id);
      }

      // Start tournaments that have passed start date
      const closedTournaments = await prisma.tournament.findMany({
        where: {
          status: TournamentStatus.REGISTRATION_CLOSED,
          startDate: { lte: now },
        },
      });

      for (const tournament of closedTournaments) {
        await tournamentService.generateBracket(tournament.id);

        logger.info('Tournament started', {
          tournamentId: tournament.id,
          name: tournament.name,
        });
      }
    } catch (error) {
      logger.error('Failed to update tournament statuses', { error });
    }
  }

  /**
   * Generate bracket if tournament has enough checked-in players
   */
  private async generateBracketIfReady(tournamentId: string) {
    try {
      const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId },
        include: {
          participants: {
            where: { status: 'REGISTERED' },
          },
        },
      });

      if (!tournament) return;

      const participantCount = tournament.participants.length;

      if (participantCount >= tournament.minPlayers) {
        // Ready to generate bracket
        // This will be called when tournament starts
        logger.info('Tournament ready to start', {
          tournamentId,
          participantCount,
        });
      } else {
        // Not enough players, cancel tournament
        await prisma.tournament.update({
          where: { id: tournamentId },
          data: { status: TournamentStatus.CANCELLED },
        });

        logger.warn('Tournament cancelled - not enough players', {
          tournamentId,
          participantCount,
          minRequired: tournament.minPlayers,
        });
      }
    } catch (error) {
      logger.error('Failed to check bracket readiness', {
        error,
        tournamentId,
      });
    }
  }

  /**
   * Process check-in deadline and eliminate non-checked-in players
   */
  async processCheckInDeadline() {
    try {
      const now = new Date();

      // Find tournaments about to start (within check-in window)
      const upcomingTournaments = await prisma.tournament.findMany({
        where: {
          status: {
            in: [TournamentStatus.REGISTRATION_CLOSED, TournamentStatus.IN_PROGRESS],
          },
          startDate: {
            gte: now,
            lte: new Date(now.getTime() + 30 * 60 * 1000), // Next 30 minutes
          },
        },
      });

      for (const tournament of upcomingTournaments) {
        const checkInDeadline = new Date(
          tournament.startDate.getTime() - tournament.checkInWindow * 60000
        );

        if (now >= checkInDeadline) {
          // Eliminate players who haven't checked in
          await prisma.tournamentParticipant.updateMany({
            where: {
              tournamentId: tournament.id,
              checkedIn: false,
              status: 'REGISTERED',
            },
            data: {
              status: 'DISQUALIFIED',
            },
          });

          logger.info('Non-checked-in players disqualified', {
            tournamentId: tournament.id,
          });
        }
      }
    } catch (error) {
      logger.error('Failed to process check-in deadline', { error });
    }
  }

  /**
   * Clean up old completed tournaments
   */
  async cleanupOldTournaments(daysOld: number = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const oldTournaments = await prisma.tournament.findMany({
        where: {
          status: TournamentStatus.COMPLETED,
          endDate: { lte: cutoffDate },
        },
      });

      logger.info('Found old tournaments for cleanup', {
        count: oldTournaments.length,
        daysOld,
      });

      // Note: In production, you might want to archive instead of delete
      // or move to a separate archive table
    } catch (error) {
      logger.error('Failed to cleanup old tournaments', { error });
    }
  }

  /**
   * Run all tournament maintenance tasks
   */
  async runMaintenance() {
    logger.info('Starting tournament maintenance');

    await this.updateTournamentStatuses();
    await this.processCheckInDeadline();
    await this.cleanupOldTournaments();

    logger.info('Tournament maintenance completed');
  }
}

export default new TournamentJob();
