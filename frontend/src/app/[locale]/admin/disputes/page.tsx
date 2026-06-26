"use client";

import React, { useState, useCallback } from "react";
import Image from "next/image";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ProtectedPage } from "@/components/navigation/ProtectedPage";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { Dispute, ResolveDisputePayload } from "@/types/admin";
import { PageHeaderSkeleton, ListItemSkeleton } from "@/components/common/PageSkeleton";
import { PageError } from "@/components/common/PageError";
import { EmptyState } from "@/components/common/EmptyState";
import {
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  User,
  Clock,
  Gamepad2,
} from "lucide-react";

// ─── Status badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colours: Record<string, string> = {
    OPEN: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
    RESOLVED: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    DISMISSED: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
    VOIDED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  };
  return (
    <span
      className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
        colours[status] ?? colours.OPEN
      }`}
    >
      {status}
    </span>
  );
}

// ─── Per-player score report row ─────────────────────────────────────────────

function ScoreReportRow({
  username,
  playerId,
  score,
  reportedAt,
}: {
  username: string;
  playerId: string;
  score: number;
  reportedAt: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50 text-sm">
      <div className="flex items-center gap-2">
        <User className="h-4 w-4 text-muted-foreground shrink-0" />
        <div>
          <p className="font-semibold">{username}</p>
          <p className="text-xs text-muted-foreground font-mono truncate max-w-[180px]">
            {playerId}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className="font-bold text-base">{score}</p>
        <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
          <Clock className="h-3 w-3" />
          {new Date(reportedAt).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

// ─── Dispute resolution form ─────────────────────────────────────────────────

interface ResolveFormProps {
  dispute: Dispute;
  onResolve: (id: string, payload: ResolveDisputePayload) => void;
  isPending: boolean;
}

function ResolveForm({ dispute, onResolve, isPending }: ResolveFormProps) {
  const [winner, setWinner] = useState<"A" | "B" | "void" | null>(null);
  const [note, setNote] = useState("");

  const handleSubmit = () => {
    if (!winner) return;
    const payload: ResolveDisputePayload =
      winner === "void"
        ? { status: "VOIDED", resolution: note || "Match voided by admin" }
        : {
            status: "RESOLVED",
            resolution: note || `Admin declared winner`,
            winnerOverrideId:
              winner === "A"
                ? dispute.match.playerAId
                : dispute.match.playerBId,
          };
    onResolve(dispute.id, payload);
  };

  const playerALabel =
    dispute.match.playerAUsername ?? `Player A (${dispute.match.playerAId.slice(0, 8)}…)`;
  const playerBLabel =
    dispute.match.playerBUsername ?? `Player B (${dispute.match.playerBId.slice(0, 8)}…)`;

  const options: Array<{ value: "A" | "B" | "void"; label: string; colour: string }> = [
    {
      value: "A",
      label: `${playerALabel} wins`,
      colour:
        winner === "A"
          ? "border-primary bg-primary/10 text-primary"
          : "border-border hover:border-primary/50",
    },
    {
      value: "B",
      label: `${playerBLabel} wins`,
      colour:
        winner === "B"
          ? "border-primary bg-primary/10 text-primary"
          : "border-border hover:border-primary/50",
    },
    {
      value: "void",
      label: "Void the match",
      colour:
        winner === "void"
          ? "border-destructive bg-destructive/10 text-destructive"
          : "border-border hover:border-destructive/50",
    },
  ];

  return (
    <div className="space-y-4 pt-4 border-t border-border mt-4">
      <h4 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">
        Resolution
      </h4>

      {/* Winner / Void selection */}
      <div
        role="radiogroup"
        aria-label="Select outcome"
        className="grid sm:grid-cols-3 gap-2"
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            role="radio"
            aria-checked={winner === opt.value}
            onClick={() => setWinner(opt.value)}
            className={`text-sm font-medium py-2 px-3 rounded-lg border-2 transition-colors text-left ${opt.colour}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Resolution note */}
      <div>
        <label
          htmlFor={`note-${dispute.id}`}
          className="block text-sm font-medium mb-1"
        >
          Resolution note{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Input
          id={`note-${dispute.id}`}
          placeholder="Describe your decision…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <Button
        variant="primary"
        onClick={handleSubmit}
        disabled={!winner || isPending}
        className="w-full sm:w-auto"
        aria-busy={isPending}
      >
        {isPending ? "Saving…" : "Confirm resolution"}
      </Button>
    </div>
  );
}

// ─── Dispute row (collapsible) ────────────────────────────────────────────────

interface DisputeRowProps {
  dispute: Dispute;
  onResolve: (id: string, payload: ResolveDisputePayload) => void;
  resolvingId: string | null;
}

function DisputeRow({ dispute, onResolve, resolvingId }: DisputeRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isPending = resolvingId === dispute.id;

  const matchShort = dispute.match.onChainId.slice(0, 12) + "…";
  const reportedAt = dispute.createdAt
    ? new Date(dispute.createdAt).toLocaleString()
    : "—";

  const playerALabel =
    dispute.match.playerAUsername ?? `Player A`;
  const playerBLabel =
    dispute.match.playerBUsername ?? `Player B`;

  const alreadyClosed = ["RESOLVED", "DISMISSED", "VOIDED"].includes(
    dispute.status
  );

  return (
    <Card className="overflow-hidden border-2 border-border shadow transition-shadow duration-200 hover:shadow-md">
      {/* Summary row — always visible */}
      <CardHeader className="bg-muted/30 dark:bg-muted/10 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* Left: match info */}
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base font-bold truncate">
                Match {matchShort}
              </CardTitle>
              <StatusBadge status={dispute.status} />
            </div>
            <CardDescription className="text-xs flex flex-wrap gap-x-4 gap-y-1">
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                <strong>Reporter:</strong>&nbsp;{dispute.reporter.username}
              </span>
              <span className="flex items-center gap-1">
                <Gamepad2 className="h-3 w-3" />
                {playerALabel} vs {playerBLabel}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {reportedAt}
              </span>
            </CardDescription>
          </div>

          {/* Right: expand toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={`dispute-details-${dispute.id}`}
            className="shrink-0 self-start sm:self-center"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-4 w-4 mr-1" aria-hidden="true" />
                Collapse
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-1" aria-hidden="true" />
                Expand
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      {/* Expanded detail panel */}
      {expanded && (
        <CardContent
          id={`dispute-details-${dispute.id}`}
          className="p-6 space-y-6"
        >
          <div className="grid md:grid-cols-2 gap-6">
            {/* Left column: reason + evidence */}
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">
                  Dispute reason
                </h4>
                <p className="text-sm bg-muted/50 rounded-lg p-3 leading-relaxed">
                  {dispute.reason}
                </p>
              </div>

              {dispute.evidenceUrls.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">
                    Evidence ({dispute.evidenceUrls.length})
                  </h4>
                  <div className="grid grid-cols-3 gap-2">
                    {dispute.evidenceUrls.map((url, idx) => (
                      <a
                        key={idx}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="aspect-square bg-muted rounded-md overflow-hidden border relative block hover:opacity-80 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        aria-label={`Evidence ${idx + 1} (opens in new tab)`}
                      >
                        <Image
                          src={url}
                          alt={`Evidence ${idx + 1}`}
                          fill
                          className="object-cover"
                          sizes="(max-width: 768px) 33vw, 15vw"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right column: per-player score reports */}
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">
                  Submitted scores
                </h4>
                <div className="space-y-2">
                  {dispute.match.scoreReports && dispute.match.scoreReports.length > 0 ? (
                    dispute.match.scoreReports.map((report) => (
                      <ScoreReportRow
                        key={report.playerId}
                        username={report.username}
                        playerId={report.playerId}
                        score={report.reportedScore}
                        reportedAt={report.reportedAt}
                      />
                    ))
                  ) : (
                    <>
                      <ScoreReportRow
                        username={dispute.match.playerAUsername ?? "Player A"}
                        playerId={dispute.match.playerAId}
                        score={0}
                        reportedAt={dispute.createdAt ?? new Date().toISOString()}
                      />
                      <ScoreReportRow
                        username={dispute.match.playerBUsername ?? "Player B"}
                        playerId={dispute.match.playerBId}
                        score={0}
                        reportedAt={dispute.createdAt ?? new Date().toISOString()}
                      />
                    </>
                  )}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">
                  Match details
                </h4>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-muted-foreground">On-chain ID</dt>
                  <dd className="font-mono truncate" title={dispute.match.onChainId}>
                    {dispute.match.onChainId.slice(0, 16)}…
                  </dd>
                  {dispute.match.gameType && (
                    <>
                      <dt className="text-muted-foreground">Game type</dt>
                      <dd>{dispute.match.gameType}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Reported winner</dt>
                  <dd className="font-semibold">
                    {dispute.match.winnerId === dispute.match.playerAId
                      ? playerALabel
                      : playerBLabel}
                  </dd>
                </dl>
              </div>
            </div>
          </div>

          {/* Resolution form — only for open disputes */}
          {!alreadyClosed && (
            <ResolveForm
              dispute={dispute}
              onResolve={onResolve}
              isPending={isPending}
            />
          )}

          {alreadyClosed && (
            <p className="text-sm text-muted-foreground italic">
              This dispute has already been {dispute.status.toLowerCase()}.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DisputeDashboard() {
  const queryClient = useQueryClient();
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const {
    data: disputes = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<Dispute[]>({
    queryKey: ["admin", "disputes"],
    queryFn: async () => {
      const data = await api.getDisputes();
      return data as Dispute[];
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: ResolveDisputePayload;
    }) => {
      setResolvingId(id);
      return api.resolveDispute(id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "disputes"] });
    },
    onError: (err) => {
      alert("Failed to resolve dispute: " + (err as Error).message);
    },
    onSettled: () => {
      setResolvingId(null);
    },
  });

  const handleResolve = useCallback(
    (id: string, payload: ResolveDisputePayload) => {
      resolveMutation.mutate({ id, payload });
    },
    [resolveMutation]
  );

  const openCount = disputes.filter((d) => d.status === "OPEN").length;

  if (isLoading) {
    return (
      <ProtectedPage requiredRole="admin">
        <div className="container mx-auto p-6 space-y-8">
          <PageHeaderSkeleton />
          <div className="grid gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <ListItemSkeleton key={i} />
            ))}
          </div>
        </div>
      </ProtectedPage>
    );
  }

  if (isError) {
    return (
      <ProtectedPage requiredRole="admin">
        <div className="container mx-auto p-6">
          <PageError
            title="Failed to load disputes"
            message="Could not reach the disputes API. Please try again."
            onRetry={() => refetch()}
          />
        </div>
      </ProtectedPage>
    );
  }

  return (
    <ProtectedPage requiredRole="admin">
      <div className="container mx-auto p-6 space-y-8">
        {/* Page header */}
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl text-foreground">
              Dispute Resolution
            </h1>
            {openCount > 0 && (
              <span
                className="px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 text-sm font-bold"
                aria-label={`${openCount} open disputes`}
              >
                {openCount} open
              </span>
            )}
          </div>
          <p className="text-xl text-muted-foreground">
            Review evidence and resolve match disputes fairly.
          </p>
        </header>

        {/* Dispute list */}
        <div className="grid gap-4" role="list" aria-label="Disputes">
          {disputes.length === 0 ? (
            <EmptyState
              icon={ShieldAlert}
              title="No disputes"
              description="There are no disputes requiring review at this time."
              size="lg"
            />
          ) : (
            disputes.map((dispute) => (
              <div key={dispute.id} role="listitem">
                <DisputeRow
                  dispute={dispute}
                  onResolve={handleResolve}
                  resolvingId={resolvingId}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </ProtectedPage>
  );
}
