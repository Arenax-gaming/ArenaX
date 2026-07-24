"use client";

import React, { useMemo, useState } from "react";
import { Scale, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/common/EmptyState";
import { PageError } from "@/components/common/PageError";
import { ProposalCard } from "@/components/governance/ProposalCard";
import { ListItemSkeleton } from "@/components/common/PageSkeleton";
import { useAuth } from "@/hooks/useAuth";
import { useProposals, useVoteOnProposal } from "@/hooks/useGovernance";
import type { Proposal, ProposalTab, VoteChoice } from "@/types/governance";
import { statusToTab } from "@/types/governance";

// ---------------------------------------------------------------------------
// Tab config
// ---------------------------------------------------------------------------

const TABS: { id: ProposalTab; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "passed", label: "Passed" },
  { id: "failed", label: "Failed" },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function GovernancePage() {
  const { user } = useAuth();
  const { data: proposals, isLoading, isError, refetch } = useProposals();
  const voteMutation = useVoteOnProposal();

  const [activeTab, setActiveTab] = useState<ProposalTab>("active");
  const [voteError, setVoteError] = useState<string | null>(null);

  // Group proposals by tab
  const grouped = useMemo<Record<ProposalTab, Proposal[]>>(() => {
    const base: Record<ProposalTab, Proposal[]> = {
      active: [],
      passed: [],
      failed: [],
    };
    if (!proposals) return base;
    for (const p of proposals) {
      base[statusToTab(p.status)].push(p);
    }
    // Active: most recent first; others: most-recently-executed first
    base.active.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    base.passed.sort(
      (a, b) =>
        new Date(b.executed_at ?? b.created_at).getTime() -
        new Date(a.executed_at ?? a.created_at).getTime()
    );
    base.failed.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return base;
  }, [proposals]);

  const visibleProposals = grouped[activeTab];

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleVote = async (proposal: Proposal, choice: VoteChoice) => {
    setVoteError(null);
    try {
      await voteMutation.mutateAsync({ id: proposal.id, choice });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to submit vote.";
      setVoteError(msg);
      throw err; // re-throw so VoteModal can show inline error
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Scale className="h-7 w-7 text-primary" aria-hidden="true" />
          Governance
        </h1>
        <p className="text-muted-foreground">
          Review and vote on proposals that shape the ArenaX platform.
        </p>
      </div>

      {/* Auth notice */}
      {!user && (
        <div
          className="flex items-start gap-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300"
          role="note"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            You are viewing governance proposals as a guest.{" "}
            <a href="/login" className="font-semibold underline underline-offset-2">
              Log in
            </a>{" "}
            to cast votes.
          </span>
        </div>
      )}

      {/* Tabs */}
      <div
        className="inline-flex rounded-lg border bg-muted p-1 gap-0.5"
        role="tablist"
        aria-label="Proposal status tabs"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`tabpanel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={[
              "inline-flex items-center gap-2 px-5 py-2 rounded-md text-sm font-medium transition-all",
              activeTab === tab.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {tab.label}
            {/* Count badge — only show when loaded */}
            {!isLoading && proposals && (
              <span className="ml-0.5 text-xs bg-muted-foreground/20 px-2 py-0.5 rounded-full tabular-nums">
                {grouped[tab.id].length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Global vote error toast-area */}
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

      {/* Tab panel */}
      <section
        role="tabpanel"
        id={`tabpanel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
      >
        {isError ? (
          <PageError
            title="Failed to load proposals"
            message="We couldn't fetch governance proposals. Check your connection and try again."
            onRetry={() => refetch()}
          />
        ) : isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <ListItemSkeleton key={i} />
            ))}
          </div>
        ) : visibleProposals.length === 0 ? (
          <EmptyState
            icon={Scale}
            title={`No ${activeTab} proposals`}
            description={
              activeTab === "active"
                ? "There are no active proposals right now. Check back later."
                : `No proposals have ${activeTab === "passed" ? "passed" : "failed"} yet.`
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleProposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                isAuthenticated={!!user}
                currentUserAddress={user?.id}
                onVote={handleVote}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
