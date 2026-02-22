import { Match } from "@/types/match";

export const mockMatches: Match[] = [
  {
    id: "match-1",
    tournamentId: "2",
    player1Id: "user-1",
    player2Id: "user-2",
    gameType: "Valorant",
    status: "in_progress",
    scorePlayer1: 2,
    scorePlayer2: 1,
    startedAt: "2026-01-22T18:00:00Z",
    createdAt: "2026-01-22T17:00:00Z",
  },
  {
    id: "match-2",
    tournamentId: "2",
    player1Id: "user-3",
    player2Id: "user-4",
    gameType: "Valorant",
    status: "pending",
    scorePlayer1: 0,
    scorePlayer2: 0,
    createdAt: "2026-01-22T17:30:00Z",
  },
  {
    id: "match-3",
    tournamentId: "7",
    player1Id: "mock-user",
    player2Id: "user-5",
    gameType: "Rainbow Six Siege",
    status: "in_progress",
    scorePlayer1: 3,
    scorePlayer2: 2,
    startedAt: "2026-01-22T19:00:00Z",
    createdAt: "2026-01-22T18:00:00Z",
  },
  {
    id: "match-4",
    tournamentId: "7",
    player1Id: "user-6",
    player2Id: "user-7",
    gameType: "Rainbow Six Siege",
    status: "completed",
    winnerId: "user-6",
    scorePlayer1: 5,
    scorePlayer2: 3,
    startedAt: "2026-01-21T18:00:00Z",
    completedAt: "2026-01-21T19:30:00Z",
    createdAt: "2026-01-21T17:00:00Z",
  },
];

// Mock player usernames
export const mockPlayerUsernames: Record<string, string> = {
  "user-1": "ProGamer123",
  "user-2": "ElitePlayer",
  "user-3": "ShadowHunter",
  "user-4": "NightWolf",
  "user-5": "StormRider",
  "user-6": "CyberNinja",
  "user-7": "DragonSlayer",
  "mock-user": "ArenaPlayer",
};

// Score submissions for conflict detection
export interface ScoreSubmission {
  matchId: string;
  playerId: string;
  score: number;
  submittedAt: string;
}

// Store score submissions in memory (in real app, this would be in the backend)
export const scoreSubmissions: ScoreSubmission[] = [];
