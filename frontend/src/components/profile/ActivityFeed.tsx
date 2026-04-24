"use client";

import React from "react";
import { ActivityEvent } from "@/types/profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Swords, Trophy, Flag, UserPlus, Activity } from "lucide-react";

interface ActivityFeedProps {
  activities: ActivityEvent[];
}

function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getEventContent(event: ActivityEvent): { icon: React.ReactNode; text: string } {
  switch (event.type) {
    case "match_completed":
      return {
        icon: <Swords className="h-4 w-4 text-blue-500 flex-shrink-0" />,
        text: `vs ${event.payload.opponent} — ${event.payload.result}`,
      };
    case "achievement_unlocked":
      return {
        icon: <Trophy className="h-4 w-4 text-yellow-500 flex-shrink-0" />,
        text: `Unlocked: ${event.payload.achievementName}`,
      };
    case "tournament_joined":
      return {
        icon: <Flag className="h-4 w-4 text-green-500 flex-shrink-0" />,
        text: `Joined tournament: ${event.payload.tournamentName}`,
      };
    case "tournament_completed":
      return {
        icon: <Flag className="h-4 w-4 text-purple-500 flex-shrink-0" />,
        text: `Completed tournament: ${event.payload.tournamentName}`,
      };
    case "friend_added":
      return {
        icon: <UserPlus className="h-4 w-4 text-pink-500 flex-shrink-0" />,
        text: `Added friend: ${event.payload.friendUsername}`,
      };
    default:
      return {
        icon: <Activity className="h-4 w-4 text-muted-foreground flex-shrink-0" />,
        text: "Activity",
      };
  }
}

export function ActivityFeed({ activities }: ActivityFeedProps) {
  const sorted = [...activities].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No recent activity</p>
        ) : (
          <div className="space-y-2">
            {sorted.map((activity) => {
              const { icon, text } = getEventContent(activity);
              return (
                <div
                  key={activity.id}
                  data-testid="activity-item"
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  {icon}
                  <span className="flex-1 text-sm">{text}</span>
                  <span
                    data-testid="activity-timestamp"
                    data-ts={activity.timestamp}
                    className="text-xs text-muted-foreground whitespace-nowrap"
                  >
                    {formatDate(activity.timestamp)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
