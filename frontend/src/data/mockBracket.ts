import { BracketData, BracketMatch, BracketRound, BracketPlayer, calculatePrizeDistribution } from "@/types/bracket";

// Mock players for bracket
const mockPlayers: BracketPlayer[] = [
  { id: "user-1", username: "ProGamer99", elo: 1850 },
  { id: "user-2", username: "ShadowNinja", elo: 1720 },
  { id: "user-3", username: "EliteSniper", elo: 1680 },
  { id: "user-4", username: "DragonSlayer", elo: 1650 },
  { id: "user-5", username: "NightWalker", elo: 1590 },
  { id: "user-6", username: "SpeedRunner", elo: 1540 },
  { id: "user-7", username: "CyberPunk", elo: 1510 },
  { id: "user-8", username: "IronWolf", elo: 1480 },
];

// Prize pool for the tournament
const prizePool = 50000;
const prizeDistribution = calculatePrizeDistribution(prizePool);

// Generate mock matches for a single elimination bracket
export function generateMockBracket(tournamentId: string): BracketData {
  const rounds: BracketRound[] = [];
  const totalRounds = 3; // 8 players = 3 rounds (Quarterfinals, Semifinals, Finals)

  // Round 1: Quarterfinals (4 matches)
  const round1Matches: BracketMatch[] = [
    {
      id: `${tournamentId}-match-1`,
      round: 1,
      matchNumber: 1,
      player1: mockPlayers[0],
      player2: mockPlayers[7],
      status: "completed",
      winnerId: mockPlayers[0].id,
      scorePlayer1: 2,
      scorePlayer2: 0,
      nextMatchId: `${tournamentId}-match-5`,
    },
    {
      id: `${tournamentId}-match-2`,
      round: 1,
      matchNumber: 2,
      player1: mockPlayers[1],
      player2: mockPlayers[6],
      status: "completed",
      winnerId: mockPlayers[1].id,
      scorePlayer1: 2,
      scorePlayer2: 1,
      nextMatchId: `${tournamentId}-match-5`,
    },
    {
      id: `${tournamentId}-match-3`,
      round: 1,
      matchNumber: 3,
      player1: mockPlayers[2],
      player2: mockPlayers[5],
      status: "completed",
      winnerId: mockPlayers[2].id,
      scorePlayer1: 2,
      scorePlayer2: 0,
      nextMatchId: `${tournamentId}-match-6`,
    },
    {
      id: `${tournamentId}-match-4`,
      round: 1,
      matchNumber: 4,
      player1: mockPlayers[3],
      player2: mockPlayers[4],
      status: "completed",
      winnerId: mockPlayers[3].id,
      scorePlayer1: 2,
      scorePlayer2: 1,
      nextMatchId: `${tournamentId}-match-6`,
    },
  ];

  // Round 2: Semifinals (2 matches)
  const round2Matches: BracketMatch[] = [
    {
      id: `${tournamentId}-match-5`,
      round: 2,
      matchNumber: 5,
      player1: mockPlayers[0],
      player2: mockPlayers[1],
      status: "completed",
      winnerId: mockPlayers[0].id,
      scorePlayer1: 2,
      scorePlayer2: 1,
      nextMatchId: `${tournamentId}-match-7`,
    },
    {
      id: `${tournamentId}-match-6`,
      round: 2,
      matchNumber: 6,
      player1: mockPlayers[2],
      player2: mockPlayers[3],
      status: "completed",
      winnerId: mockPlayers[3].id,
      scorePlayer1: 1,
      scorePlayer2: 2,
      nextMatchId: `${tournamentId}-match-7`,
    },
  ];

  // Round 3: Finals (1 match)
  const round3Matches: BracketMatch[] = [
    {
      id: `${tournamentId}-match-7`,
      round: 3,
      matchNumber: 7,
      player1: mockPlayers[0],
      player2: mockPlayers[3],
      status: "completed",
      winnerId: mockPlayers[0].id,
      scorePlayer1: 3,
      scorePlayer2: 2,
    },
  ];

  rounds.push({
    roundNumber: 1,
    roundName: "Quarterfinals",
    matches: round1Matches,
  });

  rounds.push({
    roundNumber: 2,
    roundName: "Semifinals",
    matches: round2Matches,
  });

  rounds.push({
    roundNumber: 3,
    roundName: "Finals",
    matches: round3Matches,
  });

  return {
    tournamentId,
    tournamentName: "CS2 Pro League 2026",
    rounds,
    totalRounds,
    prizeDistribution,
  };
}

// Generate a bracket with a match where the current user is playing
export function generateMockBracketWithCurrentUser(
  tournamentId: string,
  currentUserId: string
): BracketData {
  const bracket = generateMockBracket(tournamentId);
  
  // Add current user to the first match as player 1
  if (bracket.rounds[0]?.matches[0]) {
    bracket.rounds[0].matches[0].player1 = {
      id: currentUserId,
      username: "CurrentUser",
      elo: 1700,
      isCurrentUser: true,
    };
    bracket.rounds[0].matches[0].player2 = mockPlayers[7];
  }
  
  return bracket;
}

// Generate a bracket with some in-progress matches
export function generateInProgressBracket(tournamentId: string): BracketData {
  const bracket = generateMockBracket(tournamentId);
  
  // Make the semifinals in progress
  if (bracket.rounds[1]?.matches[0]) {
    bracket.rounds[1].matches[0].status = "in_progress";
  }
  
  return bracket;
}

// Generate a bracket with pending matches (for upcoming tournaments)
export function generatePendingBracket(tournamentId: string): BracketData {
  const rounds: BracketRound[] = [];
  const totalRounds = 3;

  // Round 1: Quarterfinals - all pending
  const round1Matches: BracketMatch[] = [
    {
      id: `${tournamentId}-match-1`,
      round: 1,
      matchNumber: 1,
      player1: mockPlayers[0],
      player2: mockPlayers[7],
      status: "pending",
      nextMatchId: `${tournamentId}-match-5`,
    },
    {
      id: `${tournamentId}-match-2`,
      round: 1,
      matchNumber: 2,
      player1: mockPlayers[1],
      player2: mockPlayers[6],
      status: "pending",
      nextMatchId: `${tournamentId}-match-5`,
    },
    {
      id: `${tournamentId}-match-3`,
      round: 1,
      matchNumber: 3,
      player1: mockPlayers[2],
      player2: mockPlayers[5],
      status: "pending",
      nextMatchId: `${tournamentId}-match-6`,
    },
    {
      id: `${tournamentId}-match-4`,
      round: 1,
      matchNumber: 4,
      player1: mockPlayers[3],
      player2: mockPlayers[4],
      status: "pending",
      nextMatchId: `${tournamentId}-match-6`,
    },
  ];

  // Round 2: Semifinals - no players yet
  const round2Matches: BracketMatch[] = [
    {
      id: `${tournamentId}-match-5`,
      round: 2,
      matchNumber: 5,
      player1: null,
      player2: null,
      status: "pending",
      nextMatchId: `${tournamentId}-match-7`,
    },
    {
      id: `${tournamentId}-match-6`,
      round: 2,
      matchNumber: 6,
      player1: null,
      player2: null,
      status: "pending",
      nextMatchId: `${tournamentId}-match-7`,
    },
  ];

  // Round 3: Finals - no players yet
  const round3Matches: BracketMatch[] = [
    {
      id: `${tournamentId}-match-7`,
      round: 3,
      matchNumber: 7,
      player1: null,
      player2: null,
      status: "pending",
    },
  ];

  rounds.push({
    roundNumber: 1,
    roundName: "Quarterfinals",
    matches: round1Matches,
  });

  rounds.push({
    roundNumber: 2,
    roundName: "Semifinals",
    matches: round2Matches,
  });

  rounds.push({
    roundNumber: 3,
    roundName: "Finals",
    matches: round3Matches,
  });

  return {
    tournamentId,
    tournamentName: "Upcoming Tournament",
    rounds,
    totalRounds,
    prizeDistribution,
  };
}
