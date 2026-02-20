import React from "react";
import Link from "next/link";
import { Tournament, TournamentStatus } from "@/types/tournament";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Users, Trophy, Clock, Zap } from "lucide-react";

interface TournamentCardProps {
  tournament: Tournament;
  isJoined?: boolean;
  onQuickJoin?: () => void;
}

const statusConfig: Record<
  TournamentStatus,
  { label: string; color: string; bgColor: string }
> = {
  draft: {
    label: "Draft",
    color: "text-gray-600",
    bgColor: "bg-gray-100 dark:bg-gray-800",
  },
  registration_open: {
    label: "Registration Open",
    color: "text-green-600",
    bgColor: "bg-green-100 dark:bg-green-900",
  },
  registration_closed: {
    label: "Registration Closed",
    color: "text-orange-600",
    bgColor: "bg-orange-100 dark:bg-orange-900",
  },
  in_progress: {
    label: "Ongoing",
    color: "text-blue-600",
    bgColor: "bg-blue-100 dark:bg-blue-900",
  },
  completed: {
    label: "Completed",
    color: "text-purple-600",
    bgColor: "bg-purple-100 dark:bg-purple-900",
  },
  cancelled: {
    label: "Cancelled",
    color: "text-red-600",
    bgColor: "bg-red-100 dark:bg-red-900",
  },
};

export function TournamentCard({ tournament, isJoined = false, onQuickJoin }: TournamentCardProps) {
  const status = statusConfig[tournament.status];
  const participantPercentage = Math.round(
    (tournament.currentParticipants / tournament.maxParticipants) * 100,
  );
  const isFull = tournament.currentParticipants >= tournament.maxParticipants;
  const canJoin = tournament.status === "registration_open" && !isFull && !isJoined;

  return (
    <Card className="flex flex-col overflow-hidden transition-shadow hover:shadow-lg">
      {/* Header with Status */}
      <div className="flex items-start justify-between border-b p-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold line-clamp-2 text-foreground">
            {tournament.name}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {tournament.gameType}
          </p>
        </div>
        <span
          className={`ml-2 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap ${status.bgColor} ${status.color}`}
        >
          {status.label}
        </span>
      </div>

      {/* Details */}
      <div className="flex-1 p-4 space-y-3">
        {/* Description */}
        {tournament.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {tournament.description}
          </p>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          {/* Entry Fee */}
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Entry Fee</p>
              <p className="text-sm font-semibold text-foreground">
                {tournament.entryFee === 0 ? "Free" : `$${tournament.entryFee}`}
              </p>
            </div>
          </div>

          {/* Prize Pool */}
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Prize Pool</p>
              <p className="text-sm font-semibold text-foreground">
                ${tournament.prizePool.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Start Time */}
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Starts</p>
              <p className="text-sm font-semibold text-foreground">
                {new Date(tournament.startTime).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </div>
          </div>

          {/* Participants */}
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Players</p>
              <p className="text-sm font-semibold text-foreground">
                {tournament.currentParticipants}/{tournament.maxParticipants}
              </p>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="pt-2">
          <div className="flex justify-between items-center mb-1">
            <p className="text-xs text-muted-foreground">Filled</p>
            <p className="text-xs font-medium text-foreground">
              {participantPercentage}%
            </p>
          </div>
          <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                isFull ? "bg-orange-500" : "bg-blue-500"
              }`}
              style={{ width: `${participantPercentage}%` }}
            />
          </div>
        </div>
      </div>

      {/* Footer with Button */}
      <div className="border-t p-4">
        {isJoined ? (
          // Already joined - show "Joined" button that links to details
          <Link href={`/tournaments/${tournament.id}`} className="block">
            <Button
              variant="secondary"
              size="md"
              className="w-full"
            >
              View Details
            </Button>
          </Link>
        ) : canJoin && onQuickJoin ? (
          // Can join and has quick join handler - show Quick Join button
          <div className="space-y-2">
            <Button
              variant="primary"
              size="md"
              className="w-full"
              onClick={(e) => {
                e.preventDefault();
                onQuickJoin();
              }}
            >
              Quick Join
            </Button>
            <Link href={`/tournaments/${tournament.id}`} className="block">
              <Button
                variant="outline"
                size="md"
                className="w-full"
              >
                View Details
              </Button>
            </Link>
          </div>
        ) : (
          // Default state
          <Link href={`/tournaments/${tournament.id}`} className="block">
            <Button
              variant={canJoin ? "primary" : "outline"}
              size="md"
              className="w-full"
              disabled={!canJoin}
            >
              {isFull
                ? "Tournament Full"
                : canJoin
                  ? "Join Tournament"
                  : "View Details"}
            </Button>
          </Link>
        )}
      </div>
    </Card>
  );
}
