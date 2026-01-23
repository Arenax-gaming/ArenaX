import React, { useMemo } from "react";
import { Tournament } from "@/types/tournament";
import { Card } from "@/components/ui/Card";
import { Users, Trophy, Zap } from "lucide-react";

interface TournamentParticipantsProps {
  tournament: Tournament;
}

// Mock participant data
const generateMockParticipants = (gameType: string, count: number) => {
  const firstNames = [
    "Alex",
    "Jordan",
    "Casey",
    "Morgan",
    "Riley",
    "Avery",
    "Sam",
    "Taylor",
    "Quinn",
    "River",
    "Blake",
    "Drew",
  ];
  const lastNames = [
    "Pro",
    "Elite",
    "Gaming",
    "Storm",
    "Shadow",
    "Phoenix",
    "Dragon",
    "Titan",
    "Nexus",
    "Void",
  ];

  const participants = [];
  for (let i = 0; i < count; i++) {
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    const username = `${firstName}${lastName}${Math.floor(Math.random() * 1000)}`;

    participants.push({
      id: `participant-${i + 1}`,
      username,
      rank: i + 1,
      joinedAt: new Date(
        Date.now() - Math.random() * 86400000 * 7,
      ).toISOString(),
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
      rating: Math.floor(Math.random() * 500) + 1000,
    });
  }

  return participants;
};

export function TournamentParticipants({
  tournament,
}: TournamentParticipantsProps) {
  const participants = useMemo(() => {
    return generateMockParticipants(
      tournament.gameType,
      tournament.currentParticipants,
    );
  }, [tournament.gameType, tournament.currentParticipants]);

  const isFull = tournament.currentParticipants >= tournament.maxParticipants;
  const availableSlots =
    tournament.maxParticipants - tournament.currentParticipants;

  return (
    <Card className="border-0 shadow-none p-0">
      <div className="border-b p-6 md:p-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
              Participants
            </h2>
            <p className="text-muted-foreground">
              {tournament.currentParticipants} of {tournament.maxParticipants}{" "}
              slots filled
              {!isFull && (
                <span className="text-green-600 dark:text-green-400 font-medium">
                  {" "}
                  • {availableSlots} spot{availableSlots > 1 ? "s" : ""}{" "}
                  available
                </span>
              )}
              {isFull && (
                <span className="text-red-600 dark:text-red-400 font-medium">
                  {" "}
                  • Tournament is full
                </span>
              )}
            </p>
          </div>
          <Users className="h-8 w-8 text-muted-foreground" />
        </div>
      </div>

      {/* Participants List */}
      <div className="p-6 md:p-8">
        <div className="space-y-3">
          {/* List Header */}
          <div className="grid grid-cols-12 gap-4 mb-4 px-4">
            <div className="col-span-6 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Player
            </div>
            <div className="col-span-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Rating
            </div>
            <div className="col-span-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Joined
            </div>
          </div>

          {/* Participants */}
          {participants.map((participant, index) => {
            const joinedDate = new Date(participant.joinedAt);
            const daysAgo = Math.floor(
              (Date.now() - joinedDate.getTime()) / (1000 * 60 * 60 * 24),
            );
            const timeLabel =
              daysAgo === 0
                ? "Today"
                : daysAgo === 1
                  ? "Yesterday"
                  : `${daysAgo}d ago`;

            return (
              <div
                key={participant.id}
                className="grid grid-cols-12 gap-4 items-center p-4 bg-card border rounded-lg hover:shadow-md transition-shadow"
              >
                {/* Rank and User */}
                <div className="col-span-6 flex items-center gap-3">
                  {/* Rank */}
                  <div className="flex items-center justify-center h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex-shrink-0">
                    <span className="text-white text-xs font-bold">
                      {index + 1}
                    </span>
                  </div>

                  {/* Avatar and Username */}
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {/* Avatar Placeholder */}
                    <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex-shrink-0 flex items-center justify-center text-white text-xs font-bold">
                      {participant.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {participant.username}
                      </p>
                      {index === 0 && (
                        <div className="flex items-center gap-1">
                          <Trophy className="h-3 w-3 text-amber-500" />
                          <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                            Tournament Creator
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Rating */}
                <div className="col-span-3 flex items-center gap-1">
                  <Zap className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                  <span className="text-sm font-semibold text-foreground">
                    {participant.rating.toLocaleString()}
                  </span>
                </div>

                {/* Joined Date */}
                <div className="col-span-3 text-right">
                  <span className="text-sm text-muted-foreground">
                    {timeLabel}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Available Slots Info */}
        {!isFull && (
          <div className="mt-6 p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-lg">
            <p className="text-sm text-green-900 dark:text-green-100">
              <span className="font-semibold">
                {availableSlots} spot{availableSlots > 1 ? "s" : ""} available!
              </span>{" "}
              Join now to secure your place in this tournament.
            </p>
          </div>
        )}

        {isFull && (
          <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg">
            <p className="text-sm text-amber-900 dark:text-amber-100">
              <span className="font-semibold">Tournament is full.</span> All
              player slots are currently taken. Join the waitlist to be notified
              if a spot opens up.
            </p>
          </div>
        )}
      </div>

      {/* Stats Footer */}
      <div className="grid grid-cols-3 gap-4 p-6 md:p-8 bg-card border-t">
        <div className="text-center">
          <p className="text-2xl font-bold text-foreground">
            {tournament.currentParticipants}
          </p>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mt-1">
            Players Joined
          </p>
        </div>
        <div className="text-center border-l border-r">
          <p className="text-2xl font-bold text-foreground">
            {tournament.maxParticipants}
          </p>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mt-1">
            Max Participants
          </p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-foreground">
            {Math.round(
              (tournament.currentParticipants / tournament.maxParticipants) *
                100,
            )}
            %
          </p>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mt-1">
            Filled
          </p>
        </div>
      </div>
    </Card>
  );
}
