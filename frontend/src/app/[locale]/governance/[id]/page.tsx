"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatDistanceToNow, format } from "date-fns";
import {
  ArrowLeft,
  Scale,
  Clock,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Vote,
  AlertCircle,
  Terminal,
  User,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageError } from "@/components/common/PageError";
import { CardSkeleton, PageHeaderSkeleton } from "@/components/common/PageSkeleton";
import { VoteBreakdownChart } from "@/components/governance/VoteBreakdownChart";
import { VoteModal } from "@/components/governance/VoteModal";
import { useAuth } from "@/hooks/useAuth";
import { useProposal, useVoteOnProposal } from "@/hooks/useGovernance";
import { cn } from "@/lib/utils";
import {
  isVotable,
  PROPOSAL_STATUS_LABELS,
  type VoteChoice,
} from "@/types/governance";

// ---------------------------------------------------------------------------
// Status badge config (mirrors ProposalCard)
// ---------------------------------------------------------------------------
const STATUS_BADGE_CLASS: Record<string, string> = {
  PENDING:
    "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-400/30",
  APPROVED:
    "bg-green-500/15 text-green-700 dark:text-green-300 border-green-400/30",
  EXECUTED:
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-400/30",
  CANCELLED: "text-muted-foreground",
  FAILED: "",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  PENDING: <Clock className="h-3.5 w-3.5" aria-hidden="true" />,
  APPROVED: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />,
  EXECUTED: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />,
  CANCELLED: <XCircle className="h-3.5 w-3.5" aria-hidden="true" />,
  FAILED: <XCircle className="h-3.5 w-3.5" aria-hidden="true" />,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-0.5 sm:gap-4 py-3 border-b last:border-0">
      <dt className="text-sm font-medium text-muted-foreground sm:w-40 shrink-0">
        {label}
      </dt>
      <dd className="text-sm text-foreground break-all">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function ProposalDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { user } = useAuth();
  const { data: proposal, isLoading, isError, refetch } = useProposal(id);
  const voteMutation = useVoteOnProposal();

  const [voteModalOpen, setVoteModalOpen] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Loading / error states
  // ---------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeaderSkeleton />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <CardSkeleton lines={5} />
            <CardSkeleton lines={4} />
          </div>
          <div className="space-y-4">
            <CardSkeleton lines={3} hasFooter />
            <CardSkeleton lines={4} />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !proposal) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <PageError
          title="Proposal not found"
          message="We couldn't load this proposal. It may have been removed or the ID is incorrect."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------
  const hasVoted =
    !!user?.id &&
    Array.isArray(proposal.approvers) &&
    proposal.approvers.includes(user.id);

  const votable = isVotable(proposal);
  const canVote = !!user && votable && !hasVoted;

  const badgeClass =
    STATUS_BADGE_CLASS[proposal.status] ?? STATUS_BADGE_CLASS.PENDING;
  const statusLabel =
    PROPOSAL_STATUS_LABELS[proposal.status] ?? proposal.status;
  const statusIcon = STATUS_ICONS[proposal.status];

  const breakdown = proposal.vote_breakdown ?? {
    yes: proposal.approval_count ?? 0,
    no: 0,
    abstain: 0,
  };

  const title = proposal.description
    ? proposal.description.split("\n")[0].slice(0, 120)
    : proposal.function;

  const fullDescription =
    proposal.description && proposal.description.includes("\n")
      ? proposal.description.split("\n").slice(1).join("\n").trim()
      : null;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const handleVote = async (choice: VoteChoice) => {
    setVoteError(null);
    try {
      await voteMutation.mutateAsync({ id: proposal.id, choice });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to submit vote.";
      setVoteError(msg);
      throw err;
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Back nav */}
      <Link
        href="/governance"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Governance
      </Link>

      {/* Title row */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="space-y-1 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Scale className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
            <Badge
              variant="outline"
              className={cn("inline-flex items-center gap-1 text-xs", badgeClass)}
            >
              {statusIcon}
              {statusLabel}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight leading-snug">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">
            Proposed{" "}
            {formatDistanceToNow(new Date(proposal.created_at), {
              addSuffix: true,
            })}
          </p>
        </div>

        {/* Vote CTA */}
        {canVote && (
          <Button
            className="gap-2 shrink-0"
            onClick={() => setVoteModalOpen(true)}
          >
            <Vote className="h-4 w-4" aria-hidden="true" />
            Cast Vote
          </Button>
        )}
        {!user && votable && (
          <Link href="/login">
            <Button variant="outline" className="gap-2 shrink-0 w-full sm:w-auto">
              Log in to vote
            </Button>
          </Link>
        )}
      </div>

      {/* Vote error banner */}
      {voteError && (
        <div
          className="flex items-start gap-2 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          {voteError}
          <button
            className="ml-auto text-destructive/70 hover:text-destructive"
            onClick={() => setVoteError(null)}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* Already voted notice */}
      {hasVoted && (
        <div
          className="flex items-center gap-2 rounded-md border border-green-400/30 bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-300"
          role="note"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          You have already voted on this proposal.
        </div>
      )}

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT — description + vote breakdown */}
        <div className="lg:col-span-2 space-y-6">
          {/* Description */}
          {fullDescription && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                  {fullDescription}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Vote breakdown */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Vote Breakdown</CardTitle>
              <CardDescription>
                Current vote distribution across all participants
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VoteBreakdownChart
                yes={breakdown.yes}
                no={breakdown.no}
                abstain={breakdown.abstain}
              />

              {/* Approvers list */}
              {Array.isArray(proposal.approvers) &&
                proposal.approvers.length > 0 && (
                  <div className="mt-6 space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Approvers ({proposal.approvers.length})
                    </h3>
                    <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {proposal.approvers.map((addr) => (
                        <li
                          key={addr}
                          className="flex items-center gap-2 text-xs font-mono text-muted-foreground"
                        >
                          <User
                            className="h-3 w-3 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="truncate">{addr}</span>
                          {addr === user?.id && (
                            <Badge variant="outline" className="text-[10px] ml-auto shrink-0">
                              You
                            </Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
            </CardContent>
          </Card>

          {/* Args */}
          {proposal.args &&
            Object.keys(proposal.args).length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Terminal className="h-4 w-4" aria-hidden="true" />
                    Function Arguments
                  </CardTitle>
                  <CardDescription>
                    Arguments passed to{" "}
                    <code className="font-mono text-xs bg-muted px-1 rounded">
                      {proposal.function}()
                    </code>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="rounded-md bg-muted p-4 text-xs font-mono overflow-x-auto text-foreground/80 leading-relaxed">
                    {JSON.stringify(proposal.args, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            )}
        </div>

        {/* RIGHT — metadata sidebar */}
        <div className="space-y-4">
          {/* Proposal metadata */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="p-0 px-6 pb-6">
              <dl>
                <MetaRow label="Status">
                  <Badge
                    variant="outline"
                    className={cn(
                      "inline-flex items-center gap-1 text-xs",
                      badgeClass
                    )}
                  >
                    {statusIcon}
                    {statusLabel}
                  </Badge>
                </MetaRow>

                <MetaRow label="Proposal ID">
                  <span className="font-mono text-xs break-all">
                    {proposal.proposal_id ?? proposal.id}
                  </span>
                </MetaRow>

                <MetaRow label="Target contract">
                  <span className="font-mono text-xs break-all">
                    {proposal.target_contract}
                  </span>
                </MetaRow>

                <MetaRow label="Function">
                  <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                    {proposal.function}()
                  </code>
                </MetaRow>

                <MetaRow label="Proposer">
                  <span className="font-mono text-xs break-all">
                    {proposal.proposer}
                  </span>
                </MetaRow>

                <MetaRow label="Created">
                  {format(
                    new Date(proposal.created_at),
                    "MMM d, yyyy 'at' HH:mm"
                  )}
                </MetaRow>

                {proposal.execute_after && (
                  <MetaRow label="Earliest execution">
                    {format(
                      new Date(proposal.execute_after),
                      "MMM d, yyyy 'at' HH:mm"
                    )}
                  </MetaRow>
                )}

                {proposal.executed_at && (
                  <MetaRow label="Executed at">
                    {format(
                      new Date(proposal.executed_at),
                      "MMM d, yyyy 'at' HH:mm"
                    )}
                  </MetaRow>
                )}

                {proposal.last_chain_tx && (
                  <MetaRow label="Last chain tx">
                    <a
                      href={`https://stellar.expert/explorer/public/tx/${proposal.last_chain_tx}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline font-mono text-xs break-all"
                    >
                      {proposal.last_chain_tx.slice(0, 18)}…
                      <ExternalLink
                        className="h-3 w-3 shrink-0"
                        aria-label="View on Stellar Expert (opens in new tab)"
                      />
                    </a>
                  </MetaRow>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* Discussion link placeholder */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Discussion</CardTitle>
              <CardDescription>
                Community discussion for this proposal
              </CardDescription>
            </CardHeader>
            <CardContent>
              <a
                href={`https://github.com/dark-sarge/ArenaX/discussions?q=${encodeURIComponent(proposal.proposal_id ?? proposal.id)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  View on GitHub Discussions
                </Button>
              </a>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Vote modal */}
      <VoteModal
        isOpen={voteModalOpen}
        onClose={() => setVoteModalOpen(false)}
        proposalTitle={title}
        onConfirm={handleVote}
      />
    </div>
  );
}
