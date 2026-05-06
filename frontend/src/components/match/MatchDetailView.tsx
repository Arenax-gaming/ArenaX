"use client";

import React from "react";
import Link from "next/link";
import { MatchDetail, MatchRound, PlayerStats } from "@/types/match";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  Trophy,
  TrendingUp,
  ShieldAlert,
  Calendar,
  Clock,
  Target,
  Zap,
  Crosshair,
  DollarSign,
  Flag,
  Play,
  ArrowLeft,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface MatchDetailViewProps {
  match: MatchDetail;
  currentUserId?: string;
  onReportIssue?: () => void;
}

export function MatchDetailView({ match, currentUserId, onReportIssue }: MatchDetailViewProps) {
  const isWinner = match.winnerId === currentUserId;
  const player1Won = match.winnerId === match.player1Id;
  const player2Won = match.winnerId === match.player2Id;

  return (
    <div className="space-y-6">
      {/* Match Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">{match.tournamentName}</CardTitle>
              <p className="text-muted-foreground mt-1">
                {match.gameType} • {match.completedAt ? new Date(match.completedAt).toLocaleDateString() : "In Progress"}
              </p>
            </div>
            <div className="flex gap-2">
              {match.replayUrl && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={match.replayUrl}>
                    <Play className="h-4 w-4 mr-2" />
                    Watch Replay
                  </Link>
                </Button>
              )}
              {match.canDispute && (
                <Button variant="destructive" size="sm" onClick={onReportIssue}>
                  <Flag className="h-4 w-4 mr-2" />
                  Report Issue
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-6 bg-muted/50 rounded-lg">
            <div className={cn("text-center flex-1", player1Won ? "text-green-600 dark:text-green-400" : "")}>
              <p className="text-2xl font-bold">{match.player1Username}</p>
              <p className="text-4xl font-bold mt-2">{match.scorePlayer1}</p>
              {player1Won && <Trophy className="h-6 w-6 mx-auto mt-2" />}
            </div>
            <div className="px-8 text-center">
              <p className="text-muted-foreground text-sm uppercase tracking-wider">VS</p>
              <p className="text-lg font-semibold mt-1">{match.format || "Best of Series"}</p>
            </div>
            <div className={cn("text-center flex-1", player2Won ? "text-green-600 dark:text-green-400" : "")}>
              <p className="text-2xl font-bold">{match.player2Username}</p>
              <p className="text-4xl font-bold mt-2">{match.scorePlayer2}</p>
              {player2Won && <Trophy className="h-6 w-6 mx-auto mt-2" />}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Round-by-Round Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Round-by-Round Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {match.rounds?.map((round) => (
                <RoundRow key={round.roundNumber} round={round} player1Name={match.player1Username} player2Name={match.player2Username} />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Score Progression Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Score Progression
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScoreProgressionChart match={match} />
          </CardContent>
        </Card>
      </div>

      {/* Player Statistics */}
      <div className="grid gap-6 lg:grid-cols-2">
        {match.player1Stats && (
          <PlayerStatsCard stats={match.player1Stats} isWinner={player1Won} />
        )}
        {match.player2Stats && (
          <PlayerStatsCard stats={match.player2Stats} isWinner={player2Won} />
        )}
      </div>

      {/* Match Information */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Rules and Format */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Match Rules & Format
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Format</p>
              <p className="text-lg font-semibold">{match.format || "Standard"}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Rules</p>
              <p className="text-sm">{match.rules || "Standard competitive rules apply"}</p>
            </div>
            {match.disputeDeadline && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Dispute Deadline</p>
                <p className="text-sm flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  {new Date(match.disputeDeadline).toLocaleString()}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Prize Distribution */}
        {match.prizeDistribution && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Prize Distribution
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <div className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-green-600" />
                  <span className="font-medium">Winner</span>
                </div>
                <span className="text-xl font-bold text-green-600">
                  {match.prizeDistribution.currency || "$"}{match.prizeDistribution.winner.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">Runner-up</span>
                </div>
                <span className="text-xl font-bold">
                  {match.prizeDistribution.currency || "$"}{match.prizeDistribution.loser.toLocaleString()}
                </span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Tournament Bracket Link */}
      {match.tournamentBracketId && (
        <Card>
          <CardContent className="pt-6">
            <Button variant="outline" className="w-full" asChild>
              <Link href={`/tournaments/${match.tournamentId}/bracket`}>
                <Trophy className="h-4 w-4 mr-2" />
                View Tournament Bracket
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RoundRow({ round, player1Name, player2Name }: { round: MatchRound; player1Name: string; player2Name: string }) {
  const winnerColor = round.winner === "player1" ? "text-green-600 dark:text-green-400" : round.winner === "player2" ? "text-blue-600 dark:text-blue-400" : "";
  const winnerBg = round.winner === "player1" ? "bg-green-50 dark:bg-green-900/20" : round.winner === "player2" ? "bg-blue-50 dark:bg-blue-900/20" : "";

  return (
    <div className={cn("flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors", winnerBg)}>
      <div className="flex items-center gap-3 flex-1">
        <span className="text-sm font-medium text-muted-foreground w-8">R{round.roundNumber}</span>
        <span className={cn("font-semibold", round.winner === "player1" ? winnerColor : "")}>{round.scorePlayer1}</span>
        <span className="text-muted-foreground">-</span>
        <span className={cn("font-semibold", round.winner === "player2" ? winnerColor : "")}>{round.scorePlayer2}</span>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {round.duration && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {Math.floor(round.duration / 60)}:{(round.duration % 60).toString().padStart(2, "0")}
          </span>
        )}
        {round.keyEvents && round.keyEvents.length > 0 && (
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3" />
            {round.keyEvents[0]}
          </span>
        )}
      </div>
    </div>
  );
}

function ScoreProgressionChart({ match }: { match: MatchDetail }) {
  if (!match.scoreProgression || match.scoreProgression.length === 0) {
    return <p className="text-muted-foreground text-center py-8">No score progression data available</p>;
  }

  const maxScore = Math.max(...match.scoreProgression.map((p) => Math.max(p.scorePlayer1, p.scorePlayer2)));
  const chartHeight = 200;
  const padding = 20;

  return (
    <div className="relative">
      <svg width="100%" height={chartHeight} className="overflow-visible">
        {/* Grid lines */}
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={i}
            x1="0"
            y1={padding + (i * (chartHeight - 2 * padding)) / 4}
            x2="100%"
            y2={padding + (i * (chartHeight - 2 * padding)) / 4}
            stroke="currentColor"
            strokeWidth="1"
            className="text-muted opacity-20"
          />
        ))}

        {/* Player 1 line */}
        <polyline
          fill="none"
          stroke="rgb(34 197 94)"
          strokeWidth="2"
          points={match.scoreProgression
            .map((p, i) => {
              const x = (i / (match.scoreProgression!.length - 1)) * 100;
              const y = chartHeight - padding - (p.scorePlayer1 / maxScore) * (chartHeight - 2 * padding);
              return `${x}% ${y}`;
            })
            .join(" ")}
        />

        {/* Player 2 line */}
        <polyline
          fill="none"
          stroke="rgb(59 130 246)"
          strokeWidth="2"
          points={match.scoreProgression
            .map((p, i) => {
              const x = (i / (match.scoreProgression!.length - 1)) * 100;
              const y = chartHeight - padding - (p.scorePlayer2 / maxScore) * (chartHeight - 2 * padding);
              return `${x}% ${y}`;
            })
            .join(" ")}
        />

        {/* Data points for player 1 */}
        {match.scoreProgression.map((p, i) => {
          const x = (i / (match.scoreProgression!.length - 1)) * 100;
          const y = chartHeight - padding - (p.scorePlayer1 / maxScore) * (chartHeight - 2 * padding);
          return (
            <circle
              key={`p1-${i}`}
              cx={`${x}%`}
              cy={y}
              r="3"
              fill="rgb(34 197 94)"
              className="hover:r-4 transition-all cursor-pointer"
            />
          );
        })}

        {/* Data points for player 2 */}
        {match.scoreProgression.map((p, i) => {
          const x = (i / (match.scoreProgression!.length - 1)) * 100;
          const y = chartHeight - padding - (p.scorePlayer2 / maxScore) * (chartHeight - 2 * padding);
          return (
            <circle
              key={`p2-${i}`}
              cx={`${x}%`}
              cy={y}
              r="3"
              fill="rgb(59 130 246)"
              className="hover:r-4 transition-all cursor-pointer"
            />
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span className="text-sm">{match.player1Username}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-blue-500" />
          <span className="text-sm">{match.player2Username}</span>
        </div>
      </div>
    </div>
  );
}

function PlayerStatsCard({ stats, isWinner }: { stats: PlayerStats; isWinner: boolean }) {
  return (
    <Card className={isWinner ? "border-green-200 dark:border-green-800" : "")}>
      <CardHeader>
        <CardTitle className={cn("flex items-center gap-2", isWinner ? "text-green-600 dark:text-green-400" : "")}>
          {isWinner && <Trophy className="h-5 w-5" />}
          {stats.username}
          {isWinner && <span className="text-sm font-normal">(Winner)</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <StatItem icon={Target} label="K/D" value={`${stats.kills ?? 0}/${stats.deaths ?? 0}`} />
          <StatItem icon={Zap} label="Assists" value={stats.assists ?? 0} />
          <StatItem icon={Crosshair} label="Accuracy" value={`${stats.accuracy ?? 0}%`} />
          <StatItem icon={Target} label="Headshot %" value={`${stats.headshotRate ?? 0}%`} />
          {stats.economy !== undefined && <StatItem icon={DollarSign} label="Economy" value={`$${stats.economy.toLocaleString()}`} />}
          {stats.utilityDamage !== undefined && <StatItem icon={Zap} label="Utility DMG" value={stats.utilityDamage} />}
          {stats.firstBloods !== undefined && <StatItem icon={Zap} label="First Bloods" value={stats.firstBloods} />}
          {stats.clutches !== undefined && <StatItem icon={ShieldAlert} label="Clutches" value={stats.clutches} />}
        </div>
      </CardContent>
    </Card>
  );
}

function StatItem({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number | string }) {
  return (
    <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div className="flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-semibold">{value}</p>
      </div>
    </div>
  );
}
