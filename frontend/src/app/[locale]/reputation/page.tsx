"use client";

import React, { useState } from "react";
import { Shield, ShieldCheck, ShieldAlert, Star, TrendingUp, TrendingDown, Clock, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ProtectedPage } from "@/components/navigation/ProtectedPage";
import { ReputationBadge } from "@/components/profile/ReputationBadge";
import { useMyReputation, useReputationHistory, TIER_CONFIG } from "@/hooks/useReputation";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Skeleton loaders
// ---------------------------------------------------------------------------

function ScoreSkeleton() {
  return (
    <Card>
      <CardContent className="p-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <div className="h-24 w-24 rounded-full bg-muted animate-pulse shrink-0" />
          <div className="flex-1 space-y-3">
            <div className="h-6 w-40 bg-muted rounded animate-pulse" />
            <div className="h-4 w-64 bg-muted rounded animate-pulse" />
            <div className="flex gap-4">
              <div className="h-16 w-28 bg-muted rounded-lg animate-pulse" />
              <div className="h-16 w-28 bg-muted rounded-lg animate-pulse" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HistorySkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="h-5 w-40 bg-muted rounded animate-pulse" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 py-2">
            <div className="h-8 w-8 rounded-full bg-muted animate-pulse shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-48 bg-muted rounded animate-pulse" />
              <div className="h-3 w-24 bg-muted rounded animate-pulse" />
            </div>
            <div className="h-5 w-16 bg-muted rounded animate-pulse" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Fair-play score ring
// ---------------------------------------------------------------------------

function ScoreRing({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.min(100, Math.round((score / max) * 100));
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  const color =
    pct >= 80 ? "stroke-yellow-500" :
    pct >= 60 ? "stroke-green-500" :
    pct >= 40 ? "stroke-blue-500" :
    "stroke-red-500";

  return (
    <div className="relative h-24 w-24 shrink-0" aria-label={`Fair play score: ${score} out of ${max}`}>
      <svg className="h-24 w-24 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} strokeWidth="8" className="fill-none stroke-muted" />
        <circle
          cx="50" cy="50" r={radius}
          strokeWidth="8"
          className={cn("fill-none transition-all duration-700", color)}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-black tabular-nums">{score}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">/ {max}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History event row
// ---------------------------------------------------------------------------

const EVENT_TYPE_LABELS: Record<string, string> = {
  match_win: "Match Win",
  match_loss: "Match Loss",
  dispute_filed: "Dispute Filed",
  dispute_resolved: "Dispute Resolved",
  cheat_flag: "Anti-Cheat Flag",
  manual_adjustment: "Manual Adjustment",
  appeal_approved: "Appeal Approved",
};

function HistoryRow({ event }: { event: { event_type: string; skill_delta: number; fair_play_delta: number; created_at: string } }) {
  const label = EVENT_TYPE_LABELS[event.event_type] ?? event.event_type;
  const isPositive = event.fair_play_delta > 0 || event.skill_delta > 0;
  const isNegative = event.fair_play_delta < 0 || event.skill_delta < 0;

  return (
    <div className="flex items-center gap-4 py-2.5 border-b last:border-0">
      <div
        className={cn(
          "h-8 w-8 rounded-full flex items-center justify-center shrink-0",
          isPositive ? "bg-green-500/10" : isNegative ? "bg-red-500/10" : "bg-muted"
        )}
      >
        {isPositive ? (
          <TrendingUp className="h-4 w-4 text-green-500" />
        ) : isNegative ? (
          <TrendingDown className="h-4 w-4 text-red-500" />
        ) : (
          <Clock className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {new Date(event.created_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </div>
      <div className="text-right shrink-0 space-y-0.5">
        {event.skill_delta !== 0 && (
          <p className={cn("text-xs font-mono font-semibold", event.skill_delta > 0 ? "text-green-500" : "text-red-500")}>
            {event.skill_delta > 0 ? "+" : ""}{event.skill_delta} skill
          </p>
        )}
        {event.fair_play_delta !== 0 && (
          <p className={cn("text-xs font-mono font-semibold", event.fair_play_delta > 0 ? "text-green-500" : "text-red-500")}>
            {event.fair_play_delta > 0 ? "+" : ""}{event.fair_play_delta} fp
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReputationPage() {
  const { user } = useAuth();
  const [historyPage, setHistoryPage] = useState(1);

  const {
    data: reputation,
    isLoading: repLoading,
    isError: repError,
    refetch: refetchRep,
  } = useMyReputation();

  const {
    data: history,
    isLoading: histLoading,
    isError: histError,
    refetch: refetchHist,
  } = useReputationHistory(user?.id ?? "", historyPage);

  const tier = reputation?.tier ?? "average";
  const tierConfig = TIER_CONFIG[tier];

  return (
    <ProtectedPage>
      <div className="max-w-3xl mx-auto py-6 space-y-6 animate-in fade-in duration-300">

        {/* Page title */}
        <div>
          <h1 className="text-3xl font-black tracking-tight">Reputation</h1>
          <p className="text-muted-foreground mt-1">
            Your fair play standing and performance history on the platform.
          </p>
        </div>

        {/* Score card */}
        {repLoading ? (
          <ScoreSkeleton />
        ) : repError ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">Could not load reputation data — please try again.</p>
              <Button variant="outline" size="sm" onClick={() => refetchRep()} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : reputation ? (
          <Card className={cn("border-2", tierConfig.bgColor)}>
            <CardContent className="p-8">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                <ScoreRing score={reputation.fair_play_score} />

                <div className="flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-2xl font-black">
                      {user?.username ?? "Your"} Reputation
                    </h2>
                    <ReputationBadge tier={tier} score={reputation.fair_play_score} />
                  </div>

                  <p className="text-sm text-muted-foreground">{tierConfig.description}</p>

                  <div className="flex flex-wrap gap-4 mt-2">
                    <div className="bg-background/60 px-4 py-2 rounded-lg border">
                      <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
                        Skill Score
                      </p>
                      <p className="text-xl font-black">{reputation.skill_score}</p>
                    </div>
                    <div className="bg-background/60 px-4 py-2 rounded-lg border">
                      <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
                        Fair Play
                      </p>
                      <p className="text-xl font-black">{reputation.fair_play_score}</p>
                    </div>
                    {reputation.is_bad_actor && (
                      <div className="bg-red-500/10 px-4 py-2 rounded-lg border border-red-500/30">
                        <p className="text-[10px] uppercase font-bold text-red-500 tracking-widest">
                          Status
                        </p>
                        <p className="text-sm font-semibold text-red-500">Flagged</p>
                      </div>
                    )}
                  </div>

                  {reputation.last_updated && (
                    <p className="text-xs text-muted-foreground">
                      Last updated:{" "}
                      {new Date(reputation.last_updated).toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Tier guide */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Reputation Tiers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(["elite", "good", "average", "poor"] as const).map((t) => {
                const cfg = TIER_CONFIG[t];
                return (
                  <div
                    key={t}
                    className={cn(
                      "p-3 rounded-lg border text-center space-y-1",
                      cfg.bgColor,
                      tier === t && "ring-2 ring-offset-1 ring-current"
                    )}
                  >
                    <p className={cn("text-sm font-bold", cfg.color)}>{cfg.label}</p>
                    <p className="text-xs text-muted-foreground leading-snug">{cfg.description}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* History */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">History</CardTitle>
              {history && (
                <span className="text-xs text-muted-foreground">
                  {history.total} event{history.total !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {histLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 py-2.5">
                    <div className="h-8 w-8 rounded-full bg-muted animate-pulse shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-48 bg-muted rounded animate-pulse" />
                      <div className="h-3 w-24 bg-muted rounded animate-pulse" />
                    </div>
                    <div className="h-5 w-16 bg-muted rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : histError ? (
              <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  Could not load history — please try again.
                </p>
                <Button variant="outline" size="sm" onClick={() => refetchHist()} className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Retry
                </Button>
              </div>
            ) : history && history.data.length > 0 ? (
              <>
                {history.data.map((event) => (
                  <HistoryRow key={event.id} event={event} />
                ))}

                {/* Pagination */}
                {history.total > history.per_page && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={historyPage <= 1}
                      onClick={() => setHistoryPage((p) => p - 1)}
                      className="gap-1"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Page {historyPage} of {Math.ceil(history.total / history.per_page)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={historyPage >= Math.ceil(history.total / history.per_page)}
                      onClick={() => setHistoryPage((p) => p + 1)}
                      className="gap-1"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No reputation events yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </ProtectedPage>
  );
}
