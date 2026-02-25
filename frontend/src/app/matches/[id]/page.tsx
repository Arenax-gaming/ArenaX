"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useMatchWebSocket, useMatchScoreReporting } from "@/hooks/useMatchWebSocket";
import { ArrowLeft, RefreshCw, Wifi, WifiOff, AlertTriangle, CheckCircle, User, Trophy } from "lucide-react";
import Link from "next/link";

// Mock match data
interface MatchDetail {
  id: string;
  tournamentId: string;
  tournamentName: string;
  player1Id: string;
  player1Username: string;
  player2Id: string;
  player2Username: string;
  gameType: string;
  status: "pending" | "in_progress" | "completed" | "disputed" | "cancelled";
  scorePlayer1: number;
  scorePlayer2: number;
  winnerId?: string;
  startedAt?: string;
  completedAt?: string;
}

// Mock data for demonstration
const mockMatchDetails: Record<string, MatchDetail> = {
  "match-1": {
    id: "match-1",
    tournamentId: "1",
    tournamentName: "CS2 Pro League 2026",
    player1Id: "user-123",
    player1Username: "ProGamer99",
    player2Id: "user-456",
    player2Username: "ShadowNinja",
    gameType: "Counter-Strike 2",
    status: "in_progress",
    scorePlayer1: 8,
    scorePlayer2: 7,
    startedAt: "2026-02-24T18:00:00Z",
  },
  "match-2": {
    id: "match-2",
    tournamentId: "1",
    tournamentName: "CS2 Pro League 2026",
    player1Id: "user-789",
    player1Username: "EliteSniper",
    player2Id: "user-101",
    player2Username: "DragonSlayer",
    gameType: "Counter-Strike 2",
    status: "in_progress",
    scorePlayer1: 5,
    scorePlayer2: 3,
    startedAt: "2026-02-24T18:30:00Z",
  },
};

export default function MatchHubPage() {
  const params = useParams();
  const router = useRouter();
  const matchId = params.id as string;

  // Get current user (mock)
  const currentUserId = "user-123"; // Would come from auth context

  // Local match state (simulated real-time updates)
  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load match data
  useEffect(() => {
    const loadMatch = async () => {
      setIsLoading(true);
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500));
      
      const matchData = mockMatchDetails[matchId];
      if (matchData) {
        setMatch(matchData);
      }
      setIsLoading(false);
    };

    loadMatch();
  }, [matchId]);

  // WebSocket connection for real-time updates
  const { isConnected, lastUpdate, connectionError, reconnect } = useMatchWebSocket({
    matchId,
    enabled: match?.status === "in_progress",
  });

  // Score reporting hook
  const { 
    reportScore, 
    isReporting, 
    conflictDetected, 
    conflictingReport, 
    clearConflict 
  } = useMatchScoreReporting();

  // Score input states
  const [player1Score, setPlayer1Score] = useState(0);
  const [player2Score, setPlayer2Score] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  // Check if current user is a participant
  const isParticipant = useMemo(() => {
    if (!match) return false;
    return match.player1Id === currentUserId || match.player2Id === currentUserId;
  }, [match, currentUserId]);

  // Check if current user is the reporter
  const isReporter = isParticipant;

  // Update local state when match loads
  useEffect(() => {
    if (match) {
      setPlayer1Score(match.scorePlayer1);
      setPlayer2Score(match.scorePlayer2);
    }
  }, [match]);

  // Apply real-time score updates
  useEffect(() => {
    if (lastUpdate && match) {
      setMatch((prevMatch) => {
        if (!prevMatch) return prevMatch;
        return {
          ...prevMatch,
          scorePlayer1: lastUpdate.scorePlayer1 ?? prevMatch.scorePlayer1,
          scorePlayer2: lastUpdate.scorePlayer2 ?? prevMatch.scorePlayer2,
        };
      });
      setPlayer1Score(lastUpdate.scorePlayer1 ?? match.scorePlayer1);
      setPlayer2Score(lastUpdate.scorePlayer2 ?? match.scorePlayer2);
    }
  }, [lastUpdate, match]);

  const handleSubmitScore = async () => {
    if (!match) return;

    const success = await reportScore({
      matchId: match.id,
      player1Score,
      player2Score,
      reporterId: currentUserId,
    });

    if (success) {
      setSubmitted(true);
      // Reset after 2 seconds
      setTimeout(() => setSubmitted(false), 2000);
    }
  };

  const handleResolveConflict = () => {
    // In a real app, this would open a dispute resolution flow
    clearConflict();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-muted-foreground">Loading match...</p>
        </div>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground mb-2">Match Not Found</h1>
          <p className="text-muted-foreground mb-6">
            The match you&apos;re looking for doesn&apos;t exist.
          </p>
          <Button onClick={() => router.push("/tournaments")}>
            Back to Tournaments
          </Button>
        </div>
      </div>
    );
  }

  const isLive = match.status === "in_progress";

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      {/* Back Button */}
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>

      <div className="max-w-4xl mx-auto">
        {/* Match Header */}
        <div className="bg-card border rounded-lg p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Match Hub</h1>
              <p className="text-muted-foreground">{match.tournamentName}</p>
              <p className="text-sm text-muted-foreground">{match.gameType}</p>
            </div>
            <div className="flex items-center gap-4">
              {/* Connection Status */}
              {isLive && (
                <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
                  isConnected 
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" 
                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                }`}>
                  {isConnected ? (
                    <>
                      <Wifi className="h-4 w-4" />
                      Live
                    </>
                  ) : (
                    <>
                      <WifiOff className="h-4 w-4" />
                      Disconnected
                    </>
                  )}
                </div>
              )}
              
              {/* Match Status */}
              <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                isLive 
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" 
                  : match.status === "completed"
                    ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                    : "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400"
              }`}>
                {isLive ? "In Progress" : match.status.charAt(0).toUpperCase() + match.status.slice(1)}
              </div>
            </div>
          </div>

          {/* Connection Error */}
          {connectionError && (
            <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-center justify-between">
                <p className="text-sm text-red-700 dark:text-red-300">{connectionError}</p>
                <Button variant="ghost" size="sm" onClick={reconnect}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Score Display */}
        <div className="bg-card border rounded-lg p-6 mb-6">
          <div className="flex items-center justify-center gap-8">
            {/* Player 1 */}
            <div className="text-center">
              <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                <User className="h-10 w-10 text-muted-foreground" />
              </div>
              <p className="font-semibold text-lg text-foreground">{match.player1Username}</p>
              {match.player1Id === currentUserId && (
                <span className="text-xs text-blue-600">(You)</span>
              )}
              <p className="text-4xl font-bold text-foreground mt-2">
                {match.scorePlayer1}
              </p>
            </div>

            {/* VS */}
            <div className="text-center">
              <p className="text-2xl font-bold text-muted-foreground">VS</p>
            </div>

            {/* Player 2 */}
            <div className="text-center">
              <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                <User className="h-10 w-10 text-muted-foreground" />
              </div>
              <p className="font-semibold text-lg text-foreground">{match.player2Username}</p>
              {match.player2Id === currentUserId && (
                <span className="text-xs text-blue-600">(You)</span>
              )}
              <p className="text-4xl font-bold text-foreground mt-2">
                {match.scorePlayer2}
              </p>
            </div>
          </div>

          {/* Winner Display */}
          {match.status === "completed" && match.winnerId && (
            <div className="mt-6 pt-6 border-t text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <Trophy className="h-5 w-5 text-yellow-600" />
                <span className="font-medium text-yellow-800 dark:text-yellow-200">
                  Winner: {match.winnerId === match.player1Id ? match.player1Username : match.player2Username}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Score Reporting Form (only for participants) */}
        {isReporter && isLive && (
          <div className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Report Match Score
            </h2>

            {/* Conflict Alert */}
            {conflictDetected && (
              <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-medium text-red-800 dark:text-red-200 mb-2">
                      Score Conflict Detected!
                    </h3>
                    <p className="text-sm text-red-700 dark:text-red-300 mb-3">
                      The other player reported a different score. Please resolve this discrepancy.
                    </p>
                    {conflictingReport && (
                      <div className="bg-white dark:bg-red-950/30 rounded p-3 text-sm">
                        <p className="font-medium text-foreground">Their report:</p>
                        <p className="text-muted-foreground">
                          {match.player1Username}: {conflictingReport.player1Score} - {match.player2Username}: {conflictingReport.player2Score}
                        </p>
                      </div>
                    )}
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" variant="primary" onClick={handleResolveConflict}>
                        Resolve Dispute
                      </Button>
                      <Button size="sm" variant="ghost" onClick={clearConflict}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Score Input */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {match.player1Username} Score
                </label>
                <input
                  type="number"
                  min="0"
                  value={player1Score}
                  onChange={(e) => setPlayer1Score(parseInt(e.target.value) || 0)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <div className="flex items-end justify-center pb-2">
                <span className="text-muted-foreground">-</span>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {match.player2Username} Score
                </label>
                <input
                  type="number"
                  min="0"
                  value={player2Score}
                  onChange={(e) => setPlayer2Score(parseInt(e.target.value) || 0)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            {/* Submit Button */}
            <div className="mt-6">
              <Button
                onClick={handleSubmitScore}
                disabled={isReporting || submitted}
                className="w-full"
              >
                {submitted ? (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Score Submitted
                  </>
                ) : isReporting ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Submit Score"
                )}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground mt-3 text-center">
              Both players must report the same score for the match to be confirmed.
            </p>
          </div>
        )}

        {/* Not a participant */}
        {!isReporter && isLive && (
          <div className="bg-card border rounded-lg p-6 text-center">
            <p className="text-muted-foreground">
              Only participants can report scores for this match.
            </p>
          </div>
        )}

        {/* Match Info */}
        <div className="mt-6 bg-muted/30 rounded-lg p-4">
          <h3 className="font-medium text-foreground mb-2">Match Information</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Match ID</p>
              <p className="text-foreground font-medium">{match.id}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Tournament</p>
              <Link 
                href={`/tournaments/${match.tournamentId}`}
                className="text-blue-600 hover:underline"
              >
                {match.tournamentName}
              </Link>
            </div>
            {match.startedAt && (
              <div>
                <p className="text-muted-foreground">Started</p>
                <p className="text-foreground">
                  {new Date(match.startedAt).toLocaleString()}
                </p>
              </div>
            )}
            {match.completedAt && (
              <div>
                <p className="text-muted-foreground">Completed</p>
                <p className="text-foreground">
                  {new Date(match.completedAt).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
