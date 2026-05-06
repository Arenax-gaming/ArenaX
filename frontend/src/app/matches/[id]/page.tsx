"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/hooks/useAuth";
import {
  useMatchScoreReporting,
  useMatchWebSocket,
} from "@/hooks/useMatchWebSocket";
import { matchHubDetails } from "@/data/matchHub";
import { mockMatchDetails } from "@/data/matches";
import { MatchDetailView } from "@/components/match/MatchDetailView";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  RadioTower,
  RefreshCw,
  ShieldAlert,
  Trophy,
  User,
  Wifi,
  WifiOff,
} from "lucide-react";
import { formatDate } from "@/lib/utils";

export default function MatchHubPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const matchId = params.id as string;
  const currentUserId = user?.id ?? "user-123";

  const [match, setMatch] = useState(matchHubDetails[matchId] ?? null);
  const [matchDetail, setMatchDetail] = useState(mockMatchDetails[matchId] ?? null);
  const [player1Score, setPlayer1Score] = useState("");
  const [player2Score, setPlayer2Score] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [liveFeed, setLiveFeed] = useState(match?.feed ?? []);

  useEffect(() => {
    const hubDetails = matchHubDetails[matchId] ?? null;
    const detailData = mockMatchDetails[matchId] ?? null;
    setMatch(hubDetails);
    setMatchDetail(detailData);
    setLiveFeed(hubDetails?.feed ?? []);
  }, [matchId]);

  useEffect(() => {
    if (!match) {
      return;
    }

    setPlayer1Score(String(match.scorePlayer1));
    setPlayer2Score(String(match.scorePlayer2));
  }, [match]);

  const { isConnected, lastUpdate, connectionError, reconnect } = useMatchWebSocket({
    matchId,
    enabled: match?.status === "in_progress" || match?.status === "disputed",
  });

  const expectedOpponentReport = useMemo(() => {
    if (!match?.reports.length) {
      return null;
    }

    return (
      match.reports.find((report) => report.reporterId !== currentUserId) ??
      match.reports[0]
    );
  }, [currentUserId, match?.reports]);

  const {
    reportScore,
    pendingReport,
    isReporting,
    conflictDetected,
    conflictingReport,
    clearConflict,
  } = useMatchScoreReporting({
    expectedReport: match?.status === "disputed" ? expectedOpponentReport : undefined,
  });

  const isParticipant = useMemo(() => {
    if (!match) {
      return false;
    }

    return match.player1.id === currentUserId || match.player2.id === currentUserId;
  }, [currentUserId, match]);

  useEffect(() => {
    if (!lastUpdate) {
      return;
    }

    setMatch((previous) =>
      previous
        ? {
          ...previous,
          status: lastUpdate.status ?? previous.status,
          scorePlayer1: lastUpdate.scorePlayer1 ?? previous.scorePlayer1,
          scorePlayer2: lastUpdate.scorePlayer2 ?? previous.scorePlayer2,
          winnerId: lastUpdate.winnerId ?? previous.winnerId,
        }
        : previous,
    );

    if (typeof lastUpdate.scorePlayer1 === "number") {
      setPlayer1Score(String(lastUpdate.scorePlayer1));
    }
    if (typeof lastUpdate.scorePlayer2 === "number") {
      setPlayer2Score(String(lastUpdate.scorePlayer2));
    }

    if (lastUpdate.message) {
      setLiveFeed((previous) => [
        {
          id: `live-${lastUpdate.timestamp}`,
          type: lastUpdate.status === "disputed" ? "alert" : "score",
          message: lastUpdate.message!,
          createdAt: new Date(lastUpdate.timestamp).toISOString(),
        },
        ...previous,
      ]);
    }
  }, [lastUpdate]);

  if (!match && !matchDetail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center">
          <h1 className="mb-2 text-3xl font-bold text-foreground">Match Not Found</h1>
          <p className="mb-6 text-muted-foreground">
            The match you&apos;re looking for doesn&apos;t exist.
          </p>
          <Button onClick={() => router.push("/tournaments")}>Back to Tournaments</Button>
        </div>
      </div>
    );
  }

  // Show detailed view for completed matches with detailed data
  if (matchDetail && matchDetail.status === "completed") {
    return (
      <div className="min-h-screen bg-background px-4 py-8">
        <div className="mx-auto max-w-7xl">
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
          <MatchDetailView
            match={matchDetail}
            currentUserId={currentUserId}
            onReportIssue={() => {
              // Handle report issue - could open a modal or navigate to dispute form
              router.push(`/matches/${matchId}/dispute`);
            }}
          />
        </div>
      </div>
    );
  }

  const isLive = match.status === "in_progress";
  const isDisputed = match.status === "disputed";
  const submissionLocked =
    !isParticipant || (!isLive && !isDisputed) || !player1Score.length || !player2Score.length;

  const handleSubmitScore = async () => {
    const nextPlayer1Score = Number(player1Score);
    const nextPlayer2Score = Number(player2Score);

    if (Number.isNaN(nextPlayer1Score) || Number.isNaN(nextPlayer2Score)) {
      return;
    }

    const success = await reportScore({
      matchId: match.id,
      player1Score: nextPlayer1Score,
      player2Score: nextPlayer2Score,
      reporterId: currentUserId,
      reporterName: user?.username ?? "You",
    });

    if (!success) {
      setLiveFeed((previous) => [
        {
          id: `conflict-${Date.now()}`,
          type: "alert",
          message: "Your submission conflicts with the opponent report. ArenaX flagged the series for review.",
          createdAt: new Date().toISOString(),
        },
        ...previous,
      ]);
      return;
    }

    setSubmitted(true);
    setLiveFeed((previous) => [
      {
        id: `submit-${Date.now()}`,
        type: "report",
        message: "Your score report has been submitted and is waiting for final confirmation.",
        createdAt: new Date().toISOString(),
      },
      ...previous,
    ]);
    setTimeout(() => setSubmitted(false), 2200);
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_rgba(248,250,252,1),_rgba(241,245,249,1))] px-4 py-8">
      <div className="mx-auto max-w-7xl">
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

        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
          <section className="space-y-6">
            <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_30%),linear-gradient(135deg,_rgba(15,23,42,1),_rgba(30,41,59,0.96))] p-6 text-white shadow-[0_30px_80px_-45px_rgba(14,165,233,0.7)]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-cyan-200/70">
                    Match Hub
                  </p>
                  <h1 className="mt-2 text-3xl font-semibold">{match.tournamentName}</h1>
                  <p className="mt-2 text-sm text-slate-300">
                    {match.gameType} | {match.roundLabel} | {match.bestOf > 0 ? `Best of ${match.bestOf}` : "Series"}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <ConnectionPill isConnected={isConnected} active={isLive || isDisputed} />
                  <StatusPill status={match.status} />
                </div>
              </div>

              {connectionError ? (
                <div className="mt-4 flex items-center justify-between rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  <span>{connectionError}</span>
                  <Button variant="ghost" size="sm" onClick={reconnect} className="text-white hover:bg-white/10">
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}

              <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto_1fr]">
                <CompetitorCard
                  player={match.player1}
                  score={match.scorePlayer1}
                  isWinner={match.winnerId === match.player1.id}
                  isCurrentUser={match.player1.id === currentUserId}
                />
                <div className="flex items-center justify-center">
                  <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-300">
                    VS
                  </div>
                </div>
                <CompetitorCard
                  player={match.player2}
                  score={match.scorePlayer2}
                  isWinner={match.winnerId === match.player2.id}
                  isCurrentUser={match.player2.id === currentUserId}
                />
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <HubStat label="Scheduled" value={formatDate(match.scheduledTime)} />
                <HubStat label="Arena" value={match.arenaLabel} />
                <HubStat label="Broadcast" value={match.streamTitle ?? "ArenaX Feed"} />
                <HubStat label="Dispute Window" value={formatDate(match.canDisputeUntil)} />
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <RadioTower className="h-4 w-4 text-cyan-600" />
                  Real-Time Event Feed
                </div>
                <div className="mt-5 space-y-3">
                  {liveFeed.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <EventTypeBadge type={event.type} />
                        <span className="text-xs text-slate-500">
                          {formatDate(event.createdAt)}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-700">{event.message}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Trophy className="h-4 w-4 text-amber-500" />
                  Match Context
                </div>
                <div className="mt-5 space-y-4 text-sm text-slate-700">
                  <InfoRow label="Tournament" value={match.tournamentName} href={`/tournaments/${match.tournamentId}`} />
                  <InfoRow label="Bracket Type" value={match.bracketFormat.replace(/_/g, " ")} />
                  <InfoRow label="Prize Pool" value={`$${match.prizePool.toLocaleString()}`} />
                  <InfoRow label="Series Notes" value={match.notes} />
                </div>
              </div>
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldAlert className="h-4 w-4 text-rose-500" />
                Dual Score Reporting
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Both players submit the same final score. ArenaX compares reports in real time and pauses progression if they disagree.
              </p>

              {isDisputed ? (
                <div className="mt-5 rounded-2xl border border-rose-300 bg-rose-50 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-rose-600" />
                    <div className="text-sm">
                      <p className="font-semibold text-rose-900">Conflict detected</p>
                      <p className="mt-1 text-rose-800">
                        ArenaX received mismatched reports. Submit your verified score or escalate with evidence.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {conflictDetected && conflictingReport ? (
                <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-semibold">Submission conflict</p>
                  <p className="mt-2">
                    Opponent report from {conflictingReport.reporterName}:{" "}
                    {conflictingReport.player1Score} - {conflictingReport.player2Score}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={clearConflict}>
                      Review Again
                    </Button>
                    <Button size="sm" variant="outline">
                      Escalate to Admin
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-900">
                    {match.player1.username} Score
                  </label>
                  <Input
                    type="number"
                    min="0"
                    value={player1Score}
                    onChange={(event) => setPlayer1Score(event.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-900">
                    {match.player2.username} Score
                  </label>
                  <Input
                    type="number"
                    min="0"
                    value={player2Score}
                    onChange={(event) => setPlayer2Score(event.target.value)}
                  />
                </div>
              </div>

              <div className="mt-5 grid gap-3">
                <Button
                  onClick={handleSubmitScore}
                  disabled={submissionLocked || isReporting || submitted}
                  className="w-full"
                >
                  {submitted ? (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Report Submitted
                    </>
                  ) : isReporting ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Validating Report
                    </>
                  ) : (
                    "Submit Verified Score"
                  )}
                </Button>
                <Button variant="outline" className="w-full">
                  Open Dispute Evidence Flow
                </Button>
              </div>

              {pendingReport ? (
                <div className="mt-5 rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-900">
                  Latest submission by {pendingReport.reporterName}: {pendingReport.player1Score} -{" "}
                  {pendingReport.player2Score}
                </div>
              ) : null}
            </div>

            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <User className="h-4 w-4 text-slate-700" />
                Submitted Reports
              </div>
              <div className="mt-5 space-y-3">
                {match.reports.map((report) => (
                  <div
                    key={`${report.reporterId}-${report.submittedAt}`}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{report.reporterName}</p>
                        <p className="text-xs text-slate-500">
                          {formatDate(report.submittedAt)}
                        </p>
                      </div>
                      <p className="text-lg font-semibold text-slate-900">
                        {report.player1Score} - {report.player2Score}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function ConnectionPill({
  isConnected,
  active,
}: {
  isConnected: boolean;
  active: boolean;
}) {
  if (!active) {
    return (
      <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
        Feed idle
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm ${isConnected ? "bg-emerald-400/15 text-emerald-200" : "bg-rose-400/15 text-rose-100"
        }`}
    >
      {isConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
      {isConnected ? "Live relay connected" : "Relay reconnecting"}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const className =
    status === "in_progress"
      ? "bg-emerald-400/15 text-emerald-200"
      : status === "disputed"
        ? "bg-rose-400/15 text-rose-100"
        : status === "completed"
          ? "bg-cyan-400/15 text-cyan-100"
          : "bg-white/10 text-white";

  return (
    <div className={`rounded-full px-4 py-2 text-sm font-medium capitalize ${className}`}>
      {status.replace("_", " ")}
    </div>
  );
}

function CompetitorCard({
  player,
  score,
  isWinner,
  isCurrentUser,
}: {
  player: (typeof matchHubDetails)[string]["player1"];
  score: number;
  isWinner: boolean;
  isCurrentUser: boolean;
}) {
  return (
    <div
      className={`rounded-[28px] border p-5 ${isWinner ? "border-emerald-400/40 bg-emerald-400/10" : "border-white/10 bg-white/5"
        }`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5">
            <User className="h-6 w-6 text-slate-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-lg font-semibold">{player.username}</p>
              {isCurrentUser ? (
                <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[11px] text-cyan-100">
                  You
                </span>
              ) : null}
            </div>
            <p className="text-sm text-slate-400">
              Seed {player.seed} | {player.region} | ELO {player.elo}
            </p>
          </div>
        </div>
        <p className="text-5xl font-semibold">{score}</p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {player.stats.map((stat) => (
          <div
            key={`${player.id}-${stat.label}`}
            className="rounded-2xl border border-white/10 bg-black/10 px-3 py-2"
          >
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
              {stat.label}
            </p>
            <p className="mt-1 text-sm font-medium text-white">{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function HubStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400">{label}</p>
      <p className="mt-2 text-sm font-medium text-white">{value}</p>
    </div>
  );
}

function EventTypeBadge({ type }: { type: string }) {
  const classes =
    type === "alert"
      ? "bg-rose-100 text-rose-700"
      : type === "report"
        ? "bg-cyan-100 text-cyan-700"
        : type === "score"
          ? "bg-emerald-100 text-emerald-700"
          : "bg-slate-200 text-slate-700";

  return (
    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${classes}`}>
      {type}
    </span>
  );
}

function InfoRow({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="border-b border-slate-200 pb-4 last:border-b-0 last:pb-0">
      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{label}</p>
      {href ? (
        <Link href={href} className="mt-2 inline-block font-medium text-cyan-700 hover:underline">
          {value}
        </Link>
      ) : (
        <p className="mt-2 font-medium text-slate-900">{value}</p>
      )}
    </div>
  );
}
