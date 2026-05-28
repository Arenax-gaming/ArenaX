"use client";

import React, { useState } from "react";
import { ActivityEvent } from "@/types/profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { 
  Swords, 
  Trophy, 
  Flag, 
  UserPlus, 
  Activity, 
  Filter, 
  Calendar,
  TrendingUp,
  Award,
  Target
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ActivityFeedProps {
  activities: ActivityEvent[];
}

type ActivityFilter = 'all' | 'matches' | 'achievements' | 'tournaments' | 'social';

const ACTIVITY_FILTERS: { key: ActivityFilter; label: string; icon: React.ReactNode }[] = [
  { key: 'all', label: 'All', icon: <Activity className="h-4 w-4" /> },
  { key: 'matches', label: 'Matches', icon: <Swords className="h-4 w-4" /> },
  { key: 'achievements', label: 'Achievements', icon: <Trophy className="h-4 w-4" /> },
  { key: 'tournaments', label: 'Tournaments', icon: <Flag className="h-4 w-4" /> },
  { key: 'social', label: 'Social', icon: <UserPlus className="h-4 w-4" /> },
];

function formatDate(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getActivityCategory(type: ActivityEvent['type']): ActivityFilter {
  switch (type) {
    case 'match_completed':
      return 'matches';
    case 'achievement_unlocked':
      return 'achievements';
    case 'tournament_joined':
    case 'tournament_completed':
      return 'tournaments';
    case 'friend_added':
      return 'social';
    default:
      return 'all';
  }
}

function getEventContent(event: ActivityEvent): { 
  icon: React.ReactNode; 
  text: string; 
  subtext?: string;
  color: string;
} {
  switch (event.type) {
    case "match_completed":
      const isWin = event.payload.result === 'Win';
      return {
        icon: <Swords className="h-4 w-4 flex-shrink-0" />,
        text: `${event.payload.result} vs ${event.payload.opponent}`,
        subtext: event.payload.gameType ? `${event.payload.gameType} • ${event.payload.score || 'No score'}` : undefined,
        color: isWin ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400",
      };
    case "achievement_unlocked":
      return {
        icon: <Trophy className="h-4 w-4 flex-shrink-0" />,
        text: `Unlocked: ${event.payload.achievementName}`,
        subtext: event.payload.achievementDescription as string,
        color: "text-yellow-600 dark:text-yellow-400",
      };
    case "tournament_joined":
      return {
        icon: <Flag className="h-4 w-4 flex-shrink-0" />,
        text: `Joined tournament: ${event.payload.tournamentName}`,
        subtext: event.payload.tournamentType ? `${event.payload.tournamentType} tournament` : undefined,
        color: "text-blue-600 dark:text-blue-400",
      };
    case "tournament_completed":
      return {
        icon: <Award className="h-4 w-4 flex-shrink-0" />,
        text: `Completed tournament: ${event.payload.tournamentName}`,
        subtext: event.payload.placement ? `Placed ${event.payload.placement}` : undefined,
        color: "text-purple-600 dark:text-purple-400",
      };
    case "friend_added":
      return {
        icon: <UserPlus className="h-4 w-4 flex-shrink-0" />,
        text: `Added friend: ${event.payload.friendUsername}`,
        subtext: undefined,
        color: "text-pink-600 dark:text-pink-400",
      };
    default:
      return {
        icon: <Activity className="h-4 w-4 flex-shrink-0" />,
        text: "Activity",
        color: "text-muted-foreground",
      };
  }
}

export function ActivityFeed({ activities }: ActivityFeedProps) {
  const [selectedFilter, setSelectedFilter] = useState<ActivityFilter>('all');
  const [showAll, setShowAll] = useState(false);

  const filteredActivities = activities.filter(activity => {
    if (selectedFilter === 'all') return true;
    return getActivityCategory(activity.type) === selectedFilter;
  });

  const sorted = [...filteredActivities].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const displayedActivities = showAll ? sorted : sorted.slice(0, 10);
  const hasMore = sorted.length > 10;

  // Group activities by date for better organization
  const groupedActivities = displayedActivities.reduce((groups, activity) => {
    const date = new Date(activity.timestamp).toDateString();
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(activity);
    return groups;
  }, {} as Record<string, ActivityEvent[]>);

  const activityCounts = ACTIVITY_FILTERS.reduce((counts, filter) => {
    if (filter.key === 'all') {
      counts[filter.key] = activities.length;
    } else {
      counts[filter.key] = activities.filter(a => getActivityCategory(a.type) === filter.key).length;
    }
    return counts;
  }, {} as Record<ActivityFilter, number>);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Recent Activity
          </span>
          <span className="text-sm font-normal text-muted-foreground">
            {filteredActivities.length} event{filteredActivities.length !== 1 ? 's' : ''}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Activity Filters */}
        <div className="flex flex-wrap gap-1 mb-4">
          {ACTIVITY_FILTERS.map((filter) => (
            <Button
              key={filter.key}
              variant={selectedFilter === filter.key ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedFilter(filter.key)}
              className="h-8 px-3 text-xs"
            >
              {filter.icon}
              <span className="ml-1">{filter.label}</span>
              {activityCounts[filter.key] > 0 && (
                <span className="ml-1 text-xs opacity-70">
                  ({activityCounts[filter.key]})
                </span>
              )}
            </Button>
          ))}
        </div>

        {sorted.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            {selectedFilter === 'all' ? "No recent activity" : `No ${selectedFilter} activity`}
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedActivities).map(([date, dayActivities]) => (
              <div key={date}>
                {/* Date Header */}
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">
                    {new Date(date).toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                {/* Activities for this date */}
                <div className="space-y-2 ml-6">
                  {dayActivities.map((activity) => {
                    const { icon, text, subtext, color } = getEventContent(activity);
                    return (
                      <div
                        key={activity.id}
                        data-testid="activity-item"
                        className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors group"
                      >
                        <div className={cn("mt-0.5", color)}>
                          {icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{text}</span>
                            <span
                              data-testid="activity-timestamp"
                              data-ts={activity.timestamp}
                              className="text-xs text-muted-foreground whitespace-nowrap"
                            >
                              {formatDate(activity.timestamp)}
                            </span>
                          </div>
                          {subtext && (
                            <p className="text-xs text-muted-foreground mt-1">{subtext}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Show More Button */}
            {hasMore && !showAll && (
              <div className="text-center pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAll(true)}
                >
                  Show More Activities
                </Button>
              </div>
            )}

            {showAll && hasMore && (
              <div className="text-center pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAll(false)}
                >
                  Show Less
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
