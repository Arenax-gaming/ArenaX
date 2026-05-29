import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Create game modes
  const gameModes = await Promise.all([
    prisma.gameMode.create({
      data: {
        name: '1v1_duel',
        displayName: '1v1 Duel',
        type: 'ONE_V_ONE',
        description: 'Classic 1v1 competitive match',
        maxPlayers: 2,
        minPlayers: 2,
        rules: {
          winCondition: 'first_to_5',
          timeLimit: 600,
          allowDraws: false,
        },
        settings: {
          enableRanking: true,
          enableReplay: true,
        },
      },
    }),
    prisma.gameMode.create({
      data: {
        name: '2v2_team',
        displayName: '2v2 Team Battle',
        type: 'TWO_V_TWO',
        description: 'Team-based 2v2 matches',
        maxPlayers: 4,
        minPlayers: 4,
        rules: {
          winCondition: 'first_to_7',
          timeLimit: 900,
          allowDraws: true,
        },
        settings: {
          enableRanking: true,
          enableReplay: true,
        },
      },
    }),
    prisma.gameMode.create({
      data: {
        name: 'ffa_battle',
        displayName: 'Free For All',
        type: 'FREE_FOR_ALL',
        description: 'Every player for themselves',
        maxPlayers: 8,
        minPlayers: 3,
        rules: {
          winCondition: 'last_standing',
          timeLimit: 1200,
          allowDraws: false,
        },
        settings: {
          enableRanking: true,
          enableReplay: true,
        },
      },
    }),
  ]);

  console.log(`✅ Created ${gameModes.length} game modes`);

  // Create test users
  const hashedPassword = await bcrypt.hash('password123', 10);
  const users = await Promise.all([
    prisma.user.create({
      data: {
        email: 'player1@arenax.com',
        username: 'player1',
        passwordHash: hashedPassword,
        role: 'USER',
        isVerified: true,
        bio: 'Competitive player',
        walletAddress: 'G' + 'A'.repeat(55),
      },
    }),
    prisma.user.create({
      data: {
        email: 'player2@arenax.com',
        username: 'player2',
        passwordHash: hashedPassword,
        role: 'USER',
        isVerified: true,
        bio: 'Strategy specialist',
        walletAddress: 'G' + 'B'.repeat(55),
      },
    }),
    prisma.user.create({
      data: {
        email: 'admin@arenax.com',
        username: 'admin',
        passwordHash: hashedPassword,
        role: 'ADMIN',
        isVerified: true,
        bio: 'Platform administrator',
      },
    }),
  ]);

  console.log(`✅ Created ${users.length} users`);

  // Create leaderboards
  const leaderboards = await Promise.all([
    prisma.leaderboard.create({
      data: {
        name: 'Global Rankings',
        type: 'GLOBAL',
        isActive: true,
        startDate: new Date('2024-01-01'),
        metadata: {
          description: 'All-time global rankings',
        },
      },
    }),
    prisma.leaderboard.create({
      data: {
        name: '1v1 Season 1',
        type: 'GAME_MODE',
        gameModeId: gameModes[0].id,
        season: 1,
        isActive: true,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-03-31'),
        metadata: {
          description: 'Season 1 1v1 rankings',
        },
      },
    }),
  ]);

  console.log(`✅ Created ${leaderboards.length} leaderboards`);

  // Add users to leaderboards
  const leaderboardEntries = await Promise.all([
    prisma.leaderboardEntry.create({
      data: {
        leaderboardId: leaderboards[0].id,
        userId: users[0].id,
        rank: 1,
        score: 1500,
        wins: 45,
        losses: 15,
        draws: 2,
        winRate: 0.73,
        gamesPlayed: 62,
      },
    }),
    prisma.leaderboardEntry.create({
      data: {
        leaderboardId: leaderboards[0].id,
        userId: users[1].id,
        rank: 2,
        score: 1350,
        wins: 38,
        losses: 20,
        draws: 5,
        winRate: 0.60,
        gamesPlayed: 63,
      },
    }),
    prisma.leaderboardEntry.create({
      data: {
        leaderboardId: leaderboards[1].id,
        userId: users[0].id,
        rank: 1,
        score: 800,
        wins: 25,
        losses: 8,
        draws: 1,
        winRate: 0.75,
        gamesPlayed: 34,
      },
    }),
  ]);

  console.log(`✅ Created ${leaderboardEntries.length} leaderboard entries`);

  // Create achievements
  const achievements = await Promise.all([
    prisma.achievement.create({
      data: {
        key: 'first_win',
        name: 'First Victory',
        description: 'Win your first match',
        category: 'COMBAT',
        targetValue: 1,
        eventTypes: ['match_completed'],
        rewards: {
          xp: 100,
          title: 'Novice',
        },
        sortOrder: 1,
      },
    }),
    prisma.achievement.create({
      data: {
        key: 'win_streak_5',
        name: 'Hot Streak',
        description: 'Win 5 matches in a row',
        category: 'COMBAT',
        targetValue: 5,
        eventTypes: ['match_completed'],
        rewards: {
          xp: 500,
          title: 'Competitor',
        },
        sortOrder: 2,
      },
    }),
    prisma.achievement.create({
      data: {
        key: 'social_butterfly',
        name: 'Social Butterfly',
        description: 'Play with 10 different players',
        category: 'SOCIAL',
        targetValue: 10,
        eventTypes: ['match_joined'],
        rewards: {
          xp: 300,
          badge: 'social',
        },
        sortOrder: 3,
      },
    }),
  ]);

  console.log(`✅ Created ${achievements.length} achievements`);

  // Create sample tournament
  const tournament = await prisma.tournament.create({
    data: {
      name: 'ArenaX Championship 2024',
      description: 'The premier ArenaX tournament of the year',
      gameId: 'game_001',
      gameModeId: gameModes[0].id,
      format: 'SINGLE_ELIMINATION',
      status: 'REGISTRATION_OPEN',
      maxPlayers: 32,
      minPlayers: 2,
      entryFee: 10,
      prizePool: 1000,
      prizeDistribution: {
        first: 600,
        second: 300,
        third: 100,
      },
      registrationStart: new Date('2024-02-01T00:00:00Z'),
      registrationEnd: new Date('2024-03-10T23:59:59Z'),
      startDate: new Date('2024-03-15T18:00:00Z'),
      endDate: new Date('2024-03-17T22:00:00Z'),
      organizerId: users[2].id,
      settings: {
        doubleElimination: false,
        bestOf: 3,
        timeLimit: 600,
      },
    },
  });

  console.log(`✅ Created tournament: ${tournament.name}`);

  // Register users for tournament
  await Promise.all([
    prisma.tournamentRegistration.create({
      data: {
        tournamentId: tournament.id,
        userId: users[0].id,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        confirmedAt: new Date('2024-02-01T00:00:00Z'),
      },
    }),
    prisma.tournamentRegistration.create({
      data: {
        tournamentId: tournament.id,
        userId: users[1].id,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        confirmedAt: new Date('2024-02-01T00:00:00Z'),
      },
    }),
  ]);

  console.log(`✅ Registered users for tournament`);

  // Create sample game session
  const gameSession = await prisma.gameSession.create({
    data: {
      gameId: 'game_001',
      gameModeId: gameModes[0].id,
      sessionType: 'RANKED',
      status: 'COMPLETED',
      hostId: users[0].id,
      maxPlayers: 2,
      minPlayers: 2,
      currentState: {
        phase: 'completed',
      },
      initialState: {
        map: 'arena_classic',
      },
      settings: {
        enablePowerups: true,
      },
      metadata: {
        server: 'us-east-1',
        region: 'na',
      },
      startedAt: new Date('2024-02-01T10:00:00Z'),
      endedAt: new Date('2024-02-01T10:15:00Z'),
      duration: 900,
    },
  });

  console.log(`✅ Created game session`);

  // Add participants to game session
  await Promise.all([
    prisma.gameSessionPlayer.create({
      data: {
        sessionId: gameSession.id,
        userId: users[0].id,
        playerNumber: 1,
        team: 'A',
        score: 5,
        rank: 1,
        rating: 1500,
        ratingChange: 25,
        status: 'COMPLETED',
        joinedAt: new Date('2024-02-01T10:00:00Z'),
        leftAt: new Date('2024-02-01T10:15:00Z'),
        metadata: {
          kills: 12,
          deaths: 8,
          assists: 3,
        },
      },
    }),
    prisma.gameSessionPlayer.create({
      data: {
        sessionId: gameSession.id,
        userId: users[1].id,
        playerNumber: 2,
        team: 'B',
        score: 3,
        rank: 2,
        rating: 1450,
        ratingChange: -25,
        status: 'COMPLETED',
        joinedAt: new Date('2024-02-01T10:00:00Z'),
        leftAt: new Date('2024-02-01T10:15:00Z'),
        metadata: {
          kills: 8,
          deaths: 12,
          assists: 2,
        },
      },
    }),
  ]);

  console.log(`✅ Added participants to game session`);

  // Create match history
  await prisma.matchHistory.create({
    data: {
      gameSessionId: gameSession.id,
      playerAId: users[0].id,
      playerBId: users[1].id,
      winnerId: users[0].id,
      scoreA: 5,
      scoreB: 3,
      duration: 900,
      analytics: {
        totalKills: 20,
        totalDeaths: 20,
        averageKillTime: 45,
      },
    },
  });

  console.log(`✅ Created match history`);

  console.log('🎉 Database seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
