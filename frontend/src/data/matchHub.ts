import { BracketMatch, ScoreReport } from "@/types/bracket";

export interface MatchHubEvent {
  id: string;
  type: "status" | "score" | "alert" | "report";
  message: string;
  createdAt: string;
}

export interface MatchHubPlayerSnapshot {
  id: string;
  username: string;
  avatar?: string;
  elo: number;
  region: string;
  seed: number;
  record: string;
  stats: Array<{ label: string; value: string }>;
}

export interface MatchHubDetails {
  id: string;
  tournamentId: string;
  tournamentName: string;
  gameType: string;
  bracketFormat: "single_elimination" | "double_elimination";
  roundLabel: string;
  arenaLabel: string;
  status: BracketMatch["status"];
  bestOf: number;
  scheduledTime: string;
  startedAt?: string;
  streamTitle?: string;
  prizePool: number;
  player1: MatchHubPlayerSnapshot;
  player2: MatchHubPlayerSnapshot;
  scorePlayer1: number;
  scorePlayer2: number;
  winnerId?: string;
  notes: string;
  reports: ScoreReport[];
  feed: MatchHubEvent[];
  canDisputeUntil: string;
}

export const matchHubDetails: Record<string, MatchHubDetails> = {
  "1-match-13": {
    id: "1-match-13",
    tournamentId: "1",
    tournamentName: "CS2 Pro League 2026",
    gameType: "Counter-Strike 2",
    bracketFormat: "single_elimination",
    roundLabel: "Semifinal",
    arenaLabel: "Stage Alpha",
    status: "in_progress",
    bestOf: 3,
    scheduledTime: "2026-03-25T21:10:00Z",
    startedAt: "2026-03-25T21:18:00Z",
    streamTitle: "ArenaX Main Broadcast",
    prizePool: 50000,
    player1: {
      id: "user-123",
      username: "ProGamer99",
      elo: 1850,
      region: "NA",
      seed: 1,
      record: "14-2",
      stats: [
        { label: "K/D", value: "1.24" },
        { label: "Entry", value: "56%" },
        { label: "Clutches", value: "17" },
      ],
    },
    player2: {
      id: "user-456",
      username: "ShadowNinja",
      elo: 1808,
      region: "EU",
      seed: 2,
      record: "13-3",
      stats: [
        { label: "K/D", value: "1.19" },
        { label: "Trade %", value: "72%" },
        { label: "MVPs", value: "6" },
      ],
    },
    scorePlayer1: 1,
    scorePlayer2: 1,
    notes:
      "Map three is live. Winner advances directly to the championship stage.",
    reports: [
      {
        reporterId: "admin-ops",
        reporterName: "ArenaX Referee",
        player1Score: 1,
        player2Score: 1,
        submittedAt: "2026-03-25T21:27:00Z",
      },
    ],
    feed: [
      {
        id: "event-1",
        type: "status",
        message: "Lobby locked. Officials verified both players and map veto concluded.",
        createdAt: "2026-03-25T21:12:00Z",
      },
      {
        id: "event-2",
        type: "score",
        message: "ProGamer99 converted a 1v2 retake to close map one.",
        createdAt: "2026-03-25T21:24:00Z",
      },
      {
        id: "event-3",
        type: "score",
        message: "ShadowNinja answered with a dominant map two to force the decider.",
        createdAt: "2026-03-25T21:31:00Z",
      },
    ],
    canDisputeUntil: "2026-03-25T23:15:00Z",
  },
  "2-match-10": {
    id: "2-match-10",
    tournamentId: "2",
    tournamentName: "Valorant Championship 2026",
    gameType: "Valorant",
    bracketFormat: "double_elimination",
    roundLabel: "Losers Round 2",
    arenaLabel: "Stage Beta",
    status: "disputed",
    bestOf: 3,
    scheduledTime: "2026-03-25T18:00:00Z",
    startedAt: "2026-03-25T18:03:00Z",
    streamTitle: "ArenaX Secondary Stream",
    prizePool: 100000,
    player1: {
      id: "user-456",
      username: "ShadowNinja",
      elo: 1808,
      region: "EU",
      seed: 2,
      record: "13-3",
      stats: [
        { label: "ACS", value: "252" },
        { label: "KAST", value: "74%" },
        { label: "FB", value: "51%" },
      ],
    },
    player2: {
      id: "user-202",
      username: "NightWalker",
      elo: 1680,
      region: "NA",
      seed: 5,
      record: "10-6",
      stats: [
        { label: "ACS", value: "228" },
        { label: "Clutches", value: "11" },
        { label: "Plants", value: "19" },
      ],
    },
    scorePlayer1: 1,
    scorePlayer2: 1,
    notes:
      "Player reports do not match. Match authority review is required before bracket progression.",
    reports: [
      {
        reporterId: "user-456",
        reporterName: "ShadowNinja",
        player1Score: 2,
        player2Score: 1,
        submittedAt: "2026-03-25T18:41:00Z",
      },
      {
        reporterId: "user-202",
        reporterName: "NightWalker",
        player1Score: 1,
        player2Score: 2,
        submittedAt: "2026-03-25T18:42:00Z",
      },
    ],
    feed: [
      {
        id: "event-4",
        type: "alert",
        message: "Conflicting score submissions detected. Bracket progression paused.",
        createdAt: "2026-03-25T18:42:00Z",
      },
      {
        id: "event-5",
        type: "report",
        message: "ArenaX support requested a screenshot or match VOD from both players.",
        createdAt: "2026-03-25T18:47:00Z",
      },
    ],
    canDisputeUntil: "2026-03-25T20:00:00Z",
  },
};
