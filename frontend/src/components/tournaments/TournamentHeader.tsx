import React from "react";
import { Tournament, TournamentStatus } from "@/types/tournament";
import { Card } from "@/components/ui/Card";
import { Trophy, Users, Calendar, Zap } from "lucide-react";

interface TournamentHeaderProps {
  tournament: Tournament;
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

export function TournamentHeader({ tournament }: TournamentHeaderProps) {
  const status = statusConfig[tournament.status];
  const startDate = new Date(tournament.startTime);
  const participantPercentage = Math.round(
    (tournament.currentParticipants / tournament.maxParticipants) * 100,
  );
  const isFull = tournament.currentParticipants >= tournament.maxParticipants;

  const formattedDate = startDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const formattedTime = startDate.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  return (
    <Card className="border-0 shadow-none p-0">
      {/* Header Background */}
      <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border-b p-6 md:p-8 rounded-lg">
        <div className="space-y-4">
          {/* Status Badge */}
          <div>
            <span
              className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-medium ${status.bgColor} ${status.color}`}
            >
              {status.label}
            </span>
          </div>

          {/* Title and Game Type */}
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">
              {tournament.name}
            </h1>
            <p className="text-lg text-muted-foreground">
              {tournament.gameType}
            </p>
          </div>

          {/* Description */}
          {tournament.description && (
            <p className="text-muted-foreground max-w-2xl">
              {tournament.description}
            </p>
          )}
        </div>
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6 bg-card border-t">
        {/* Prize Pool */}
        <div className="flex items-start gap-3">
          <Trophy className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Prize Pool
            </p>
            <p className="text-lg font-bold text-foreground">
              ${tournament.prizePool.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Entry Fee */}
        <div className="flex items-start gap-3">
          <Zap className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Entry Fee
            </p>
            <p className="text-lg font-bold text-foreground">
              {tournament.entryFee === 0 ? "Free" : `$${tournament.entryFee}`}
            </p>
          </div>
        </div>

        {/* Start Date */}
        <div className="flex items-start gap-3">
          <Calendar className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Start Date
            </p>
            <p className="text-sm font-semibold text-foreground">
              {formattedDate}
            </p>
            <p className="text-xs text-muted-foreground">{formattedTime}</p>
          </div>
        </div>

        {/* Participants */}
        <div className="flex items-start gap-3">
          <Users className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Participants
            </p>
            <p className="text-lg font-bold text-foreground">
              {tournament.currentParticipants}/{tournament.maxParticipants}
            </p>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-1">
              <div
                className={`h-1.5 rounded-full transition-all ${
                  isFull ? "bg-red-500" : "bg-green-500"
                }`}
                style={{ width: `${participantPercentage}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
