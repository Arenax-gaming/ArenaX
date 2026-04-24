import { PrismaClient, TournamentFormat, TournamentStatus, TournamentRound } from '@prisma/client';
import { logger } from './logger.service';

const prisma = new PrismaClient();

export interface TournamentConfig {
  name: string;
  description?: string;
  format: TournamentFormat;
  gameId: string;
  gameMode: string;
  maxPlayers: number;
  minPlayers?: number;
  entryFee?: number;
  prizePool?: number;
  prizeDistribution?: Record<string, number>;
  registrationStart: Date;
  registrationEnd: Date;
  startDate: Date;
  endDate?: Date;
  checkInWindow?: number;
  settings?: Record<string, any>;
}

export interface MatchResult {
  matchId: string;
  playerAScore: number;
  playerBScore: number;
  winnerId: string;
  resultType: 'WIN' | 'LOSS' | 'DRAW' | 'DISQUALIFIED';
}

export class TournamentService {
  /**
   * Create a new tournament with configuration
   */
  async createTournament(organizerId: string, config: TournamentConfig) {
    try {
      // Validate dates
      if (config.registrationStart >= config.registrationEnd) {
        throw new Error('Registration start must be before registration end');
      }
      if (config.registrationEnd >= config.startDate) {
        throw new Error('Registration must end before tournament starts');
      }

      // Calculate total rounds based on format and max players
      const totalRounds = this.calculateTotalRounds(config.format, config.maxPlayers);

      // Create tournament
      const tournament = await prisma.tournament.create({
        data: {
          name: config.name,
          description: config.description,
          format: config.format,
          gameId: config.gameId,
          gameMode: config.gameMode,
          maxPlayers: config.maxPlayers,
          minPlayers: config.minPlayers || 2,
          entryFee: config.entryFee ? config.entryFee : null,
          prizePool: config.prizePool || 0,
          prizeDistribution: config.prizeDistribution || {},
          registrationStart: config.registrationStart,
          registrationEnd: config.registrationEnd,
          startDate: config.startDate,
          endDate: config.endDate || null,
          checkInWindow: config.checkInWindow || 15,
          organizerId,
          totalRounds,
          settings: config.settings || {},
          status: TournamentStatus.PENDING,
        },
        include: {
          organizer: {
            select: {
              id: true,
              username: true,
              email: true,
            },
          },
        },
      });

      logger.info('Tournament created', {
        tournamentId: tournament.id,
        organizerId,
        format: tournament.format,
        maxPlayers: tournament.maxPlayers,
      });

      return tournament;
    } catch (error) {
      logger.error('Failed to create tournament', { error, organizerId, config });
      throw error;
    }
  }

  /**
   * Register a player for a tournament
   */
  async registerPlayer(tournamentId: string, playerId: string) {
    try {
      // Get tournament
      const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId },
        include: {
          participants: true,
          registrations: {
            where: { userId: playerId },
          },
        },
      });

      if (!tournament) {
        throw new Error('Tournament not found');
      }

      // Check if registration is open
      const now = new Date();
      if (now < tournament.registrationStart) {
        throw new Error('Registration has not started yet');
      }
      if (now > tournament.registrationEnd) {
        throw new Error('Registration is closed');
      }

      // Check if already registered
      if (tournament.registrations.length > 0) {
        throw new Error('Already registered for this tournament');
      }

      // Check capacity
      const participantCount = tournament.participants.filter(
        (p) => p.status !== 'DISQUALIFIED'
      ).length;

      const isFull = participantCount >= tournament.maxPlayers;

      // Create registration
      const registration = await prisma.tournamentRegistration.create({
        data: {
          tournamentId,
          userId: playerId,
          status: isFull ? 'WAITLIST' : 'CONFIRMED',
          waitlistPosition: isFull
            ? (await this.getNextWaitlistPosition(tournamentId))
            : null,
          paymentStatus: tournament.entryFee ? 'PENDING' : 'PAID',
        },
      });

      // If not full and no entry fee, create participant directly
      if (!isFull && !tournament.entryFee) {
        await this.createParticipant(tournamentId, playerId, registration.id);
      }

      logger.info('Player registered for tournament', {
        tournamentId,
        playerId,
        status: registration.status,
        isWaitlist: isFull,
      });

      return registration;
    } catch (error) {
      logger.error('Failed to register player', { error, tournamentId, playerId });
      throw error;
    }
  }

  /**
   * Player check-in for tournament
   */
  async checkInPlayer(tournamentId: string, playerId: string) {
    try {
      const participant = await prisma.tournamentParticipant.findFirst({
        where: {
          tournamentId,
          userId: playerId,
        },
      });

      if (!participant) {
        throw new Error('Participant not found');
      }

      const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId },
      });

      if (!tournament) {
        throw new Error('Tournament not found');
      }

      // Check if within check-in window
      const now = new Date();
      const checkInDeadline = new Date(tournament.startDate.getTime() - tournament.checkInWindow * 60000);
      
      if (now > tournament.startDate) {
        throw new Error('Tournament has already started');
      }

      // Update check-in status
      const updated = await prisma.tournamentParticipant.update({
        where: { id: participant.id },
        data: {
          checkedIn: true,
          checkedInAt: now,
          status: 'CHECKED_IN',
        },
      });

      logger.info('Player checked in', {
        tournamentId,
        playerId,
        checkedInAt: updated.checkedInAt,
      });

      return updated;
    } catch (error) {
      logger.error('Failed to check in player', { error, tournamentId, playerId });
      throw error;
    }
  }

  /**
   * Generate tournament bracket based on format
   */
  async generateBracket(tournamentId: string) {
    try {
      const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId },
        include: {
          participants: {
            where: { status: 'CHECKED_IN' },
            orderBy: { seed: 'asc' },
          },
        },
      });

      if (!tournament) {
        throw new Error('Tournament not found');
      }

      if (tournament.status !== TournamentStatus.REGISTRATION_CLOSED) {
        throw new Error('Tournament must be in REGISTRATION_CLOSED status');
      }

      const checkedInCount = tournament.participants.length;
      if (checkedInCount < tournament.minPlayers) {
        throw new Error('Not enough players to start tournament');
      }

      // Generate bracket based on format
      let matches: any[] = [];
      switch (tournament.format) {
        case TournamentFormat.SINGLE_ELIMINATION:
          matches = await this.generateSingleEliminationBracket(tournament);
          break;
        case TournamentFormat.DOUBLE_ELIMINATION:
          matches = await this.generateDoubleEliminationBracket(tournament);
          break;
        case TournamentFormat.ROUND_ROBIN:
          matches = await this.generateRoundRobinBracket(tournament);
          break;
        case TournamentFormat.SWISS:
          matches = await this.generateSwissBracket(tournament);
          break;
        default:
          throw new Error('Unsupported tournament format');
      }

      // Update tournament status
      await prisma.tournament.update({
        where: { id: tournamentId },
        data: {
          status: TournamentStatus.IN_PROGRESS,
          currentRound: 1,
        },
      });

      logger.info('Tournament bracket generated', {
        tournamentId,
        format: tournament.format,
        matchCount: matches.length,
        participantCount: checkedInCount,
      });

      return matches;
    } catch (error) {
      logger.error('Failed to generate bracket', { error, tournamentId });
      throw error;
    }
  }

  /**
   * Handle match result and update tournament progress
   */
  async handleMatchResult(tournamentId: string, matchId: string, result: MatchResult) {
    try {
      const match = await prisma.tournamentMatch.findUnique({
        where: { id: matchId },
        include: {
          tournament: true,
          playerA: true,
          playerB: true,
          winner: true,
        },
      });

      if (!match) {
        throw new Error('Match not found');
      }

      if (match.status === 'COMPLETED') {
        throw new Error('Match already completed');
      }

      // Update match
      const updatedMatch = await prisma.tournamentMatch.update({
        where: { id: matchId },
        data: {
          playerAScore: result.playerAScore,
          playerBScore: result.playerBScore,
          winnerId: result.winnerId,
          resultType: result.resultType,
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      // Update participant stats
      await this.updateParticipantStats(tournamentId, match.playerAId, match.playerBId, result);

      // Check if round is complete and advance tournament
      await this.checkRoundCompletion(tournamentId, match.round);

      logger.info('Match result recorded', {
        tournamentId,
        matchId,
        winnerId: result.winnerId,
        round: match.round,
      });

      return updatedMatch;
    } catch (error) {
      logger.error('Failed to handle match result', { error, tournamentId, matchId });
      throw error;
    }
  }

  /**
   * Get tournament bracket
   */
  async getTournamentBracket(tournamentId: string) {
    try {
      const matches = await prisma.tournamentMatch.findMany({
        where: { tournamentId },
        orderBy: [
          { round: 'asc' },
          { matchNumber: 'asc' },
        ],
        include: {
          playerA: {
            include: { user: true },
          },
          playerB: {
            include: { user: true },
          },
          winner: {
            include: { user: true },
          },
        },
      });

      return matches;
    } catch (error) {
      logger.error('Failed to get tournament bracket', { error, tournamentId });
      throw error;
    }
  }

  /**
   * Calculate standings for tournament
   */
  async calculateStandings(tournamentId: string) {
    try {
      const participants = await prisma.tournamentParticipant.findMany({
        where: { tournamentId },
        orderBy: [
          { points: 'desc' },
          { wins: 'desc' },
          { losses: 'asc' },
        ],
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true,
            },
          },
        },
      });

      // Add ranking
      const standings = participants.map((p, index) => ({
        rank: index + 1,
        participantId: p.id,
        userId: p.userId,
        username: p.user.username,
        wins: p.wins,
        losses: p.losses,
        draws: p.draws,
        points: p.points,
        status: p.status,
        prizeAmount: p.prizeAmount,
      }));

      return standings;
    } catch (error) {
      logger.error('Failed to calculate standings', { error, tournamentId });
      throw error;
    }
  }

  /**
   * Update tournament progress
   */
  async updateTournamentProgress(tournamentId: string) {
    try {
      const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId },
      });

      if (!tournament) {
        throw new Error('Tournament not found');
      }

      // Check if all matches in current round are completed
      const currentRoundMatches = await prisma.tournamentMatch.findMany({
        where: {
          tournamentId,
          round: tournament.currentRound,
        },
      });

      const allCompleted = currentRoundMatches.every((m) => m.status === 'COMPLETED');

      if (allCompleted && tournament.currentRound < tournament.totalRounds) {
        // Generate next round matches
        await this.generateNextRound(tournamentId, tournament.currentRound + 1);

        await prisma.tournament.update({
          where: { id: tournamentId },
          data: {
            currentRound: tournament.currentRound + 1,
          },
        });

        logger.info('Tournament advanced to next round', {
          tournamentId,
          newRound: tournament.currentRound + 1,
        });
      } else if (allCompleted && tournament.currentRound >= tournament.totalRounds) {
        // Tournament completed
        await this.completeTournament(tournamentId);
      }
    } catch (error) {
      logger.error('Failed to update tournament progress', { error, tournamentId });
      throw error;
    }
  }

  // Helper methods

  private calculateTotalRounds(format: TournamentFormat, players: number): number {
    switch (format) {
      case TournamentFormat.SINGLE_ELIMINATION:
        return Math.ceil(Math.log2(players));
      case TournamentFormat.DOUBLE_ELIMINATION:
        return Math.ceil(Math.log2(players)) * 2 - 1;
      case TournamentFormat.ROUND_ROBIN:
        return players - 1;
      case TournamentFormat.SWISS:
        return Math.ceil(Math.log2(players));
      default:
        return 0;
    }
  }

  private async generateSingleEliminationBracket(tournament: any) {
    const participants = tournament.participants;
    const playerCount = participants.length;
    const totalRounds = Math.ceil(Math.log2(playerCount));
    const matches: any[] = [];

    // First round
    const firstRoundMatches = Math.pow(2, totalRounds - 1);
    for (let i = 0; i < firstRoundMatches; i++) {
      const playerA = participants[i * 2] || null;
      const playerB = participants[i * 2 + 1] || null;

      const match = await prisma.tournamentMatch.create({
        data: {
          tournamentId: tournament.id,
          round: 1,
          roundName: this.getRoundName(1, totalRounds),
          matchNumber: i + 1,
          playerAId: playerA?.id || null,
          playerBId: playerB?.id || null,
          status: (!playerA || !playerB) ? 'BYE' : 'PENDING',
          winnerId: !playerB ? playerA?.id : (!playerA ? playerB?.id : null),
        },
      });

      matches.push(match);
    }

    // Create empty matches for subsequent rounds
    for (let round = 2; round <= totalRounds; round++) {
      const matchesInRound = Math.pow(2, totalRounds - round);
      for (let i = 0; i < matchesInRound; i++) {
        const match = await prisma.tournamentMatch.create({
          data: {
            tournamentId: tournament.id,
            round,
            roundName: this.getRoundName(round, totalRounds),
            matchNumber: i + 1,
            status: 'PENDING',
          },
        });
        matches.push(match);
      }
    }

    return matches;
  }

  private async generateDoubleEliminationBracket(tournament: any) {
    // Simplified double elimination - winners and losers brackets
    const participants = tournament.participants;
    const playerCount = participants.length;
    const matches: any[] = [];

    // Winners bracket (similar to single elimination)
    const firstRoundMatches = Math.pow(2, Math.ceil(Math.log2(playerCount)) - 1);
    for (let i = 0; i < firstRoundMatches; i++) {
      const playerA = participants[i * 2] || null;
      const playerB = participants[i * 2 + 1] || null;

      const match = await prisma.tournamentMatch.create({
        data: {
          tournamentId: tournament.id,
          round: 1,
          roundName: TournamentRound.ROUND_OF_16,
          matchNumber: i + 1,
          playerAId: playerA?.id || null,
          playerBId: playerB?.id || null,
          status: 'PENDING',
        },
      });

      matches.push(match);
    }

    return matches;
  }

  private async generateRoundRobinBracket(tournament: any) {
    const participants = tournament.participants;
    const playerCount = participants.length;
    const matches: any[] = [];
    let matchNumber = 1;

    // Each player plays every other player once
    for (let i = 0; i < playerCount; i++) {
      for (let j = i + 1; j < playerCount; j++) {
        const match = await prisma.tournamentMatch.create({
          data: {
            tournamentId: tournament.id,
            round: 1,
            roundName: TournamentRound.QUALIFICATION,
            matchNumber: matchNumber++,
            playerAId: participants[i].id,
            playerBId: participants[j].id,
            status: 'PENDING',
          },
        });
        matches.push(match);
      }
    }

    return matches;
  }

  private async generateSwissBracket(tournament: any) {
    const participants = tournament.participants;
    const playerCount = participants.length;
    const totalRounds = Math.ceil(Math.log2(playerCount));
    const matches: any[] = [];

    // First round - random pairing or by seed
    for (let round = 1; round <= totalRounds; round++) {
      const shuffled = [...participants].sort(() => Math.random() - 0.5);
      let matchNumber = 1;

      for (let i = 0; i < shuffled.length - 1; i += 2) {
        const match = await prisma.tournamentMatch.create({
          data: {
            tournamentId: tournament.id,
            round,
            roundName: this.getRoundName(round, totalRounds),
            matchNumber: matchNumber++,
            playerAId: shuffled[i].id,
            playerBId: shuffled[i + 1]?.id || null,
            status: 'PENDING',
          },
        });
        matches.push(match);
      }
    }

    return matches;
  }

  private async updateParticipantStats(
    tournamentId: string,
    playerAId: string | null,
    playerBId: string | null,
    result: MatchResult
  ) {
    if (result.resultType === 'DRAW') {
      // Both players get draw
      if (playerAId) {
        await prisma.tournamentParticipant.update({
          where: { id: playerAId },
          data: { draws: { increment: 1 }, points: { increment: 1 } },
        });
      }
      if (playerBId) {
        await prisma.tournamentParticipant.update({
          where: { id: playerBId },
          data: { draws: { increment: 1 }, points: { increment: 1 } },
        });
      }
    } else {
      // Winner gets 3 points, loser gets 0
      if (result.winnerId === playerAId) {
        if (playerAId) {
          await prisma.tournamentParticipant.update({
            where: { id: playerAId },
            data: { wins: { increment: 1 }, points: { increment: 3 } },
          });
        }
        if (playerBId) {
          await prisma.tournamentParticipant.update({
            where: { id: playerBId },
            data: { losses: { increment: 1 } },
          });
        }
      } else if (result.winnerId === playerBId) {
        if (playerBId) {
          await prisma.tournamentParticipant.update({
            where: { id: playerBId },
            data: { wins: { increment: 1 }, points: { increment: 3 } },
          });
        }
        if (playerAId) {
          await prisma.tournamentParticipant.update({
            where: { id: playerAId },
            data: { losses: { increment: 1 } },
          });
        }
      }
    }
  }

  private async checkRoundCompletion(tournamentId: string, round: number) {
    const roundMatches = await prisma.tournamentMatch.findMany({
      where: {
        tournamentId,
        round,
      },
    });

    const allCompleted = roundMatches.every((m) => m.status === 'COMPLETED');

    if (allCompleted) {
      await this.updateTournamentProgress(tournamentId);
    }
  }

  private async generateNextRound(tournamentId: string, nextRound: number) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
    });

    if (!tournament) return;

    const previousRoundMatches = await prisma.tournamentMatch.findMany({
      where: {
        tournamentId,
        round: nextRound - 1,
        status: 'COMPLETED',
      },
      include: {
        winner: true,
      },
    });

    const winners = previousRoundMatches.map((m) => m.winner).filter(Boolean);

    // Pair winners for next round
    for (let i = 0; i < winners.length - 1; i += 2) {
      await prisma.tournamentMatch.create({
        data: {
          tournamentId,
          round: nextRound,
          roundName: this.getRoundName(nextRound, tournament.totalRounds),
          matchNumber: Math.floor(i / 2) + 1,
          playerAId: winners[i]?.id || null,
          playerBId: winners[i + 1]?.id || null,
          status: 'PENDING',
        },
      });
    }
  }

  private async completeTournament(tournamentId: string) {
    const standings = await this.calculateStandings(tournamentId);

    // Distribute prizes
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
    });

    if (tournament && tournament.prizeDistribution) {
      const prizeDist = tournament.prizeDistribution as Record<string, number>;
      
      for (const [position, percentage] of Object.entries(prizeDist)) {
        const rank = parseInt(position);
        const standing = standings.find((s) => s.rank === rank);
        
        if (standing) {
          const prizeAmount = tournament.prizePool * percentage;
          await prisma.tournamentParticipant.update({
            where: { id: standing.participantId },
            data: {
              prizeAmount,
              status: rank === 1 ? 'WINNER' : standing.status,
            },
          });
        }
      }
    }

    // Update tournament status
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        status: TournamentStatus.COMPLETED,
        endDate: new Date(),
      },
    });

    logger.info('Tournament completed', {
      tournamentId,
      winner: standings[0]?.userId,
    });
  }

  private async createParticipant(tournamentId: string, userId: string, registrationId: string) {
    return await prisma.tournamentParticipant.create({
      data: {
        tournamentId,
        userId,
        status: 'REGISTERED',
      },
    });
  }

  private async getNextWaitlistPosition(tournamentId: string): Promise<number> {
    const count = await prisma.tournamentRegistration.count({
      where: {
        tournamentId,
        status: 'WAITLIST',
      },
    });
    return count + 1;
  }

  private getRoundName(round: number, totalRounds: number): TournamentRound {
    const roundsFromEnd = totalRounds - round + 1;
    
    if (roundsFromEnd === 1) return TournamentRound.FINAL;
    if (roundsFromEnd === 2) return TournamentRound.SEMI_FINAL;
    if (roundsFromEnd === 3) return TournamentRound.QUARTER_FINAL;
    if (roundsFromEnd === 4) return TournamentRound.ROUND_OF_16;
    if (roundsFromEnd === 5) return TournamentRound.ROUND_OF_32;
    if (roundsFromEnd === 6) return TournamentRound.ROUND_OF_64;
    
    return TournamentRound.QUALIFICATION;
  }

  /**
   * Get tournament details
   */
  async getTournament(tournamentId: string) {
    return await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        organizer: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
        _count: {
          select: {
            matches: true,
            registrations: true,
          },
        },
      },
    });
  }

  /**
   * List tournaments with filters
   */
  async listTournaments(filters: {
    status?: TournamentStatus;
    gameId?: string;
    format?: TournamentFormat;
    page?: number;
    limit?: number;
  }) {
    const { status, gameId, format, page = 1, limit = 20 } = filters;

    const where: any = {};
    if (status) where.status = status;
    if (gameId) where.gameId = gameId;
    if (format) where.format = format;

    const [tournaments, total] = await Promise.all([
      prisma.tournament.findMany({
        where,
        orderBy: { startDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          organizer: {
            select: {
              id: true,
              username: true,
            },
          },
          _count: {
            select: {
              participants: true,
              registrations: true,
            },
          },
        },
      }),
      prisma.tournament.count({ where }),
    ]);

    return {
      tournaments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

