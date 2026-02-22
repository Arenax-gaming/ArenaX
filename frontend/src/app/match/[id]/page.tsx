"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ArrowLeft, Trophy, Users, Clock, AlertCircle, CheckCircle, RefreshCw } from "lucide-react";
import { mockMatches, mockPlayerUsernames, ScoreSubmission } from "@/data/mockMatches";
import { Match, MatchStatus } from "@/types/match";
import { ScoreReportingForm } from "@/components/match/ScoreReportingForm";
import { ConflictAlert } from "@/components/match/ConflictAlert";

// Score submissions state (simulating backend storage)
let scoreSubmissionsStore: ScoreSubmission[] = [];

export default function MatchPage() {
  const params = useParams();
  const router = useRouter();
  const matchId = params.id as string;

  // Mock current user
  const currentUserId = "mock-user";
  const currentUsername = "ArenaPlayer";

  // Match state
  const [match, setMatch] = useState<Match | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scoreSubmissions, setScoreSubmissions] = useState<ScoreSubmission[]>([]);

  // Real-time updates simulation
  const [isConnected, setIsConnected] = useState(false);

  // Load match data
  useEffect(() => {
    const loadMatch = async () => {
      setIsLoading(true);
      try {
        // Simulate API call
        await new Promise((resolve) => setTimeout(resolve, 500));
        
        const foundMatch = mockMatches.find((m) => m.id === matchId);
        if (foundMatch) {
          setMatch(foundMatch);
          // Load existing score submissions for this match
          setScoreSubmissions(scoreSubmissionsStore.filter(s => s.matchId === matchId));
        } else {
          setError("Match not found");
        }
      } catch (err) {
        setError("Failed to load match");
      } finally {
        setIsLoading(false);
      }
    };

    loadMatch();
  }, [matchId]);

  // Simulate WebSocket connection
  useEffect(() => {
    if (!match) return;

    // Simulate connection
    const connectTimeout = setTimeout(() => {
      setIsConnected(true);
    }, 1000);

    // Simulate real-time score updates (for demo)
    const intervalId = setInterval(() => {
      if (match?.status === "in_progress") {
        // Randomly update scores occasionally
        if (Math.random() > 0.8) {
          setMatch((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              scorePlayer1: (prev.scorePlayer1 || 0) + (Math.random() > 0.5 ? 1 : 0),
              scorePlayer2: (prev.scorePlayer2 || 0) + (Math.random() > 0.5 ? 1 : 0),
            };
          });
        }
      }
    }, 10000);

    return () => {
      clearTimeout(connectTimeout);
      clearInterval(intervalId);
    };
  }, [match]);

  // Get player usernames
  const player1Username = useMemo(() => {
    if (!match) return "Unknown";
    return mockPlayerUsernames[match.player1Id] || `Player ${match.player1Id}`;
  }, [match]);

  const player2Username = useMemo(() => {
    if (!match) return "Unknown";
    return mockPlayerUsernames[match.player2Id] || `Player ${match.player2Id}`;
  }, [match]);

  // Determine if current user is player 1 or player 2
  const isPlayer1 = match?.player1Id === currentUserId;
  const isPlayer2 = match?.player2Id === currentUserId;
  const isParticipant = isPlayer1 || isPlayer2;

  // Get current user's submission
  const userSubmission = useMemo(() => {
    return scoreSubmissions.find(s => s.playerId === currentUserId);
  }, [scoreSubmissions, currentUserId]);

  // Get opponent's submission
  const opponentSubmission = useMemo(() => {
    const opponentId = isPlayer1 ? match?.player2Id : match?.player1Id;
    return scoreSubmissions.find(s => s.playerId === opponentId);
  }, [scoreSubmissions, isPlayer1, match?.player1Id, match?.player2Id]);

  // Check for score conflict
  const hasConflict = useMemo(() => {
    if (!userSubmission || !opponentSubmission) return false;
    return userSubmission.score !== opponentSubmission.score;
  }, [userSubmission, opponentSubmission]);

  // Handle score submission
  const handleScoreSubmit = useCallback(async (score: number): Promise<boolean> => {
    if (!match || !isParticipant) return false;

    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Add submission
      const submission: ScoreSubmission = {
        matchId: match.id,
        playerId: currentUserId,
        score,
        submittedAt: new Date().toISOString(),
      };

      // Update local state
      setScoreSubmissions((prev) => {
        // Remove previous submission from this player if exists
        const filtered = prev.filter(s => s.playerId !== currentUserId);
        return [...filtered, submission];
      });

      // Also update the store
      scoreSubmissionsStore = [
        ...scoreSubmissionsStore.filter(s => s.playerId !== currentUserId || s.matchId !== match.id),
        submission,
      ];

      // Update match with submitted scores
      if (isPlayer1) {
        setMatch(prev => prev ? { ...prev, scorePlayer1: score } : prev);
      } else if (isPlayer2) {
        setMatch(prev => prev ? { ...prev, scorePlayer2: score } : prev);
      }

      // Check if both players have submitted - simulate match completion
      const allSubmissions = [...scoreSubmissions.filter(s => s.playerId !== currentUserId), submission];
      const player1Sub = allSubmissions.find(s => s.playerId === match.player1Id);
      const player2Sub = allSubmissions.find(s => s.playerId === match.player2Id);

      if (player1Sub && player2Sub) {
        // Both submitted - check if scores match
        if (player1Sub.score === player2Sub.score) {
          // Scores match - complete the match
          const winnerId = player1Sub.score > player2Sub.score ? match.player1Id : match.player2Id;
          setMatch(prev => prev ? {
            ...prev,
            status: "completed" as MatchStatus,
            winnerId,
            completedAt: new Date().toISOString()
          } : prev);
        }
        // If scores don't match, conflict will be shown
      }

      return true;
    } catch (err) {
      return false;
    }
  }, [match, isParticipant, currentUserId, isPlayer1, isPlayer2, scoreSubmissions]);

  // Status display
  const getStatusDisplay = (status: MatchStatus) => {
    const statusMap: Record<MatchStatus, { label: string; color: string; bgColor: string }> = {
      pending: { label: "Pending", color: "text-gray-600", bgColor: "bg-gray-100" },
      in_progress: { label: "In Progress", color: "text-green-600", bgColor: "bg-green-100" },
      completed: { label: "Completed", color: "text-purple-600", bgColor: "bg-purple-100" },
      disputed: { label: "Disputed", color: "text-red-600", bgColor: "bg-red-100" },
      cancelled: { label: "Cancelled", color: "text-red-600", bgColor: "bg-red-100" },
    };
    return statusMap[status] || statusMap.pending;
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading match...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !match) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {error || "Match Not Found"}
          </h1>
          <p className="text-muted-foreground mb-6">
            The match you&apos;re looking for doesn&apos;t exist or has been removed.
          </p>
          <Button onClick={() => router.push("/tournaments")}>
            Back to Tournaments
          </Button>
        </div>
      </div>
    );
  }

  const statusDisplay = getStatusDisplay(match.status);

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

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Match Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
                Match #{match.id.slice(-4)}
              </h1>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusDisplay.bgColor} ${statusDisplay.color}`}>
                {statusDisplay.label}
              </span>
              {isConnected && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  Live
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Trophy className="h-4 w-4" />
                <span>{match.gameType}</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                <span>
                  {match.startedAt 
                    ? `Started ${new Date(match.startedAt).toLocaleTimeString()}`
                    : `Created ${new Date(match.createdAt).toLocaleTimeString()}`
                  }
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Match Score Card */}
        <Card className="p-6">
          <div className="text-center mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">Match Score</h2>
            <p className="text-sm text-muted-foreground">
              {match.status === "in_progress" 
                ? "Match is in progress - scores update in real-time"
                : match.status === "completed"
                  ? "Match has been completed"
                  : "Match is pending - waiting to start"
              }
            </p>
          </div>

          {/* Score Display */}
          <div className="flex items-center justify-center gap-4 sm:gap-12 mb-8">
            {/* Player 1 */}
            <div className={`text-center ${isPlayer1 ? 'ring-2 ring-blue-500 rounded-lg p-4' : ''}`}>
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl sm:text-3xl font-bold">
                  {player1Username.charAt(0).toUpperCase()}
                </span>
              </div>
              <p className="font-semibold text-foreground truncate max-w-[120px]">
                {player1Username}
              </p>
              {isPlayer1 && (
                <span className="text-xs text-blue-600">(You)</span>
              )}
              {match.winnerId === match.player1Id && match.status === "completed" && (
                <CheckCircle className="h-5 w-5 text-green-500 mx-auto mt-2" />
              )}
            </div>

            {/* Score */}
            <div className="text-center">
              <div className="text-4xl sm:text-6xl font-bold text-foreground">
                {match.scorePlayer1 ?? 0} - {match.scorePlayer2 ?? 0}
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                {match.status === "completed" ? "Final Score" : "Current Score"}
              </p>
            </div>

            {/* Player 2 */}
            <div className={`text-center ${isPlayer2 ? 'ring-2 ring-blue-500 rounded-lg p-4' : ''}`}>
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl sm:text-3xl font-bold">
                  {player2Username.charAt(0).toUpperCase()}
                </span>
              </div>
              <p className="font-semibold text-foreground truncate max-w-[120px]">
                {player2Username}
              </p>
              {isPlayer2 && (
                <span className="text-xs text-blue-600">(You)</span>
              )}
              {match.winnerId === match.player2Id && match.status === "completed" && (
                <CheckCircle className="h-5 w-5 text-green-500 mx-auto mt-2" />
              )}
            </div>
          </div>

          {/* Match Status Info */}
          {match.status === "completed" && match.winnerId && (
            <div className="text-center p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-lg">
              <p className="text-green-600 font-semibold">
                🎉 Winner: {match.winnerId === match.player1Id ? player1Username : player2Username}
              </p>
            </div>
          )}
        </Card>

        {/* Score Reporting Section */}
        {isParticipant && match.status === "in_progress" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* User's Score Form */}
            <ScoreReportingForm
              player1Name={player1Username}
              player2Name={player2Username}
              currentUserId={currentUserId}
              isPlayer1={isPlayer1}
              onSubmitScore={handleScoreSubmit}
              isMatchActive={match.status === "in_progress"}
              opponentScore={
                isPlayer1 
                  ? (userSubmission ? undefined : match.scorePlayer2)
                  : (userSubmission ? undefined : match.scorePlayer1)
              }
            />

            {/* Opponent's Submission Status OR Conflict Alert */}
            <div>
              {hasConflict ? (
                <ConflictAlert
                  player1Score={scoreSubmissions.find(s => s.playerId === match.player1Id)?.score || 0}
                  player2Score={scoreSubmissions.find(s => s.playerId === match.player2Id)?.score || 0}
                  player1Name={player1Username}
                  player2Name={player2Username}
                  isAdminView={false}
                />
              ) : opponentSubmission ? (
                <Card className="p-6">
                  <div className="text-center">
                    <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      Opponent Has Submitted
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      {isPlayer1 ? player2Username : player1Username} has submitted their score.
                      {userSubmission && " Waiting for match to be finalized."}
                    </p>
                  </div>
                </Card>
              ) : (
                <Card className="p-6">
                  <div className="text-center">
                    <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      Waiting for Opponent
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      {isPlayer1 ? player2Username : player1Username} hasn&apos;t submitted their score yet.
                    </p>
                  </div>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* Non-participant view */}
        {!isParticipant && match.status === "in_progress" && (
          <Card className="p-6">
            <div className="text-center">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Spectator View
              </h3>
              <p className="text-muted-foreground">
                You&apos;re watching this match as a spectator. Both players are currently competing.
              </p>
            </div>
          </Card>
        )}

        {/* Match not active */}
        {match.status !== "in_progress" && (
          <Card className="p-6">
            <div className="text-center">
              <p className="text-muted-foreground">
                {match.status === "completed" 
                  ? "This match has been completed."
                  : "This match has not started yet."
                }
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
