"use client";

import React, { useState } from "react";
import { ThumbsUp, ThumbsDown, Minus, AlertCircle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { VoteChoice } from "@/types/governance";

interface VoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  proposalTitle: string;
  onConfirm: (choice: VoteChoice) => Promise<void>;
}

const VOTE_OPTIONS: {
  choice: VoteChoice;
  label: string;
  icon: React.ReactNode;
  activeClass: string;
  hoverClass: string;
}[] = [
  {
    choice: "yes",
    label: "Yes — I support this proposal",
    icon: <ThumbsUp className="h-5 w-5" aria-hidden="true" />,
    activeClass:
      "border-green-500 bg-green-500/10 text-green-700 dark:text-green-400",
    hoverClass: "hover:border-green-400 hover:bg-green-500/5",
  },
  {
    choice: "no",
    label: "No — I oppose this proposal",
    icon: <ThumbsDown className="h-5 w-5" aria-hidden="true" />,
    activeClass:
      "border-red-500 bg-red-500/10 text-red-700 dark:text-red-400",
    hoverClass: "hover:border-red-400 hover:bg-red-500/5",
  },
  {
    choice: "abstain",
    label: "Abstain — I decline to vote",
    icon: <Minus className="h-5 w-5" aria-hidden="true" />,
    activeClass:
      "border-gray-500 bg-gray-500/10 text-gray-700 dark:text-gray-300",
    hoverClass: "hover:border-gray-400 hover:bg-gray-500/5",
  },
];

export function VoteModal({
  isOpen,
  onClose,
  proposalTitle,
  onConfirm,
}: VoteModalProps) {
  const [selected, setSelected] = useState<VoteChoice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (submitting) return;
    setSelected(null);
    setError(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(selected);
      setSelected(null);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to submit vote. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Cast Your Vote"
      size="sm"
      closeOnOverlayClick={!submitting}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground leading-relaxed">
          You are voting on:{" "}
          <span className="font-medium text-foreground">{proposalTitle}</span>
        </p>

        {/* Vote options */}
        <div className="space-y-2" role="radiogroup" aria-label="Vote choice">
          {VOTE_OPTIONS.map((opt) => (
            <button
              key={opt.choice}
              role="radio"
              aria-checked={selected === opt.choice}
              onClick={() => setSelected(opt.choice)}
              disabled={submitting}
              className={cn(
                "w-full flex items-center gap-3 rounded-lg border-2 px-4 py-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                "border-border text-foreground",
                opt.hoverClass,
                selected === opt.choice && opt.activeClass
              )}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>

        {/* Inline error */}
        {error && (
          <div
            className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleSubmit}
            disabled={!selected || submitting}
            loading={submitting}
          >
            Submit Vote
          </Button>
        </div>
      </div>
    </Modal>
  );
}
