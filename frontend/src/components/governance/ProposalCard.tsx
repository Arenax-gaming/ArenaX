"use client";

import React, { useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Vote, Clock, ChevronRight, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { Proposal, VoteChoice } from "@/types/governance";
import { isVotable, PROPOSAL_STATUS_LABELS } from "@/types/governance";
import { VoteBreakdownChart } from "./VoteBreakdownChart";
import { VoteModal } from "./VoteModal";

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<
  string,
  { variant: "default" | "secondary" | "outline" | "destructive"; className: string }
> = {
  PENDING: {
    variant: "default",
    className: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-400/30",
  },
  APPROVED: {
    variant: "secondary",
    className:
      "bg-green-500/15 text-green-700 dark:text-green-300 border-green-400/30",
  },
  EXECUTED: {
    variant: "secondary",
    className:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-400/30",
  },
  CANCELLED: {
    variant: "outline",
    className: "text-muted-foreground",
  },
  FAILED: {
    variant: "destructive",
    className: "",
  },
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  PENDING: <Clock className="h-3 w-3" aria-hidden="true" />,
  APPROVED: <CheckCircle2 className="h-3 w-3" aria-hidden="true" />,
  EXECUTED: <CheckCircle2 className="h-3 w-3" aria-hidden="true" />,
  CANCELLED: <XCircle className="h-3 w-3" aria-hidden="true" />,
  FAILED: <XCircle className="h-3 w-3" aria-hidden="true" />,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ProposalCardProps {
  proposal: Proposal;
  /** Whether the current user is authenticated */
  isAuthenticated: boolean;
  /** Address/id of the current user for detecting already-voted state */
  currentUserAddress?: string;
  onVote: (proposal: Proposal, choice: VoteChoice) => Promise<void>;
}

export function ProposalCard({
  proposal,
  isAuthenticated,
  currentUserAddress,
  onVote,
}: ProposalCardProps) {
  const [voteModalOpen, setVoteModalOpen] = useState(false);

  const hasVoted =
    !!currentUserAddress &&
    Array.isArray(proposal.approvers) &&
    proposal.approvers.includes(currentUserAddress);

  const votable = isVotable(proposal);
  const canVote = isAuthenticated && votable && !hasVoted;

  const badgeCfg = STATUS_BADGE[proposal.status] ?? STATUS_BADGE.PENDING;
  const statusLabel = PROPOSAL_STATUS_LABELS[proposal.status] ?? proposal.status;
  const statusIcon = STATUS_ICONS[proposal.status];

  const breakdown = proposal.vote_breakdown ?? {
    yes: proposal.approval_count ?? 0,
    no: 0,
    abstain: 0,
  };

  const createdAgo = formatDistanceToNow(new Date(proposal.created_at), {
    addSuffix: true,
  });

  // Title: prefer description, fallback to function name
  const title = proposal.description
    ? proposal.description.split("\n")[0].slice(0, 100)
    : proposal.function;

  return (
    <>
      <Card className="flex flex-col hover:shadow-md transition-shadow">
        <CardHeader className="pb-3">
          {/* Status + age */}
          <div className="flex items-start justify-between gap-2">
            <Badge
              variant="outline"
              className={cn(
                "inline-flex items-center gap-1 text-xs shrink-0",
                badgeCfg.className
              )}
            >
              {statusIcon}
              {statusLabel}
            </Badge>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {createdAgo}
            </span>
          </div>

          <CardTitle className="text-base leading-snug mt-2 line-clamp-2">
            {title}
          </CardTitle>

          <CardDescription className="font-mono text-xs truncate">
            {proposal.function}()
          </CardDescription>
        </CardHeader>

        <CardContent className="flex-1 space-y-4 pt-0">
          {/* Contract */}
          <div className="text-xs text-muted-foreground truncate">
            <span className="font-medium text-foreground">Target: </span>
            <span className="font-mono">{proposal.target_contract}</span>
          </div>

          {/* Vote breakdown */}
          <VoteBreakdownChart
            yes={breakdown.yes}
            no={breakdown.no}
            abstain={breakdown.abstain}
          />

          {/* Already voted indicator */}
          {hasVoted && (
            <p className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              You have already voted on this proposal
            </p>
          )}

          {/* Deadline */}
          {proposal.execute_after && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Earliest execution:{" "}
              {new Date(proposal.execute_after).toLocaleDateString()}
            </p>
          )}
        </CardContent>

        <CardFooter className="gap-2 pt-4">
          {/* Vote button */}
          {canVote && (
            <Button
              size="sm"
              className="flex-1 gap-1.5"
              onClick={() => setVoteModalOpen(true)}
            >
              <Vote className="h-4 w-4" aria-hidden="true" />
              Vote
            </Button>
          )}

          {/* Not logged in prompt */}
          {!isAuthenticated && votable && (
            <Link href="/login" className="flex-1">
              <Button variant="outline" size="sm" className="w-full gap-1.5">
                Log in to vote
              </Button>
            </Link>
          )}

          {/* View details */}
          <Link href={`/governance/${proposal.id}`} className={canVote || (!isAuthenticated && votable) ? "" : "flex-1"}>
            <Button
              variant="ghost"
              size="sm"
              className={cn("gap-1 w-full", !canVote && (!isAuthenticated || !votable) && "flex-1")}
              aria-label={`View details for proposal: ${title}`}
            >
              Details
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Link>
        </CardFooter>
      </Card>

      {/* Vote modal */}
      <VoteModal
        isOpen={voteModalOpen}
        onClose={() => setVoteModalOpen(false)}
        proposalTitle={title}
        onConfirm={async (choice) => {
          await onVote(proposal, choice);
        }}
      />
    </>
  );
}
