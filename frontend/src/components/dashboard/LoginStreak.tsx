"use client";

/**
 * Daily login streak tracker (Issue #899).
 *
 * The dashboard had no engagement surface at all — nothing told a player they
 * were on day six of a run, or what showing up tomorrow was worth. This is
 * that surface: the counter, the milestones, what it takes to keep the streak,
 * a three-month heat map, and the redemption UI for rewards earned.
 */

import { useMemo } from "react";
import { Flame, Gift, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  HISTORY_DAYS,
  MILESTONES,
  MILESTONE_REWARDS,
  useLoginStreak,
  type Milestone,
  type StreakDay,
} from "@/hooks/useLoginStreak";

/** Weekday labels down the side of the heat map, Mon/Wed/Fri only. */
const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

function hoursUntil(target: Date): number {
  return Math.max(0, Math.ceil((target.getTime() - Date.now()) / 3_600_000));
}

/**
 * The next milestone the player is working toward, or null once all are hit.
 */
function nextMilestone(current: number): Milestone | null {
  return MILESTONES.find((m) => current < m) ?? null;
}

function StreakSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-12 w-24 animate-pulse rounded bg-muted" />
        <div className="h-20 w-full animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

/**
 * Three months of activity, one column per week.
 *
 * Columns are weeks and rows are weekdays, so a player reads their own pattern
 * — "I always miss Tuesdays" — rather than an undifferentiated grid.
 */
function CalendarHeatMap({ calendar }: { calendar: StreakDay[] }) {
  const weeks = useMemo(() => {
    if (calendar.length === 0) return [] as (StreakDay | null)[][];

    // Pad the first week so day-of-week lines up with the row index.
    const firstDay = new Date(`${calendar[0]!.date}T00:00:00`).getDay();
    const leading = (firstDay + 6) % 7; // Monday-first
    const cells: (StreakDay | null)[] = [
      ...Array.from({ length: leading }, () => null),
      ...calendar,
    ];

    const grouped: (StreakDay | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      grouped.push(cells.slice(i, i + 7));
    }
    return grouped;
  }, [calendar]);

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        Last {Math.round(HISTORY_DAYS / 7)} weeks
      </p>
      <div className="flex gap-1 overflow-x-auto pb-1">
        <div className="flex shrink-0 flex-col gap-[3px] pr-1">
          {WEEKDAY_LABELS.map((label, i) => (
            <span
              key={i}
              className="h-[11px] text-[9px] leading-[11px] text-muted-foreground"
            >
              {label}
            </span>
          ))}
        </div>

        {weeks.map((week, wi) => (
          <div key={wi} className="flex shrink-0 flex-col gap-[3px]">
            {Array.from({ length: 7 }, (_, di) => {
              const day = week[di] ?? null;
              if (!day) {
                return <span key={di} className="h-[11px] w-[11px]" />;
              }
              return (
                <span
                  key={di}
                  title={`${day.date}${day.visited ? " — played" : ""}`}
                  aria-label={`${day.date}${day.visited ? ", played" : ", no activity"}`}
                  className={cn(
                    "h-[11px] w-[11px] rounded-[2px]",
                    day.visited ? "bg-orange-500" : "bg-muted"
                  )}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LoginStreak() {
  const {
    current,
    longest,
    claimable,
    claimed,
    calendar,
    expiresAt,
    loading,
    claimReward,
  } = useLoginStreak();

  if (loading) return <StreakSkeleton />;

  const next = nextMilestone(current);
  const hoursLeft = hoursUntil(expiresAt);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Flame
              className={cn(
                "h-4 w-4",
                current > 0 ? "text-orange-500" : "text-muted-foreground"
              )}
              aria-hidden="true"
            />
            Login streak
          </CardTitle>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
            Best {longest}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Counter */}
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-extrabold tabular-nums">{current}</span>
          <span className="text-sm text-muted-foreground">
            {current === 1 ? "day" : "days"} in a row
          </span>
        </div>

        {/* Maintenance info — what it takes to keep it */}
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          {current === 0 ? (
            <>Play today to start a streak. Miss a day and it resets to zero.</>
          ) : (
            <>
              Open ArenaX before midnight to keep it going —{" "}
              <span className="font-medium text-foreground">
                {hoursLeft} {hoursLeft === 1 ? "hour" : "hours"} left
              </span>
              . {next ? `${next - current} more to reach day ${next}.` : "Every milestone reached."}
            </>
          )}
        </p>

        {/* Milestones */}
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Milestones</p>
          <ul className="flex flex-col gap-2">
            {MILESTONES.map((milestone) => {
              const reward = MILESTONE_REWARDS[milestone];
              const isClaimed = claimed.includes(milestone);
              const isClaimable = claimable.includes(milestone);
              const progress = Math.min(current / milestone, 1);

              return (
                <li key={milestone} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span
                        className={cn(
                          "font-medium",
                          current >= milestone ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        Day {milestone} · {reward.label}
                      </span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {reward.coins} coins
                      </span>
                    </div>
                    <div
                      className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuenow={Math.min(current, milestone)}
                      aria-valuemin={0}
                      aria-valuemax={milestone}
                      aria-label={`Progress to day ${milestone}`}
                    >
                      <div
                        className="h-full rounded-full bg-orange-500 transition-all"
                        style={{ width: `${progress * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Redemption */}
                  {isClaimed ? (
                    <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
                      Claimed
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant={isClaimable ? "primary" : "ghost"}
                      className="h-7 shrink-0 gap-1 px-2 text-xs"
                      disabled={!isClaimable}
                      onClick={() => claimReward(milestone)}
                      aria-label={
                        isClaimable
                          ? `Claim ${reward.coins} coins for the day ${milestone} streak`
                          : `Reach day ${milestone} to claim ${reward.coins} coins`
                      }
                    >
                      <Gift className="h-3 w-3" aria-hidden="true" />
                      Claim
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <CalendarHeatMap calendar={calendar} />
      </CardContent>
    </Card>
  );
}

export default LoginStreak;
